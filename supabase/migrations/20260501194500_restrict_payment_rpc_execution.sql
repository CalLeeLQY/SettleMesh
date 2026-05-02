revoke execute on function public.complete_checkout_session(uuid, text, uuid, text, text, boolean) from public;
revoke execute on function public.complete_checkout_session(uuid, text, uuid, text, text, boolean) from anon;
revoke execute on function public.complete_checkout_session(uuid, text, uuid, text, text, boolean) from authenticated;

revoke execute on function public.complete_topup_order(uuid, text, text, timestamp with time zone) from public;
revoke execute on function public.complete_topup_order(uuid, text, text, timestamp with time zone) from anon;
revoke execute on function public.complete_topup_order(uuid, text, text, timestamp with time zone) from authenticated;

grant execute on function public.complete_checkout_session(uuid, text, uuid, text, text, boolean) to service_role;
grant execute on function public.complete_topup_order(uuid, text, text, timestamp with time zone) to service_role;
