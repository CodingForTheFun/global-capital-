-- Chunked active-prop snapshots intentionally avoid rewriting unchanged rows on
-- every refresh. Those unchanged rows keep their prior observed_at, so finalizing
-- with observed_at < the exact new snapshot timestamp deleted healthy unchanged
-- rows and caused a delete/reinsert WAL storm on the next cycle.
--
-- Keep recently observed rows for the same 8-minute anti-churn window used by
-- the upsert. Truly omitted rows still age out through their 10-minute expires_at
-- TTL and the normal cleanup path.
do $migration$
declare
  v_def text;
  v_old text := $old$
      delete from public.active_props a
       where a.source=v_source
         and a.observed_at < v_observed;
$old$;
  v_new text := $new$
      -- Rows that were present but materially unchanged may intentionally keep
      -- their prior observed_at for one cycle to avoid write amplification.
      -- Preserve those recent rows here; omitted rows naturally expire after
      -- their 10-minute TTL and are pruned once they age beyond this window.
      delete from public.active_props a
       where a.source=v_source
         and a.observed_at < v_observed - interval '8 minutes';
$new$;
begin
  select pg_get_functiondef('public.autoscout_public_store(text,text,jsonb)'::regprocedure)
    into v_def;
  if position(v_old in v_def) = 0 then
    raise exception 'autoscout_public_store finalize block changed; refusing unsafe patch';
  end if;
  execute replace(v_def, v_old, v_new);
end
$migration$;

notify pgrst, 'reload schema';
