-- Large public prop boards (PrizePicks can exceed 5k active rows after side
-- expansion) must not be sent as one PostgREST transaction on free-tier
-- compute. Chunked callers upsert bounded batches using one observed_at value,
-- then send a final empty batch. Only that finalize call removes rows that were
-- omitted from the completed snapshot. If any batch fails, last-good rows stay
-- in place and age out normally instead of being wiped by a partial refresh.

do $migration$
declare
  v_def text;
  v_old text := $old$
  -- Rows omitted from the new source snapshot are no longer active. Prune only
  -- those IDs instead of deleting every row for the source before each ingest.
  delete from public.active_props a
   where a.source=v_source
     and a.id not in (
       select r->>'id' from jsonb_array_elements(p_payload->'rows') r
       where r->>'id' is not null
     );
$old$;
  v_new text := $new$
  -- Chunked snapshots keep last-good rows until every batch succeeds. The
  -- final empty call prunes rows that were not touched by this observation.
  if coalesce((p_payload->>'chunked')::boolean,false) then
    if coalesce((p_payload->>'finalize')::boolean,false) then
      delete from public.active_props a
       where a.source=v_source
         and a.observed_at < v_observed;
    end if;
  else
    -- Backward-compatible atomic replacement for older callers.
    delete from public.active_props a
     where a.source=v_source
       and a.id not in (
         select r->>'id' from jsonb_array_elements(p_payload->'rows') r
         where r->>'id' is not null
       );
  end if;
$new$;
begin
  select pg_get_functiondef('public.autoscout_public_store(text,text,jsonb)'::regprocedure)
    into v_def;
  if position(v_old in v_def) = 0 then
    raise exception 'autoscout_public_store prune block changed; refusing unsafe patch';
  end if;
  execute replace(v_def, v_old, v_new);
end
$migration$;

notify pgrst, 'reload schema';
