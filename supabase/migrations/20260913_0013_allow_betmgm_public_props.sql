-- Extend the existing token-protected public-ingestion allowlist for the
-- anonymous BetMGM collector. Preserve all validation and RPC behavior.
do $migration$
declare
  v_def text;
  v_old text := $$split_part(v_source,':',1)='betrivers' and split_part(v_source,':',2) in ('NFL','NBA','MLB','NHL')$$;
  v_new text := $$(split_part(v_source,':',1)='betrivers' and split_part(v_source,':',2) in ('NFL','NBA','MLB','NHL')) or (split_part(v_source,':',1)='betmgm' and split_part(v_source,':',2) in ('NFL','NBA','MLB','NHL'))$$;
  v_matches integer;
begin
  v_def := pg_get_functiondef('public.autoscout_public_store(text,text,jsonb)'::regprocedure);
  if position($$='betmgm'$$ in v_def) > 0 then
    return;
  end if;
  v_matches := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_matches <> 2 then
    raise exception 'autoscout_public_store source allowlist shape changed: expected 2 BetRivers clauses, found %', v_matches;
  end if;
  execute replace(v_def, v_old, v_new);
end
$migration$;
