-- Zero-credit Auto Scout ingestion storage. Additive only; no existing tables are dropped.
create table if not exists public.active_props (
  id text primary key,
  player_id text not null references public.players(id) on delete cascade,
  book_id text not null,
  stat_type text not null,
  target_line numeric not null,
  over_odds integer,
  under_odds integer,
  event_id text references public.events(id) on delete cascade,
  sport text not null,
  source_id text,
  is_alternate boolean not null default false,
  promotion jsonb,
  updated_at timestamptz,
  ingested_at timestamptz not null default now()
);
create index if not exists active_props_player_market_idx on public.active_props(player_id,stat_type);
create index if not exists active_props_sport_updated_idx on public.active_props(sport,updated_at desc);
create index if not exists active_props_event_idx on public.active_props(event_id);

create table if not exists public.player_game_logs (
  id text primary key,
  player_id text not null references public.players(id) on delete cascade,
  game_id text not null,
  game_date timestamptz not null,
  opponent text,
  opponent_id text,
  team text,
  is_home boolean,
  started boolean,
  score_for numeric,
  score_against numeric,
  game_result text,
  season integer,
  season_type integer,
  source text not null default 'espn',
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(player_id,game_id)
);
create index if not exists player_game_logs_player_date_idx on public.player_game_logs(player_id,game_date desc);
create index if not exists player_game_logs_player_opponent_idx on public.player_game_logs(player_id,opponent,game_date desc);

create table if not exists public.prop_trends (
  prop_id text primary key references public.active_props(id) on delete cascade,
  player_id text not null references public.players(id) on delete cascade,
  stat_type text not null,
  target_line numeric not null,
  l5_hit_rate numeric,
  l10_hit_rate numeric,
  l15_hit_rate numeric,
  season_hit_rate numeric,
  h2h_hit_rate numeric,
  season_average numeric,
  active_streak integer,
  over_probability numeric,
  under_probability numeric,
  sample_size integer not null default 0,
  data_quality text not null default 'UNAVAILABLE' check (data_quality in ('HIGH','MEDIUM','LOW','UNAVAILABLE')),
  calculated_at timestamptz not null default now()
);
create index if not exists prop_trends_player_market_idx on public.prop_trends(player_id,stat_type);

alter table public.active_props add column if not exists is_alternate boolean not null default false;
alter table public.active_props add column if not exists promotion jsonb;
alter table public.active_props add column if not exists ingested_at timestamptz not null default now();

-- Projection-only context is never exposed as a sportsbook price.
create table if not exists public.sleeper_projections (
  id text primary key,
  player_id text,
  provider_player_id text not null,
  player_name text not null,
  sport text not null,
  stat_type text not null,
  projection numeric not null,
  season integer,
  week integer,
  team text,
  updated_at timestamptz not null default now()
);
create index if not exists sleeper_projections_player_idx on public.sleeper_projections(provider_player_id,week);

create or replace function public.autoscout_safe_numeric(value text)
returns numeric language sql immutable as $$
  select case when value ~ '^-?[0-9]+(?:\.[0-9]+)?$' then value::numeric else null end
$$;

create or replace function public.autoscout_stat_value(p_stats jsonb, p_stat text)
returns numeric language plpgsql immutable as $$
declare s text := lower(coalesce(p_stat,'')); v numeric;
begin
  if s ~ 'points.*rebounds.*assists|\bpra\b' then
    return coalesce(public.autoscout_safe_numeric(p_stats->>'points'),0)+coalesce(public.autoscout_safe_numeric(p_stats->>'rebounds'),0)+coalesce(public.autoscout_safe_numeric(p_stats->>'assists'),0);
  elsif s ~ 'points.*rebounds|\bpr\b' then return coalesce(public.autoscout_safe_numeric(p_stats->>'points'),0)+coalesce(public.autoscout_safe_numeric(p_stats->>'rebounds'),0);
  elsif s ~ 'points.*assists|\bpa\b' then return coalesce(public.autoscout_safe_numeric(p_stats->>'points'),0)+coalesce(public.autoscout_safe_numeric(p_stats->>'assists'),0);
  elsif s ~ 'rebounds.*assists|\bra\b' then return coalesce(public.autoscout_safe_numeric(p_stats->>'rebounds'),0)+coalesce(public.autoscout_safe_numeric(p_stats->>'assists'),0);
  elsif s ~ 'pass.*yard' then return public.autoscout_safe_numeric(p_stats->>'passingYards');
  elsif s ~ 'pass.*touch|pass.*td' then return public.autoscout_safe_numeric(p_stats->>'passingTouchdowns');
  elsif s ~ 'pass.*attempt' then return public.autoscout_safe_numeric(p_stats->>'passingAttempts');
  elsif s ~ 'pass.*complet' then return public.autoscout_safe_numeric(p_stats->>'passingCompletions');
  elsif s ~ 'rush.*yard' then return public.autoscout_safe_numeric(p_stats->>'rushingYards');
  elsif s ~ 'rush.*attempt' then return public.autoscout_safe_numeric(p_stats->>'rushingAttempts');
  elsif s ~ 'receiv.*yard' then return public.autoscout_safe_numeric(p_stats->>'receivingYards');
  elsif s ~ 'reception' then return public.autoscout_safe_numeric(p_stats->>'receptions');
  elsif s ~ 'target' then return public.autoscout_safe_numeric(p_stats->>'targets');
  elsif s ~ 'strikeout|\bk\b' then return public.autoscout_safe_numeric(p_stats->>'strikeouts');
  elsif s ~ 'total.*base' then return public.autoscout_safe_numeric(p_stats->>'totalBases');
  elsif s ~ 'home.*run|\bhr\b' then return public.autoscout_safe_numeric(p_stats->>'homeRuns');
  elsif s ~ 'rbi|runs.*batted' then return public.autoscout_safe_numeric(p_stats->>'runsBattedIn');
  elsif s ~ 'hit.*allowed|\bha\b' then return public.autoscout_safe_numeric(p_stats->>'hitsAllowed');
  elsif s ~ 'earned.*run|\ber\b' then return public.autoscout_safe_numeric(p_stats->>'earnedRuns');
  elsif s ~ 'walk' then return coalesce(public.autoscout_safe_numeric(p_stats->>'walksAllowed'),public.autoscout_safe_numeric(p_stats->>'walks'));
  elsif s ~ 'tackle' then return public.autoscout_safe_numeric(p_stats->>'tacklesAssists');
  elsif s ~ 'three|3pm' then return coalesce(public.autoscout_safe_numeric(p_stats->>'threes'),public.autoscout_safe_numeric(p_stats->>'threePointersMade'));
  elsif s ~ 'rebound' then return public.autoscout_safe_numeric(p_stats->>'rebounds');
  elsif s ~ 'assist' then return public.autoscout_safe_numeric(p_stats->>'assists');
  elsif s ~ 'point' then return public.autoscout_safe_numeric(p_stats->>'points');
  elsif s ~ 'shot' then return public.autoscout_safe_numeric(p_stats->>'shotsOnGoal');
  elsif s ~ 'save' then return public.autoscout_safe_numeric(p_stats->>'saves');
  elsif s ~ 'goal' then return public.autoscout_safe_numeric(p_stats->>'goals');
  elsif s ~ 'hit' then return public.autoscout_safe_numeric(p_stats->>'hits');
  end if;
  return null;
