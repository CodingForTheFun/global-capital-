-- Keep the scheduler-state SECURITY DEFINER RPC callable only through the explicitly granted application roles.
-- The RPC retains its existing token authorization check; this removes only the redundant PostgreSQL PUBLIC grant.
revoke execute on function public.autoscout_public_scheduler_state(text) from public;
