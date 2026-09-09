-- Auto Scout normalized production schema.
-- Provider-owned rows are written only by the backend service role.
create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role text not null default 'USER' check (role in ('USER','PREMIUM','ADMIN','OWNER')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  tier text not null default 'free',
  status text not null default 'inactive',
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id)
);

create table if not exists public.sports (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),
  sport_id uuid not null references public.sports(id) on delete cascade,
  key text not null unique,
  name text not null,
  provider_key text,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  league_id uuid references public.leagues(id) on delete set null,
  provider text,
  provider_team_id text,
  key text,
  name text not null,
  abbreviation text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists teams_provider_identity_idx on public.teams(provider, provider_team_id) where provider_team_id is not null;
create index if not exists teams_league_idx on public.teams(league_id);

create table if not exists public.players (
  id text primary key,
  sport_key text not null,
  league_key text not null,
  provider text,
  provider_player_id text,
  canonical_name text not null,
  name text not null,
  team text,
  position text,
  headshot_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists players_sport_name_idx on public.players(sport_key, canonical_name);
create index if not exists players_provider_id_idx on public.players(provider, provider_player_id);

create table if not exists public.events (
  id text primary key,
  provider text not null,
  provider_event_id text not null,
  sport_key text not null,
  league_key text not null,
  home_team text,
  away_team text,
  commence_time timestamptz,
  status text not null default 'SCHEDULED',
  home_score numeric,
  away_score numeric,
  provider_updated_at timestamptz,
  ingested_at timestamptz not null,
  updated_at timestamptz not null default now(),
  unique(provider, provider_event_id)
);
create index if not exists events_sport_time_idx on public.events(sport_key, commence_time);
create index if not exists events_status_time_idx on public.events(status, commence_time);

create table if not exists public.bookmakers (
  key text primary key,
  name text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.markets (
  key text primary key,
  name text not null,
  sport_key text,
  period text not null default 'game',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists markets_sport_idx on public.markets(sport_key);

create table if not exists public.props (
  id text primary key,
  event_id text not null references public.events(id) on delete cascade,
  player_id text not null references public.players(id) on delete cascade,
  sport_key text not null,
  league_key text not null,
  market_key text not null,
  market_name text not null,
  period text not null default 'game',
  is_alternate boolean not null default false,
  provider text not null,
  ingested_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index if not exists props_event_idx on public.props(event_id);
create index if not exists props_player_market_idx on public.props(player_id, market_key);
create index if not exists props_sport_market_idx on public.props(sport_key, market_key);

create table if not exists public.prop_lines (
  id text primary key,
  prop_id text not null references public.props(id) on delete cascade,
  provider text not null,
  bookmaker_key text not null references public.bookmakers(key),
  side text not null check (side in ('OVER','UNDER')),
  line numeric not null,
  price integer,
  implied_probability numeric,
  deeplink text,
  provider_updated_at timestamptz,
  ingested_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index if not exists prop_lines_prop_book_side_idx on public.prop_lines(prop_id, bookmaker_key, side);
create index if not exists prop_lines_book_updated_idx on public.prop_lines(bookmaker_key, provider_updated_at desc);

create table if not exists public.line_snapshots (
  id bigint generated always as identity primary key,
  prop_id text not null references public.props(id) on delete cascade,
  bookmaker_key text not null references public.bookmakers(key),
  side text not null check (side in ('OVER','UNDER')),
  line numeric not null,
  price integer,
  provider_updated_at timestamptz,
  ingested_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(prop_id, bookmaker_key, side, line, price, provider_updated_at)
);
create index if not exists line_snapshots_history_idx on public.line_snapshots(prop_id, bookmaker_key, side, created_at desc);

create table if not exists public.player_statistics (
  id uuid primary key default gen_random_uuid(),
  player_id text not null references public.players(id) on delete cascade,
  event_id text references public.events(id) on delete set null,
  sport_key text not null,
  stat_key text not null,
  stat_value numeric,
  sample_type text,
  provider text not null,
  provider_updated_at timestamptz,
  ingested_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists player_statistics_lookup_idx on public.player_statistics(player_id, stat_key, ingested_at desc);

create table if not exists public.games (
  event_id text primary key references public.events(id) on delete cascade,
  period text,
  clock text,
  status text,
  home_score numeric,
  away_score numeric,
  provider text,
  provider_updated_at timestamptz,
  ingested_at timestamptz not null
);

create table if not exists public.injuries (
  id uuid primary key default gen_random_uuid(),
  player_id text not null references public.players(id) on delete cascade,
  event_id text references public.events(id) on delete set null,
  status text,
  detail text,
  provider text not null,
  provider_updated_at timestamptz,
  ingested_at timestamptz not null
);
create index if not exists injuries_player_idx on public.injuries(player_id, ingested_at desc);

create table if not exists public.favorites (
  user_id uuid not null references public.users(id) on delete cascade,
  prop_id text not null references public.props(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id, prop_id)
);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  prop_id text references public.props(id) on delete cascade,
  type text not null,
  condition jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  last_triggered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists alerts_user_enabled_idx on public.alerts(user_id, enabled);

create table if not exists public.saved_props (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text,
  legs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists saved_props_user_idx on public.saved_props(user_id, created_at desc);

create table if not exists public.provider_sync_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  sport_key text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'RUNNING',
  events_count integer not null default 0,
  props_count integer not null default 0,
  lines_count integer not null default 0,
  credits_used numeric,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists provider_sync_runs_recent_idx on public.provider_sync_runs(provider, started_at desc);

create table if not exists public.provider_errors (
  id bigint generated always as identity primary key,
  provider text not null,
  sport_key text,
  event_id text,
  endpoint text,
  http_status integer,
  error_code text,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists provider_errors_recent_idx on public.provider_errors(provider, created_at desc);

create table if not exists public.api_usage (
  id bigint generated always as identity primary key,
  provider text not null,
  sport_key text,
  endpoint text,
  credits numeric,
  requests_used numeric,
  requests_remaining numeric,
  created_at timestamptz not null default now()
);
create index if not exists api_usage_day_idx on public.api_usage(provider, created_at desc);

-- Baseline league rows. Sports/league tables are descriptive; the normalized feed remains authoritative.
insert into public.sports(key,name) values
 ('NFL','Football'),('NBA','Basketball'),('WNBA','Basketball'),('MLB','Baseball'),('NHL','Hockey'),('NCAAF','College Football'),('NCAAB','College Basketball')
on conflict (key) do nothing;

-- RLS: browser users may read market data but may never mutate provider-owned data.
alter table public.users enable row level security;
alter table public.subscriptions enable row level security;
alter table public.sports enable row level security;
alter table public.leagues enable row level security;
alter table public.teams enable row level security;
alter table public.players enable row level security;
alter table public.events enable row level security;
alter table public.bookmakers enable row level security;
alter table public.markets enable row level security;
alter table public.props enable row level security;
alter table public.prop_lines enable row level security;
alter table public.line_snapshots enable row level security;
alter table public.player_statistics enable row level security;
alter table public.games enable row level security;
alter table public.injuries enable row level security;
alter table public.favorites enable row level security;
alter table public.alerts enable row level security;
alter table public.saved_props enable row level security;
alter table public.provider_sync_runs enable row level security;
alter table public.provider_errors enable row level security;
alter table public.api_usage enable row level security;

create policy "users read own profile" on public.users for select to authenticated using (auth.uid() = id);
create policy "users update own profile" on public.users for update to authenticated using (auth.uid() = id) with check (auth.uid() = id and role = (select u.role from public.users u where u.id = auth.uid()));
create policy "users read own subscription" on public.subscriptions for select to authenticated using (auth.uid() = user_id);

create policy "authenticated read sports" on public.sports for select to authenticated using (true);
create policy "authenticated read leagues" on public.leagues for select to authenticated using (true);
create policy "authenticated read teams" on public.teams for select to authenticated using (true);
create policy "authenticated read players" on public.players for select to authenticated using (true);
create policy "authenticated read events" on public.events for select to authenticated using (true);
create policy "authenticated read bookmakers" on public.bookmakers for select to authenticated using (true);
create policy "authenticated read markets" on public.markets for select to authenticated using (true);
create policy "authenticated read props" on public.props for select to authenticated using (true);
create policy "authenticated read prop lines" on public.prop_lines for select to authenticated using (true);
create policy "authenticated read line snapshots" on public.line_snapshots for select to authenticated using (true);
create policy "authenticated read player stats" on public.player_statistics for select to authenticated using (true);
create policy "authenticated read games" on public.games for select to authenticated using (true);
create policy "authenticated read injuries" on public.injuries for select to authenticated using (true);

create policy "users manage own favorites" on public.favorites for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users manage own alerts" on public.alerts for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users manage own saved props" on public.saved_props for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- No browser policies are created for provider_sync_runs, provider_errors, or api_usage.
-- The backend service role bypasses RLS and owns all provider writes.
