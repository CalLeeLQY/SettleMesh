create or replace function public.prepare_stripe_fiat_checkout(
  p_session_id uuid,
  p_payer_email text default null,
  p_payer_name text default null
)
returns table (
  id uuid,
  amount_credit integer,
  description text,
  merchant_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.checkout_sessions%rowtype;
  v_merchant public.merchants%rowtype;
begin
  select cs.*
    into v_session
    from public.checkout_sessions cs
   where cs.id = p_session_id
     and cs.status = 'pending'
   for update;

  if not found then
    raise exception 'Checkout session not found or already completed';
  end if;

  if v_session.expires_at < now() then
    update public.checkout_sessions
       set status = 'expired',
           updated_at = now()
     where checkout_sessions.id = v_session.id;

    raise exception 'Checkout session expired';
  end if;

  select m.*
    into v_merchant
    from public.merchants m
   where m.id = v_session.merchant_id
     and m.is_active = true;

  if not found then
    raise exception 'Merchant not found';
  end if;

  if v_merchant.allow_guest_checkout = false
     or v_session.amount_credit < coalesce(v_merchant.guest_checkout_min_credit, 0) then
    raise exception 'Fiat checkout is unavailable for this payment';
  end if;

  update public.checkout_sessions
     set payer_id = null,
         payer_email = nullif(btrim(p_payer_email), ''),
         payer_name = nullif(btrim(p_payer_name), ''),
         payment_provider_status = 'starting',
         payment_started_at = now(),
         updated_at = now()
   where checkout_sessions.id = v_session.id;

  return query
  select
    v_session.id,
    v_session.amount_credit,
    v_session.description,
    v_merchant.name;
end;
$$;

create or replace function public.attach_stripe_fiat_checkout_provider(
  p_session_id uuid,
  p_provider_id text,
  p_provider_session text,
  p_payer_email text default null,
  p_payer_name text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_id uuid;
begin
  if p_provider_id is null or p_provider_id not like 'cs_%' then
    raise exception 'Invalid Stripe session id';
  end if;

  update public.checkout_sessions
     set payer_id = null,
         payer_email = nullif(btrim(p_payer_email), ''),
         payer_name = nullif(btrim(p_payer_name), ''),
         payment_provider_id = p_provider_id,
         payment_provider_session = p_provider_session,
         payment_provider_status = 'awaiting_payment',
         payment_started_at = coalesce(payment_started_at, now()),
         updated_at = now()
   where checkout_sessions.id = p_session_id
     and checkout_sessions.status = 'pending'
  returning checkout_sessions.id into v_updated_id;

  if v_updated_id is null then
    raise exception 'Checkout session is not attachable';
  end if;

  return true;
end;
$$;

create or replace function public.mark_stripe_fiat_checkout_failed(
  p_session_id uuid,
  p_payer_email text default null,
  p_payer_name text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_id uuid;
begin
  update public.checkout_sessions
     set payer_id = null,
         payer_email = nullif(btrim(p_payer_email), ''),
         payer_name = nullif(btrim(p_payer_name), ''),
         payment_provider_status = 'failed',
         payment_started_at = coalesce(payment_started_at, now()),
         updated_at = now()
   where checkout_sessions.id = p_session_id
     and checkout_sessions.status = 'pending'
  returning checkout_sessions.id into v_updated_id;

  return v_updated_id is not null;
end;
$$;

revoke execute on function public.prepare_stripe_fiat_checkout(uuid, text, text) from public;
revoke execute on function public.attach_stripe_fiat_checkout_provider(uuid, text, text, text, text) from public;
revoke execute on function public.mark_stripe_fiat_checkout_failed(uuid, text, text) from public;

grant execute on function public.prepare_stripe_fiat_checkout(uuid, text, text) to anon, authenticated;
grant execute on function public.attach_stripe_fiat_checkout_provider(uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.mark_stripe_fiat_checkout_failed(uuid, text, text) to anon, authenticated;
