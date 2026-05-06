create or replace function public.create_merchant_checkout_session(
  p_key_prefix text,
  p_key_hash text,
  p_amount integer,
  p_description text,
  p_external_id text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_return_url text default null,
  p_cancel_url text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_key public.merchant_api_keys%rowtype;
  v_merchant public.merchants%rowtype;
  v_session public.checkout_sessions%rowtype;
  v_idempotent_replay boolean := false;
begin
  select *
    into v_key
    from public.merchant_api_keys
   where key_prefix = p_key_prefix
     and key_hash = p_key_hash
     and is_active = true;

  if not found then
    return jsonb_build_object('ok', false, 'status', 401, 'error', 'Invalid API key');
  end if;

  select *
    into v_merchant
    from public.merchants
   where id = v_key.merchant_id
     and is_active = true;

  if not found then
    return jsonb_build_object('ok', false, 'status', 401, 'error', 'Invalid API key');
  end if;

  if p_idempotency_key is not null then
    select *
      into v_session
      from public.checkout_sessions
     where merchant_id = v_merchant.id
       and idempotency_key = p_idempotency_key;

    if found then
      v_idempotent_replay := true;
    end if;
  end if;

  if not v_idempotent_replay then
    insert into public.checkout_sessions (
      merchant_id,
      external_id,
      amount_credit,
      description,
      metadata,
      return_url,
      cancel_url,
      idempotency_key
    )
    values (
      v_merchant.id,
      p_external_id,
      p_amount,
      p_description,
      coalesce(p_metadata, '{}'::jsonb),
      p_return_url,
      p_cancel_url,
      p_idempotency_key
    )
    returning * into v_session;
  end if;

  update public.merchant_api_keys
     set last_used_at = now()
   where id = v_key.id;

  return jsonb_build_object(
    'ok', true,
    'status', 200,
    'idempotent_replay', v_idempotent_replay,
    'merchant', jsonb_build_object(
      'id', v_merchant.id,
      'user_id', v_merchant.user_id,
      'name', v_merchant.name,
      'webhook_url', v_merchant.webhook_url,
      'webhook_secret', v_merchant.webhook_secret,
      'is_active', v_merchant.is_active,
      'allow_guest_checkout', v_merchant.allow_guest_checkout,
      'guest_checkout_min_credit', v_merchant.guest_checkout_min_credit,
      'mock_fiat_enabled', v_merchant.mock_fiat_enabled
    ),
    'session', jsonb_build_object(
      'id', v_session.id,
      'amount_credit', v_session.amount_credit,
      'description', v_session.description,
      'status', v_session.status,
      'expires_at', v_session.expires_at
    )
  );
end;
$$;

revoke execute on function public.create_merchant_checkout_session(text, text, integer, text, text, jsonb, text, text, text) from public;
revoke execute on function public.create_merchant_checkout_session(text, text, integer, text, text, jsonb, text, text, text) from anon;
revoke execute on function public.create_merchant_checkout_session(text, text, integer, text, text, jsonb, text, text, text) from authenticated;

grant execute on function public.create_merchant_checkout_session(text, text, integer, text, text, jsonb, text, text, text) to service_role;

create index if not exists merchant_api_keys_prefix_hash_active_idx
  on public.merchant_api_keys (key_prefix, key_hash)
  where is_active = true;
