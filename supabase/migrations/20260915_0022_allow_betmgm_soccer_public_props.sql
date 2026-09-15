-- BetMGM's public collector now emits verified soccer player props, but the
-- token-protected public store still only accepts BetMGM NFL/NBA/MLB/NHL
-- sources. Extend that existing allowlist without changing validation or data.
do $migration$
declare
  v_def text;
  v_old text := $$split_part(v_source,':',1)='betmgm' and split_part(v_source,':',2) in ('NFL','NBA','MLB','NHL')$$;
  v_new text := $$split_part(v_source,':',1)='betmgm' and split_part(v_source,':',2) in ('NFL','NBA','MLB','NHL','SOCCER')$$;
  v_matches integer;
begin
  v_def := pg_get_functiondef('public.autoscout_public_store(text,text,jsonb)'::regprocedure);
  if position($$='betmgm' and split_part(v_source,':',2) in ('NFL','NBA','MLB','NHL','SOCCER')$$ in v_def) > 0 then
    return;
  end if;
  v_matches := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_matches <> 2 then
    raise exception 'autoscout_public_store BetMGM allowlist shape changed: expected 2 clauses, found %', v_matches;
  end if;
  execute replace(v_def, v_old, v_new);
end
$migration$;

notify pgrst, 'reload schema';
