-- A full multi-provider public refresh can queue verified sportsbook writes
-- behind other healthy sources. Accept a slightly older provider observation
-- without changing its original observed_at or extending data beyond the
-- existing 15-minute active-row TTL / game start cap.
do $migration$
declare
  v_def text;
  v_old text := $$v_observed<now()-interval '5 minutes'$$;
  v_new text := $$v_observed<now()-interval '15 minutes'$$;
  v_matches integer;
begin
  v_def := pg_get_functiondef('public.autoscout_public_store(text,text,jsonb)'::regprocedure);
  if position(v_new in v_def) > 0 then
    return;
  end if;
  v_matches := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_matches <> 1 then
    raise exception 'autoscout_public_store snapshot-age guard changed: expected 1 clause, found %', v_matches;
  end if;
  execute replace(v_def, v_old, v_new);
end
$migration$;

notify pgrst, 'reload schema';
