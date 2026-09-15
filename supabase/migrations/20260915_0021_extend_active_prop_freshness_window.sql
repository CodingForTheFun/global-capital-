-- Keep healthy provider tabs from briefly expiring between five-minute ingest
-- cycles when a full multi-provider refresh runs slightly past ten minutes.
-- This only extends the last-good active window; rows are still capped at the
-- actual game start time and remain subject to the existing source refreshes.
do $m$
declare
  ddl text;
  old_expr text := 'v_observed+interval ''10 minutes''';
  new_expr text := 'v_observed+interval ''15 minutes''';
begin
  select pg_get_functiondef('public.autoscout_public_store(text,text,jsonb)'::regprocedure) into ddl;
  if position(new_expr in ddl) > 0 then
    return;
  end if;
  if position(old_expr in ddl) = 0 then
    raise exception 'autoscout_public_store TTL expression not found';
  end if;
  ddl := replace(ddl, old_expr, new_expr);
  ddl := replace(ddl, 'their 10-minute TTL', 'their 15-minute TTL');
  execute ddl;
end
$m$;

update public.active_props
set expires_at = least(observed_at + interval '15 minutes', game_start_time)
where game_start_time > now()
  and observed_at > now() - interval '15 minutes'
  and expires_at < least(observed_at + interval '15 minutes', game_start_time);

notify pgrst, 'reload schema';