end $$;

create or replace function public.autoscout_refresh_prop_trend(p_prop_id text)
returns void language plpgsql security definer set search_path=public as $$
declare p public.active_props%rowtype; opp text; total integer; avg_value numeric; streak_value integer := 0;
begin
 select * into p from public.active_props where id=p_prop_id;
 if not found or p.is_alternate then return; end if;
 select case when e.home_team=pl.team then e.away_team else e.home_team end into opp from public.events e left join public.players pl on pl.id=p.player_id where e.id=p.event_id;
 with valueset as (
   select g.game_date,g.opponent,public.autoscout_stat_value(g.stats,p.stat_type) value
   from public.player_game_logs g where g.player_id=p.player_id
 ), usable as (select * from valueset where value is not null order by game_date desc),
 rates as (
   select count(*) total,avg(value) avg_value,
    100.0*count(*) filter(where value>p.target_line)/nullif(count(*),0) season_over,
    100.0*count(*) filter(where value<p.target_line)/nullif(count(*),0) season_under,
    100.0*count(*) filter(where value>p.target_line and rn<=5)/nullif(count(*) filter(where rn<=5),0) l5,
    100.0*count(*) filter(where value>p.target_line and rn<=10)/nullif(count(*) filter(where rn<=10),0) l10,
    100.0*count(*) filter(where value>p.target_line and rn<=15)/nullif(count(*) filter(where rn<=15),0) l15,
    100.0*count(*) filter(where value>p.target_line and upper(coalesce(opponent,''))=upper(coalesce(opp,'')))/nullif(count(*) filter(where upper(coalesce(opponent,''))=upper(coalesce(opp,''))),0) h2h
   from (select *,row_number() over(order by game_date desc) rn from usable) q
 )
 select total,avg_value from rates into total,avg_value;
 select count(*) into streak_value from (
   select value,row_number() over(order by game_date desc) rn,
          sum(case when value>p.target_line then 0 else 1 end) over(order by game_date desc) stop
   from usable
 ) x where stop=0;
 insert into public.prop_trends(prop_id,player_id,stat_type,target_line,l5_hit_rate,l10_hit_rate,l15_hit_rate,season_hit_rate,h2h_hit_rate,season_average,active_streak,over_probability,under_probability,sample_size,data_quality,calculated_at)
 select p.id,p.player_id,p.stat_type,p.target_line,r.l5,r.l10,r.l15,r.season_over,r.h2h,r.avg_value,streak_value,r.season_over,r.season_under,r.total,
   case when r.total>=15 then 'HIGH' when r.total>=8 then 'MEDIUM' when r.total>=3 then 'LOW' else 'UNAVAILABLE' end,now() from rates r
 on conflict(prop_id) do update set target_line=excluded.target_line,l5_hit_rate=excluded.l5_hit_rate,l10_hit_rate=excluded.l10_hit_rate,l15_hit_rate=excluded.l15_hit_rate,season_hit_rate=excluded.season_hit_rate,h2h_hit_rate=excluded.h2h_hit_rate,season_average=excluded.season_average,active_streak=excluded.active_streak,over_probability=excluded.over_probability,under_probability=excluded.under_probability,sample_size=excluded.sample_size,data_quality=excluded.data_quality,calculated_at=excluded.calculated_at;
end $$;

create or replace function public.autoscout_active_prop_trend_trigger()
returns trigger language plpgsql as $$ begin perform public.autoscout_refresh_prop_trend(new.id); return new; end $$;
drop trigger if exists active_props_refresh_trend on public.active_props;
create trigger active_props_refresh_trend after insert or update of target_line on public.active_props for each row execute function public.autoscout_active_prop_trend_trigger();

alter table public.active_props enable row level security;
alter table public.player_game_logs enable row level security;
alter table public.prop_trends enable row level security;
alter table public.sleeper_projections enable row level security;
