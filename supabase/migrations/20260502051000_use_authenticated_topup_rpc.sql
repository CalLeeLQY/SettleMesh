create or replace function public.create_stripe_topup_order(
  p_package_id uuid,
  p_checkout_session_id uuid default null
)
returns table (
  id uuid,
  package_id uuid,
  credit_amount bigint,
  bonus_credit bigint,
  price_usd numeric,
  status text,
  expires_at timestamp with time zone,
  label text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_pkg public.topup_packages%rowtype;
  v_linked_session public.checkout_sessions%rowtype;
  v_order public.topup_orders%rowtype;
begin
  if v_user_id is null then
    raise exception 'Unauthorized';
  end if;

  select tp.*
    into v_pkg
    from public.topup_packages tp
   where tp.id = p_package_id
     and tp.is_active = true;

  if not found then
    raise exception 'Invalid package';
  end if;

  if p_checkout_session_id is not null then
    select cs.*
      into v_linked_session
      from public.checkout_sessions cs
     where cs.id = p_checkout_session_id
       and cs.status = 'pending';

    if not found or v_linked_session.expires_at < now() then
      raise exception 'Linked checkout session is not payable';
    end if;
  end if;

  insert into public.topup_orders (
    user_id,
    package_id,
    credit_amount,
    bonus_credit,
    price_usd,
    status,
    payment_method,
    idempotency_key,
    checkout_session_id,
    expires_at
  )
  values (
    v_user_id,
    v_pkg.id,
    v_pkg.credit_amount + v_pkg.bonus_credit,
    v_pkg.bonus_credit,
    v_pkg.price_usd,
    'awaiting_payment',
    'stripe',
    'topup_' || v_user_id || '_' || v_pkg.id || '_' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
    p_checkout_session_id,
    now() + interval '30 minutes'
  )
  returning * into v_order;

  return query
  select
    v_order.id,
    v_order.package_id,
    v_order.credit_amount,
    v_order.bonus_credit,
    v_order.price_usd,
    v_order.status,
    v_order.expires_at,
    v_pkg.label;
end;
$$;

create or replace function public.attach_stripe_topup_provider(
  p_order_id uuid,
  p_provider_id text,
  p_provider_session text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Unauthorized';
  end if;

  if p_provider_id is null or p_provider_id not like 'cs_%' then
    raise exception 'Invalid Stripe session id';
  end if;

  update public.topup_orders
     set payment_provider_id = p_provider_id,
         payment_provider_session = p_provider_session,
         payment_method = 'stripe'
   where id = p_order_id
     and user_id = auth.uid()
     and status = 'awaiting_payment'
     and payment_provider_id is null
  returning id into v_updated_id;

  if v_updated_id is null then
    raise exception 'Top-up order is not attachable';
  end if;

  return true;
end;
$$;

create or replace function public.mark_stripe_topup_order_failed(
  p_order_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Unauthorized';
  end if;

  update public.topup_orders
     set status = 'failed',
         payment_method = 'stripe'
   where id = p_order_id
     and user_id = auth.uid()
     and status = 'awaiting_payment'
  returning id into v_updated_id;

  return v_updated_id is not null;
end;
$$;

revoke execute on function public.create_stripe_topup_order(uuid, uuid) from public, anon;
revoke execute on function public.attach_stripe_topup_provider(uuid, text, text) from public, anon;
revoke execute on function public.mark_stripe_topup_order_failed(uuid) from public, anon;

grant execute on function public.create_stripe_topup_order(uuid, uuid) to authenticated;
grant execute on function public.attach_stripe_topup_provider(uuid, text, text) to authenticated;
grant execute on function public.mark_stripe_topup_order_failed(uuid) to authenticated;
