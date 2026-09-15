-- Keep the token-protected persistence RPC aligned with the sportsbook/sport
-- combinations the runtime can legitimately emit. Row validation still requires
-- sportsbookKey to match the source prefix, a future game, and a non-alternate line.
do $migration$
declare
  v_def text;
  v_primary_old text := $$or (split_part(v_source,':',1)='draftkings' and split_part(v_source,':',2) in ('NFL','NBA','WNBA','MLB','NHL','NCAAF','NCAAB','TENNIS'))$$;
  v_primary_new text := $$or (split_part(v_source,':',1) in ('draftkings','fanduel','pinnacle','betrivers','bvda','betmgm') and split_part(v_source,':',2) in ('NFL','NBA','WNBA','MLB','NHL','NCAAF','NCAAB','TENNIS','SOCCER'))$$;
  v_secondary_a text := $$or (split_part(v_source,':',1) in ('fanduel','pinnacle') and split_part(v_source,':',2) in ('NFL','NBA','WNBA','MLB','NHL','NCAAF','NCAAB','TENNIS'))$$;
  v_secondary_b text := $$or ((split_part(v_source,':',1)='betrivers' and split_part(v_source,':',2) in ('NFL','NBA','MLB','NHL')) or (split_part(v_source,':',1)='betmgm' and split_part(v_source,':',2) in ('NFL','NBA','MLB','NHL','SOCCER')))$$;
  v_secondary_c text := $$or (split_part(v_source,':',1)='bvda' and split_part(v_source,':',2) in ('NFL','NBA','MLB','NHL','NCAAF','NCAAB'))$$;
  n_primary integer;
  n_a integer;
  n_b integer;
  n_c integer;
begin
  v_def := pg_get_functiondef('public.autoscout_public_store(text,text,jsonb)'::regprocedure);
  if position(v_primary_new in v_def) > 0 then
    return;
  end if;
  n_primary := (length(v_def)-length(replace(v_def,v_primary_old,'')))/length(v_primary_old);
  n_a := (length(v_def)-length(replace(v_def,v_secondary_a,'')))/length(v_secondary_a);
  n_b := (length(v_def)-length(replace(v_def,v_secondary_b,'')))/length(v_secondary_b);
  n_c := (length(v_def)-length(replace(v_def,v_secondary_c,'')))/length(v_secondary_c);
  if n_primary<>2 or n_a<>2 or n_b<>2 or n_c<>2 then
    raise exception 'autoscout_public_store allowlist shape changed: primary %, a %, b %, c %', n_primary,n_a,n_b,n_c;
  end if;
  v_def := replace(v_def,v_primary_old,v_primary_new);
  v_def := replace(v_def,v_secondary_a,'');
  v_def := replace(v_def,v_secondary_b,'');
  v_def := replace(v_def,v_secondary_c,'');
  execute v_def;
end
$migration$;

notify pgrst, 'reload schema';
