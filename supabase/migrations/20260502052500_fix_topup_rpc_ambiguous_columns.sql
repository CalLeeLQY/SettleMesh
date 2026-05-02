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
