-- Allow the shared public-ingestion lease to run on a bounded seconds-based
-- cadence. Preserve the current autoscout_public_store definition, including
-- all source allowlists and validation added by later migrations.
do $migration$
declare
  v_def text;
  v_old text := $$next_at=now()+interval '150 seconds'$$;
  v_new text := $$next_at=now()+pg_catalog.make_interval(secs=>greatest(30,least(300,coalesce(nullif(p_payload->>'interval_seconds','')::integer,45))))$$;
  v_matches integer;
begin
  v_def := pg_get_functiondef('public.autoscout_public_store(text,text,jsonb)'::regprocedure);
  if position('make_interval(secs=>greatest(30,least(300' in v_def) > 0 then
    return;
  end if;
  v_matches := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_matches <> 1 then
    raise exception 'autoscout_public_store scheduler shape changed: expected 1 lease interval, found %', v_matches;
  end if;
  execute replace(v_def, v_old, v_new);
end
$migration$;
