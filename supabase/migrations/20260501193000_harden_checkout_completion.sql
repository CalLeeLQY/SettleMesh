create or replace function public.complete_checkout_session(
  p_session_id uuid,
  p_payment_method text,
  p_payer_id uuid default null,
  p_payer_email text default null,
  p_payer_name text default null,
  p_allow_expired boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.checkout_sessions%rowtype;
  v_merchant public.merchants%rowtype;
  v_payer_wallet public.wallets%rowtype;
  v_merchant_wallet public.wallets%rowtype;
  v_amount integer;
  v_completed_at timestamptz := now();
  v_payer_balance bigint;
  v_merchant_balance bigint;
  v_debit_txn_id uuid;
  v_credit_txn_id uuid;
  v_existing_ledger boolean;
begin
  if p_payment_method not in ('credit', 'mock_fiat', 'fiat') then
    return jsonb_build_object('ok', false, 'status', 400, 'error', 'Invalid payment method');
  end if;

  select *
    into v_session
    from public.checkout_sessions
   where id = p_session_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error', 'Session not found');
  end if;

  if v_session.status = 'completed' then
    if v_session.payment_method = p_payment_method
       and (
         p_payment_method <> 'credit'
         or v_session.payer_id is not distinct from p_payer_id
       ) then
      return jsonb_build_object(
        'ok', true,
        'status', 200,
        'already_processed', true,
        'session_id', v_session.id,
        'payment_method', v_session.payment_method,
        'credits_remaining', null
      );
    end if;

    return jsonb_build_object('ok', false, 'status', 409, 'error', 'Session already completed');
  end if;

  if v_session.status = 'expired' and not p_allow_expired then
    return jsonb_build_object('ok', false, 'status', 410, 'error', 'Session expired');
  end if;

  if v_session.status <> 'pending' and not (p_allow_expired and v_session.status = 'expired') then
    return jsonb_build_object('ok', false, 'status', 409, 'error', 'Session is not payable');
  end if;

  if v_session.expires_at < now() and not p_allow_expired then
    update public.checkout_sessions
       set status = 'expired',
           updated_at = now()
     where id = v_session.id;

    return jsonb_build_object('ok', false, 'status', 410, 'error', 'Session expired');
  end if;

  select exists (
    select 1
      from public.ledger_transactions
     where idempotency_key in (
       'checkout_' || v_session.id || '_' || p_payment_method,
       'checkout_' || v_session.id || '_' || p_payment_method || '_earning'
     )
  )
  into v_existing_ledger;

  if v_existing_ledger then
    return jsonb_build_object('ok', false, 'status', 409, 'error', 'Checkout already has ledger activity');
  end if;

  select *
    into v_merchant
    from public.merchants
   where id = v_session.merchant_id
     and is_active = true;

  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error', 'Merchant not found');
  end if;

  v_amount := v_session.amount_credit;

  if p_payment_method in ('mock_fiat', 'fiat') then
    if v_merchant.allow_guest_checkout = false
       or v_amount < coalesce(v_merchant.guest_checkout_min_credit, 0) then
      return jsonb_build_object('ok', false, 'status', 400, 'error', 'Guest checkout is not available for this payment');
    end if;
  end if;

  if p_payment_method = 'mock_fiat' and v_merchant.mock_fiat_enabled = false then
    return jsonb_build_object('ok', false, 'status', 400, 'error', 'Mock fiat checkout is not available for this payment');
  end if;

  select *
    into v_merchant_wallet
    from public.wallets
   where user_id = v_merchant.user_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'status', 500, 'error', 'Merchant wallet not found');
  end if;

  if p_payment_method = 'credit' then
    if p_payer_id is null then
      return jsonb_build_object('ok', false, 'status', 401, 'error', 'Unauthorized');
    end if;

    select *
      into v_payer_wallet
      from public.wallets
     where user_id = p_payer_id
     for update;

    if not found then
      return jsonb_build_object('ok', false, 'status', 500, 'error', 'Wallet not found');
    end if;

    if v_payer_wallet.available_credit < v_amount then
      return jsonb_build_object('ok', false, 'status', 400, 'error', 'Insufficient credits');
    end if;

    v_payer_balance := v_payer_wallet.available_credit - v_amount;

    insert into public.ledger_transactions (
      type,
      reference_type,
      reference_id,
      description,
      idempotency_key
    )
    values (
      'purchase',
      'checkout_session',
      v_session.id,
      'Checkout: ' || v_session.description,
      'checkout_' || v_session.id || '_' || p_payment_method
    )
    returning id into v_debit_txn_id;

    update public.wallets
       set available_credit = v_payer_balance,
           total_spent = v_payer_wallet.total_spent + v_amount,
           updated_at = now()
     where id = v_payer_wallet.id;

    insert into public.ledger_entries (
      transaction_id,
      wallet_id,
      entry_type,
      amount,
      balance_after,
      credit_source
    )
    values (
      v_debit_txn_id,
      v_payer_wallet.id,
      'debit',
      v_amount,
      v_payer_balance,
      'purchased'
    );
  end if;

  v_merchant_balance := v_merchant_wallet.available_credit + v_amount;

  insert into public.ledger_transactions (
    type,
    reference_type,
    reference_id,
    description,
    idempotency_key
  )
  values (
    'earning',
    'checkout_session',
    v_session.id,
    'Earning from checkout: ' || v_session.description,
    'checkout_' || v_session.id || '_' || p_payment_method || '_earning'
  )
  returning id into v_credit_txn_id;

  update public.wallets
     set available_credit = v_merchant_balance,
         earned_credit = v_merchant_wallet.earned_credit + v_amount,
         total_earned = v_merchant_wallet.total_earned + v_amount,
         updated_at = now()
   where id = v_merchant_wallet.id;

  insert into public.ledger_entries (
    transaction_id,
    wallet_id,
    entry_type,
    amount,
    balance_after,
    credit_source
  )
  values (
    v_credit_txn_id,
    v_merchant_wallet.id,
    'credit',
    v_amount,
    v_merchant_balance,
    'earned'
  );

  update public.checkout_sessions
     set status = 'completed',
         payer_id = p_payer_id,
         payer_email = p_payer_email,
         payer_name = p_payer_name,
         payment_method = p_payment_method,
         completed_at = v_completed_at,
         updated_at = now()
   where id = v_session.id;

  return jsonb_build_object(
    'ok', true,
    'status', 200,
    'already_processed', false,
    'session_id', v_session.id,
    'payment_method', p_payment_method,
    'merchant_name', v_merchant.name,
    'merchant_user_id', v_merchant.user_id,
    'merchant_wallet_id', v_merchant_wallet.id,
    'merchant_balance', v_merchant_balance,
    'credits_remaining', case when p_payment_method = 'credit' then v_payer_balance else null end,
    'completed_at', v_completed_at,
    'amount_credit', v_amount,
    'merchant_id', v_merchant.id,
    'external_id', v_session.external_id,
    'description', v_session.description,
    'metadata', coalesce(v_session.metadata, '{}'::jsonb),
    'payer_id', p_payer_id,
    'payer_email', p_payer_email,
    'payer_name', p_payer_name,
    'webhook_url', v_merchant.webhook_url,
    'webhook_secret', v_merchant.webhook_secret
  );
end;
$$;

revoke execute on function public.complete_checkout_session(uuid, text, uuid, text, text, boolean) from public;
revoke execute on function public.complete_topup_order(uuid, text, text, timestamp with time zone) from public;

grant execute on function public.complete_checkout_session(uuid, text, uuid, text, text, boolean) to service_role;
grant execute on function public.complete_topup_order(uuid, text, text, timestamp with time zone) to service_role;
