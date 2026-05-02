create index if not exists webhook_deliveries_merchant_id_idx
  on public.webhook_deliveries (merchant_id);

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
         and merchants.user_id = (select auth.uid())
    )
  );

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
