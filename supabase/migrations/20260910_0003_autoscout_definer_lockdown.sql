-- Trigger functions must never be callable as RPC. The trigger mechanism does
-- not consult EXECUTE, so revoking it changes nothing about provisioning while
-- removing them from the public REST surface.
revoke all on function public.handle_new_user() from anon, authenticated, public;
revoke all on function public.handle_user_email_change() from anon, authenticated, public;

-- current_user_is_admin() is evaluated inside RLS policies as the querying
-- role, so `authenticated` must keep EXECUTE. Signed-out callers must not.
revoke all on function public.current_user_is_admin() from anon, public;
grant execute on function public.current_user_is_admin() to authenticated;
