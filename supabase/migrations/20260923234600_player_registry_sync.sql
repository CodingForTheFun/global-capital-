create or replace function public.oblige_registry_upsert_player(
  p_source_player_id text,
  p_sport text,
  p_provider text,
  p_provider_player_id text,
  p_clean_name text,
  p_display_name text,
  p_team text,
  p_position text,
  p_headshot_url text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sport text := upper(trim(coalesce(p_sport, '')));
  v_provider text := lower(trim(coalesce(p_provider, '')));
  v_provider_id text := nullif(trim(coalesce(p_provider_player_id, '')), '');
  v_clean text := public.oblige_registry_clean_name(coalesce(nullif(p_clean_name, ''), p_display_name));
  v_display text := nullif(trim(coalesce(p_display_name, '')), '');
  v_team text := nullif(trim(coalesce(p_team, '')), '');
  v_position text := nullif(trim(coalesce(p_position, '')), '');
  v_headshot text := nullif(trim(coalesce(p_headshot_url, '')), '');
  v_espn text;
  v_mlb text;
  v_wnba text;
  v_id uuid;
  v_existing uuid;
  v_existing_name text;
  v_name_count integer := 0;
  v_provider_json jsonb := '{}'::jsonb;
begin
  if v_sport = '' or v_clean is null or nullif(trim(coalesce(p_source_player_id, '')), '') is null then
    return null;
  end if;
  if v_display is null then v_display := coalesce(nullif(p_clean_name, ''), v_clean); end if;

  if v_provider_id ~* '^espn:[^:]+$' then v_espn := split_part(v_provider_id, ':', 2); end if;
  if v_provider_id ~* '^mlb:[^:]+$' then v_mlb := split_part(v_provider_id, ':', 2); end if;
  if v_provider_id ~* '^wnba:[^:]+$' then v_wnba := split_part(v_provider_id, ':', 2); end if;
  if v_provider <> '' and v_provider_id is not null then
    v_provider_json := jsonb_build_object(v_provider, v_provider_id);
  end if;

  -- Keep an already-established source mapping stable across ordinary metadata refreshes.
  select s.canonical_id into v_id
  from public.player_registry_sources s
  where s.source_player_id = p_source_player_id;

  -- Stable league IDs are stronger than names, but only when the names are compatible.
  if v_id is null and (v_espn is not null or v_mlb is not null or v_wnba is not null) then
    select r.canonical_id into v_id
    from public.player_registry r
    where r.sport = v_sport
      and (
        (v_espn is not null and r.espn_id = v_espn)
        or (v_mlb is not null and r.mlb_id = v_mlb)
        or (v_wnba is not null and r.wnba_id = v_wnba)
      )
      and public.oblige_registry_names_compatible(r.clean_name, v_clean)
    order by r.last_seen_at desc
    limit 1;
  end if;

  -- Provider-native identities resolve next.
  if v_id is null and v_provider_id is not null then
    select s.canonical_id into v_id
    from public.player_registry_sources s
    where s.sport = v_sport
      and lower(coalesce(s.provider, '')) = v_provider
      and s.provider_player_id = v_provider_id
      and public.oblige_registry_names_compatible(s.source_clean_name, v_clean)
    order by s.last_seen_at desc
    limit 1;
  end if;

  -- Exact normalized name is safe only when it identifies exactly one registry row.
  if v_id is null then
    select count(*), min(r.canonical_id)
      into v_name_count, v_id
    from public.player_registry r
    where r.sport = v_sport
      and r.clean_name = v_clean;
    if v_name_count <> 1 then v_id := null; end if;
  end if;

  -- Detect provider-ID collisions with genuinely different names; do not silently merge them.
  if v_id is null and v_provider_id is not null then
    select s.canonical_id, s.source_clean_name
      into v_existing, v_existing_name
    from public.player_registry_sources s
    where s.sport = v_sport
      and lower(coalesce(s.provider, '')) = v_provider
      and s.provider_player_id = v_provider_id
    order by s.last_seen_at desc
    limit 1;

    if v_existing is not null and not public.oblige_registry_names_compatible(v_existing_name, v_clean) then
      insert into public.player_registry_conflicts(
        sport, provider, provider_player_id, existing_canonical_id,
        incoming_source_player_id, existing_clean_name, incoming_clean_name, reason
      ) values (
        v_sport, nullif(v_provider, ''), v_provider_id, v_existing,
        p_source_player_id, v_existing_name, v_clean, 'PROVIDER_ID_NAME_COLLISION'
      )
      on conflict (
        sport,
        (coalesce(provider, '')),
        (coalesce(provider_player_id, '')),
        (coalesce(existing_canonical_id::text, '')),
        (coalesce(incoming_source_player_id, '')),
        reason
      )
      do update set
        last_seen_at = now(),
        occurrences = public.player_registry_conflicts.occurrences + 1;
    end if;
  end if;

  if v_id is null then
    insert into public.player_registry(
      sport, clean_name, display_name, team, position, headshot_url,
      espn_id, mlb_id, wnba_id, propline_id, sgo_player_id, provider_ids
    ) values (
      v_sport, v_clean, v_display, v_team, v_position, v_headshot,
      v_espn, v_mlb, v_wnba,
      case when v_provider = 'propline' then v_provider_id else null end,
      case when v_provider = 'sportsgameodds' then v_provider_id else null end,
      v_provider_json
    )
    returning canonical_id into v_id;
  else
    update public.player_registry r
    set
      clean_name = case
        when public.oblige_registry_names_compatible(r.clean_name, v_clean)
          and char_length(v_clean) < char_length(r.clean_name)
        then v_clean else r.clean_name end,
      display_name = case
        when public.oblige_registry_names_compatible(r.clean_name, v_clean)
          and char_length(v_clean) < char_length(r.clean_name)
        then v_display else r.display_name end,
      team = coalesce(v_team, r.team),
      position = coalesce(v_position, r.position),
      headshot_url = coalesce(v_headshot, r.headshot_url),
      espn_id = coalesce(r.espn_id, v_espn),
      mlb_id = coalesce(r.mlb_id, v_mlb),
      wnba_id = coalesce(r.wnba_id, v_wnba),
      propline_id = coalesce(r.propline_id, case when v_provider = 'propline' then v_provider_id end),
      sgo_player_id = coalesce(r.sgo_player_id, case when v_provider = 'sportsgameodds' then v_provider_id end),
      provider_ids = r.provider_ids || v_provider_json,
      updated_at = now(),
      last_seen_at = now()
    where r.canonical_id = v_id;
  end if;

  insert into public.player_registry_sources(
    source_player_id, canonical_id, sport, provider, provider_player_id,
    source_clean_name, source_display_name, source_team, source_headshot_url,
    first_seen_at, last_seen_at
  ) values (
    p_source_player_id, v_id, v_sport, nullif(v_provider, ''), v_provider_id,
    v_clean, v_display, v_team, v_headshot, now(), now()
  )
  on conflict (source_player_id) do update set
    canonical_id = excluded.canonical_id,
    sport = excluded.sport,
    provider = excluded.provider,
    provider_player_id = excluded.provider_player_id,
    source_clean_name = excluded.source_clean_name,
    source_display_name = excluded.source_display_name,
    source_team = excluded.source_team,
    source_headshot_url = excluded.source_headshot_url,
    last_seen_at = now();

  return v_id;
end;
$$;

create or replace function public.oblige_registry_sync_player_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.oblige_registry_upsert_player(
    new.id,
    new.sport_key,
    new.provider,
    new.provider_player_id,
    new.canonical_name,
    new.name,
    new.team,
    new.position,
    new.headshot_url
  );
  return new;
end;
$$;

drop trigger if exists oblige_registry_sync_players on public.players;
create trigger oblige_registry_sync_players
after insert or update of
  sport_key, provider, provider_player_id, canonical_name, name, team, position, headshot_url
on public.players
for each row
execute function public.oblige_registry_sync_player_trigger();

alter table public.player_registry enable row level security;
alter table public.player_registry_sources enable row level security;
alter table public.player_registry_conflicts enable row level security;

-- Registry writes/reads are backend-owned. No browser RLS policies are added.
revoke all on function public.oblige_registry_upsert_player(text,text,text,text,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.oblige_registry_sync_player_trigger() from public, anon, authenticated;
grant execute on function public.oblige_registry_upsert_player(text,text,text,text,text,text,text,text,text) to service_role;
grant execute on function public.oblige_registry_sync_player_trigger() to service_role;
