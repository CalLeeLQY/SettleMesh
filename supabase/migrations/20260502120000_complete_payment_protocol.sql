create extension if not exists pgcrypto;

alter table if exists public.merchants
  add column if not exists webhook_secret text,
  add column if not exists allow_guest_checkout boolean not null default true,
  add column if not exists guest_checkout_min_credit integer not null default 0,
  add column if not exists mock_fiat_enabled boolean not null default true;

alter table if exists public.merchants
  alter column webhook_secret set default ('whsec_' || encode(gen_random_bytes(32), 'hex'));

update public.merchants
   set webhook_secret = 'whsec_' || encode(gen_random_bytes(32), 'hex')
 where webhook_secret is null
    or webhook_secret = '';

alter table if exists public.checkout_sessions
  add column if not exists idempotency_key text,
  add column if not exists payment_provider_id text,
  add column if not exists payment_provider_session text,
  add column if not exists payment_provider_status text,
  add column if not exists payment_started_at timestamptz;

create unique index if not exists checkout_sessions_merchant_idempotency_key_idx
  on public.checkout_sessions (merchant_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  checkout_session_id uuid not null references public.checkout_sessions(id) on delete cascade,
  merchant_id uuid references public.merchants(id) on delete set null,
  event_type text not null,
  target_url text not null,
  payload jsonb not null default '{}'::jsonb,
  signature text not null,
  signature_version text not null default 'v1',
  status text not null default 'pending',
  attempts integer not null default 0,
  response_status integer,
  response_body text,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint webhook_deliveries_status_check
    check (status in ('pending', 'delivered', 'failed'))
);

create index if not exists webhook_deliveries_checkout_session_id_idx
  on public.webhook_deliveries (checkout_session_id);

create index if not exists webhook_deliveries_pending_idx
  on public.webhook_deliveries (status, next_attempt_at)
  where status in ('pending', 'failed');

alter table public.webhook_deliveries enable row level security;

drop policy if exists "Merchants can read their webhook deliveries" on public.webhook_deliveries;
create policy "Merchants can read their webhook deliveries"
  on public.webhook_deliveries
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.merchants
       where merchants.id = webhook_deliveries.merchant_id
         and merchants.user_id = auth.uid()
    )
  );

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_webhook_deliveries_updated_at on public.webhook_deliveries;
create trigger set_webhook_deliveries_updated_at
before update on public.webhook_deliveries
for each row
execute function public.set_updated_at();
