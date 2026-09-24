-- Root persistence bottleneck repair for #615 / #614.
-- 1) Stop periodic no-change prop_lines rewrites that amplify WAL/checkpoints.
-- 2) Add a sport-first fallback read that never ranks the whole line table.
-- 3) Tighten table-local autovacuum thresholds for the write-heavy canonical tables.

CREATE OR REPLACE FUNCTION public.autoscout_ingest_board(p_token text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'extensions', 'pg_temp'
 SET statement_timeout TO '15s'
AS $function$
declare
  v_events int := 0;
  v_players int := 0;
  v_props int := 0;
  v_lines int := 0;
  v_snapshots int := 0;
begin
  if p_token is null or not exists (
    select 1 from private.autoscout_backend_tokens
    where enabled = true and token_hash = encode(digest(p_token, 'sha256'), 'hex')
  ) then
    raise exception 'unauthorized backend ingest' using errcode = '42501';
  end if;

  insert into public.bookmakers(key,name,updated_at)
  select x.key, coalesce(nullif(x.name,''), x.key), coalesce(x.updated_at, now())
  from jsonb_to_recordset(coalesce(p_payload->'bookmakers','[]'::jsonb)) as x(key text,name text,updated_at timestamptz)
  where x.key is not null
  on conflict (key) do update set name=excluded.name, updated_at=excluded.updated_at
  where public.bookmakers.name is distinct from excluded.name;

  insert into public.markets(key,name,sport_key,period,updated_at)
  select x.key, coalesce(nullif(x.name,''),x.key), x.sport_key, coalesce(nullif(x.period,''),'game'), coalesce(x.updated_at,now())
  from jsonb_to_recordset(coalesce(p_payload->'markets','[]'::jsonb)) as x(key text,name text,sport_key text,period text,updated_at timestamptz)
  where x.key is not null
  on conflict (key) do update set name=excluded.name,sport_key=excluded.sport_key,period=excluded.period,updated_at=excluded.updated_at
  where row(public.markets.name, public.markets.sport_key, public.markets.period)
    is distinct from row(excluded.name, excluded.sport_key, excluded.period);

  insert into public.events(id,provider,provider_event_id,sport_key,league_key,home_team,away_team,commence_time,status,home_score,away_score,provider_updated_at,ingested_at,updated_at)
  select x.id,x.provider,x.provider_event_id,x.sport_key,x.league_key,x.home_team,x.away_team,x.commence_time,coalesce(x.status,'SCHEDULED'),x.home_score,x.away_score,x.provider_updated_at,x.ingested_at,coalesce(x.updated_at,now())
  from jsonb_to_recordset(coalesce(p_payload->'events','[]'::jsonb)) as x(id text,provider text,provider_event_id text,sport_key text,league_key text,home_team text,away_team text,commence_time timestamptz,status text,home_score numeric,away_score numeric,provider_updated_at timestamptz,ingested_at timestamptz,updated_at timestamptz)
  where x.id is not null
  on conflict (id) do update set home_team=excluded.home_team,away_team=excluded.away_team,commence_time=excluded.commence_time,status=excluded.status,home_score=excluded.home_score,away_score=excluded.away_score,provider_updated_at=excluded.provider_updated_at,ingested_at=excluded.ingested_at,updated_at=excluded.updated_at
  where row(public.events.home_team, public.events.away_team, public.events.commence_time, public.events.status, public.events.home_score, public.events.away_score, public.events.provider_updated_at)
    is distinct from row(excluded.home_team, excluded.away_team, excluded.commence_time, excluded.status, excluded.home_score, excluded.away_score, excluded.provider_updated_at);
  get diagnostics v_events = row_count;

  insert into public.players(id,sport_key,league_key,provider,provider_player_id,canonical_name,name,team,position,headshot_url,updated_at)
  select x.id,x.sport_key,x.league_key,x.provider,x.provider_player_id,x.canonical_name,x.name,x.team,x.position,x.headshot_url,coalesce(x.updated_at,now())
  from jsonb_to_recordset(coalesce(p_payload->'players','[]'::jsonb)) as x(id text,sport_key text,league_key text,provider text,provider_player_id text,canonical_name text,name text,team text,position text,headshot_url text,updated_at timestamptz)
  where x.id is not null
  on conflict (id) do update set canonical_name=excluded.canonical_name,name=excluded.name,team=coalesce(excluded.team,public.players.team),position=coalesce(excluded.position,public.players.position),headshot_url=coalesce(excluded.headshot_url,public.players.headshot_url),updated_at=excluded.updated_at
  where row(public.players.canonical_name, public.players.name, public.players.team, public.players.position, public.players.headshot_url)
    is distinct from row(excluded.canonical_name, excluded.name, coalesce(excluded.team,public.players.team), coalesce(excluded.position,public.players.position), coalesce(excluded.headshot_url,public.players.headshot_url));
  get diagnostics v_players = row_count;

  insert into public.props(id,event_id,player_id,sport_key,league_key,market_key,market_name,period,is_alternate,provider,ingested_at,updated_at)
  select x.id,x.event_id,x.player_id,x.sport_key,x.league_key,x.market_key,x.market_name,coalesce(x.period,'game'),coalesce(x.is_alternate,false),x.provider,x.ingested_at,coalesce(x.updated_at,now())
  from jsonb_to_recordset(coalesce(p_payload->'props','[]'::jsonb)) as x(id text,event_id text,player_id text,sport_key text,league_key text,market_key text,market_name text,period text,is_alternate boolean,provider text,ingested_at timestamptz,updated_at timestamptz)
  where x.id is not null
  on conflict (id) do update set market_name=excluded.market_name,is_alternate=excluded.is_alternate,ingested_at=excluded.ingested_at,updated_at=excluded.updated_at
  where row(public.props.market_name, public.props.is_alternate)
    is distinct from row(excluded.market_name, excluded.is_alternate);
  get diagnostics v_props = row_count;

  insert into public.prop_lines(id,prop_id,provider,bookmaker_key,side,line,price,implied_probability,deeplink,provider_updated_at,ingested_at,updated_at)
  select x.id,x.prop_id,x.provider,x.bookmaker_key,x.side,x.line,x.price,x.implied_probability,x.deeplink,x.provider_updated_at,x.ingested_at,coalesce(x.updated_at,now())
  from jsonb_to_recordset(coalesce(p_payload->'lines','[]'::jsonb)) as x(id text,prop_id text,provider text,bookmaker_key text,side text,line numeric,price integer,implied_probability numeric,deeplink text,provider_updated_at timestamptz,ingested_at timestamptz,updated_at timestamptz)
  where x.id is not null
  on conflict (id) do update set line=excluded.line,price=excluded.price,implied_probability=excluded.implied_probability,deeplink=excluded.deeplink,provider_updated_at=excluded.provider_updated_at,ingested_at=excluded.ingested_at,updated_at=excluded.updated_at
  where row(public.prop_lines.line, public.prop_lines.price, public.prop_lines.implied_probability, public.prop_lines.deeplink)
    is distinct from row(excluded.line, excluded.price, excluded.implied_probability, excluded.deeplink);
  get diagnostics v_lines = row_count;

  insert into public.line_snapshots(prop_id,bookmaker_key,side,line,price,provider_updated_at,ingested_at)
  select x.prop_id,x.bookmaker_key,x.side,x.line,x.price,x.provider_updated_at,x.ingested_at
  from jsonb_to_recordset(coalesce(p_payload->'snapshots','[]'::jsonb)) as x(prop_id text,bookmaker_key text,side text,line numeric,price integer,provider_updated_at timestamptz,ingested_at timestamptz)
  where x.prop_id is not null
  on conflict do nothing;
  get diagnostics v_snapshots = row_count;

  return jsonb_build_object('ok',true,'events',v_events,'players',v_players,'props',v_props,'lines',v_lines,'snapshots',v_snapshots);
end;
$function$



create or replace function public.autoscout_read_props_fast(p_token text, p_sport text)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_sport text := upper(trim(coalesce(p_sport,'')));
begin
  if p_token is null or not exists (
    select 1 from private.autoscout_backend_tokens
    where enabled = true
      and token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  ) then
    raise exception 'Unauthorized ingestion' using errcode='42501';
  end if;
  if v_sport = '' or length(v_sport) > 32 then
    raise exception 'Invalid sport';
  end if;

  if exists (
    select 1 from public.active_props
    where sport = v_sport and expires_at > now()
  ) then
    return jsonb_build_object(
      'rows', coalesce((
        select jsonb_agg(a.payload)
        from public.active_props a
        where a.sport = v_sport and a.expires_at > now()
      ), '[]'::jsonb),
      'source','active-public',
      'stale',false
    );
  end if;

  return jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(q.payload)
      from (
        select jsonb_build_object(
          'schemaVersion',1,
          'id',pl.id,
          'source','Stored last-good cache',
          'provider',pl.provider,
          'sport',pr.sport_key,
          'eventId',e.id,
          'playerId',p.id,
          'providerPlayerId',p.provider_player_id,
          'playerName',p.name,
          'team',coalesce(p.team,''),
          'position',coalesce(p.position,''),
          'statId','',
          'marketId',pr.market_key,
          'market',pr.market_name,
          'period',pr.period,
          'side',pl.side,
          'line',pl.line,
          'price',pl.price,
          'impliedProbability',pl.implied_probability,
          'sportsbook',coalesce(b.name,pl.bookmaker_key),
          'sportsbookKey',pl.bookmaker_key,
          'fairOdds','',
          'fairLine',null,
          'consensusLine',null,
          'gameStartTime',e.commence_time,
          'homeTeam',coalesce(e.home_team,''),
          'awayTeam',coalesce(e.away_team,''),
          'homeScore',e.home_score,
          'awayScore',e.away_score,
          'live',false,
          'started',false,
          'completed',false,
          'isAlternate',false,
          'providerUpdatedAt',coalesce(pl.provider_updated_at,pl.ingested_at,pl.updated_at),
          'ingestedAt',pl.ingested_at,
          'updatedAt',pl.updated_at,
          'deeplink',coalesce(pl.deeplink,''),
          'cacheFallback',true
        ) as payload
        from public.events e
        join public.props pr on pr.event_id=e.id
        join public.players p on p.id=pr.player_id
        cross join lateral (
          select distinct on (l.bookmaker_key,l.side)
            l.id,l.provider,l.bookmaker_key,l.side,l.line,l.price,l.implied_probability,
            l.deeplink,l.provider_updated_at,l.ingested_at,l.updated_at
          from public.prop_lines l
          where l.prop_id=pr.id
            and l.side in ('OVER','UNDER')
            and l.line is not null
          order by l.bookmaker_key,l.side,
            coalesce(l.provider_updated_at,l.ingested_at,l.updated_at) desc,
            l.updated_at desc
        ) pl
        left join public.bookmakers b on b.key=pl.bookmaker_key
        where pr.sport_key=v_sport
          and e.commence_time>now()
          and pr.is_alternate=false
          and pr.period='game'
          and p.name is not null
          and pr.market_key !~ '(_q[1-4]|_h[12])$'
        order by e.commence_time,p.name,pr.market_key,pl.bookmaker_key,pl.side
        limit 5000
      ) q
    ), '[]'::jsonb),
    'source','canonical-last-good',
    'stale',true,
    'maxAgeMinutes',120,
    'generatedAt',now()
  );
end;
$function$;

revoke all on function public.autoscout_read_props_fast(text,text) from public;
grant execute on function public.autoscout_read_props_fast(text,text) to anon, authenticated, service_role;



-- Keep vacuum/analyze ahead of high-churn canonical tables instead of waiting
-- for the cluster-wide 20%/10% defaults. These settings are table-local and
-- reversible; they do not change provider cadence, TTLs, or customer data.
alter table public.prop_lines set (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_threshold = 5000,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_analyze_threshold = 5000
);
alter table public.props set (
  autovacuum_vacuum_scale_factor = 0.03,
  autovacuum_vacuum_threshold = 2000,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_analyze_threshold = 2000
);
alter table public.players set (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 500,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_analyze_threshold = 500
);
alter table public.events set (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 250,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_analyze_threshold = 250
);
alter table public.player_game_logs set (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 1000,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_analyze_threshold = 1000
);

