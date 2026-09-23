-- Canonical cross-provider player identity registry for ObligeProps.
-- Existing public.players rows remain provider-owned source records.
-- The registry joins those source identities without changing props/player FKs.

create table if not exists public.player_registry (
  canonical_id uuid primary key default gen_random_uuid(),
  sport varchar(32) not null,
  clean_name varchar(128) not null,
  display_name varchar(128) not null,
  team varchar(128),
  position varchar(64),
  headshot_url text,
  espn_id varchar(64),
  mlb_id varchar(64),
  wnba_id varchar(64),
  propline_id varchar(128),
  sgo_player_id varchar(128),
  provider_ids jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists player_registry_sport_name_idx
  on public.player_registry(sport, clean_name);
create index if not exists player_registry_sport_team_idx
  on public.player_registry(sport, team);
create index if not exists player_registry_espn_idx
  on public.player_registry(sport, espn_id) where espn_id is not null;
create index if not exists player_registry_mlb_idx
  on public.player_registry(sport, mlb_id) where mlb_id is not null;
create index if not exists player_registry_wnba_idx
  on public.player_registry(sport, wnba_id) where wnba_id is not null;
create index if not exists player_registry_propline_idx
  on public.player_registry(sport, propline_id) where propline_id is not null;
create index if not exists player_registry_sgo_idx
  on public.player_registry(sport, sgo_player_id) where sgo_player_id is not null;

create table if not exists public.player_registry_sources (
  source_player_id text primary key references public.players(id) on delete cascade,
  canonical_id uuid not null references public.player_registry(canonical_id) on delete cascade,
  sport varchar(32) not null,
  provider varchar(64),
  provider_player_id varchar(128),
  source_clean_name varchar(128) not null,
  source_display_name varchar(128) not null,
  source_team varchar(128),
  source_headshot_url text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists player_registry_sources_canonical_idx
  on public.player_registry_sources(canonical_id);
create index if not exists player_registry_sources_provider_idx
  on public.player_registry_sources(sport, provider, provider_player_id)
  where provider_player_id is not null;
create index if not exists player_registry_sources_name_idx
  on public.player_registry_sources(sport, source_clean_name);

create table if not exists public.player_registry_conflicts (
  id bigint generated always as identity primary key,
  sport varchar(32) not null,
  provider varchar(64),
  provider_player_id varchar(128),
  existing_canonical_id uuid references public.player_registry(canonical_id) on delete set null,
  incoming_source_player_id text,
  existing_clean_name varchar(128),
  incoming_clean_name varchar(128),
  reason text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  occurrences integer not null default 1
);

create unique index if not exists player_registry_conflict_identity_idx
  on public.player_registry_conflicts(
    sport,
    coalesce(provider, ''),
    coalesce(provider_player_id, ''),
    coalesce(existing_canonical_id::text, ''),
    coalesce(incoming_source_player_id, ''),
    reason
  );

create or replace function public.oblige_registry_clean_name(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(
    regexp_replace(lower(trim(coalesce(p_value, ''))), '[[:space:]]+', ' ', 'g'),
    ''
  );
$$;

create or replace function public.oblige_registry_names_compatible(p_left text, p_right text)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_left text := public.oblige_registry_clean_name(p_left);
  v_right text := public.oblige_registry_clean_name(p_right);
  v_extra text;
begin
  if v_left is null or v_right is null then return false; end if;
  if v_left = v_right then return true; end if;

  if v_left like v_right || ' %' then
    v_extra := substr(v_left, char_length(v_right) + 2);
    if v_extra !~ '[[:space:]]' and char_length(v_extra) between 2 and 4 then return true; end if;
  end if;

  if v_right like v_left || ' %' then
    v_extra := substr(v_right, char_length(v_left) + 2);
    if v_extra !~ '[[:space:]]' and char_length(v_extra) between 2 and 4 then return true; end if;
  end if;

  return false;
end;
$$;

