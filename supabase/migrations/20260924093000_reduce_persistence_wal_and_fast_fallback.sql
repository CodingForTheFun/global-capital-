-- Root persistence bottleneck repair for #615 / #614.
-- Preserve the public-store wire contract; optimize behind it.
-- No provider cadence, scheduler lease, freshness TTL, or customer-data change.

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



create or replace function private.autoscout_read_props_fast(p_token text, p_sport text)
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
            and coalesce(l.provider_updated_at,l.ingested_at,l.updated_at)>now()-interval '2 hours'
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

revoke all on function private.autoscout_read_props_fast(text,text) from public, anon, authenticated;


CREATE OR REPLACE FUNCTION public.autoscout_public_store(p_token text, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '30s'
AS $function$
declare n integer; v_owner text; v_source text; v_observed timestamptz;
begin
 if p_token is null or not exists(select 1 from private.autoscout_backend_tokens
  where enabled=true and token_hash=encode(extensions.digest(p_token,'sha256'),'hex')) then
  raise exception 'Unauthorized ingestion' using errcode='42501';
 end if;
 if octet_length(p_payload::text)>64000000 then raise exception 'Payload too large';end if;
 if p_action='claim' then
  perform pg_catalog.set_config('lock_timeout','2s',true);
  insert into private.autoscout_public_state(id) values('scheduler') on conflict do nothing;
  v_owner=gen_random_uuid()::text;
  update private.autoscout_public_state set owner=v_owner,lease_until=now()+interval '10 minutes',next_at=now()+pg_catalog.make_interval(secs=>greatest(30,least(300,coalesce(nullif(p_payload->>'interval_seconds','')::integer,45))))
   where id='scheduler' and next_at<=now() and lease_until<=now();
  get diagnostics n=row_count;
  return jsonb_build_object('claimed',n=1,'owner',case when n=1 then v_owner else null end);
 elsif p_action='release' then
  update private.autoscout_public_state set lease_until='-infinity' where id='scheduler' and owner=p_payload->>'owner';
 elsif p_action='status' then
  v_source=p_payload->>'source';
  if v_source is null or not (
    v_source in ('prizepicks','underdog')
    or (split_part(v_source,':',1) in ('draftkings','fanduel','pinnacle','betrivers','bvda','betmgm') and split_part(v_source,':',2) in ('NFL','NBA','WNBA','MLB','NHL','NCAAF','NCAAB','TENNIS','SOCCER'))
    
    
    
  ) then raise exception 'Invalid source';end if;
  insert into private.autoscout_public_state(id,state) values(v_source,p_payload->'state') on conflict(id) do update set state=excluded.state;
 elsif p_action='props' then
  v_source=p_payload->>'source';v_observed=(p_payload->>'observed_at')::timestamptz;
  if v_source is null or not (
    v_source in ('prizepicks','underdog')
    or (split_part(v_source,':',1) in ('draftkings','fanduel','pinnacle','betrivers','bvda','betmgm') and split_part(v_source,':',2) in ('NFL','NBA','WNBA','MLB','NHL','NCAAF','NCAAB','TENNIS','SOCCER'))
    
    
    
  ) or v_observed is null
   or v_observed>now()+interval '1 minute' or v_observed<now()-interval '15 minutes' then raise exception 'Invalid snapshot';end if;
  if jsonb_typeof(p_payload->'rows')<>'array' then raise exception 'Invalid rows';end if;
  perform pg_advisory_xact_lock(hashtext('public-ingestion:'||v_source));
  if exists(select 1 from public.active_props where source=v_source and observed_at>v_observed) then return jsonb_build_object('ignored',true);end if;
  -- Keep current rows in place; stale rows are pruned after the upsert. This
  -- avoids deleting and reinserting the full board on every refresh.
  perform 1;
  insert into public.active_props(id,source,bookmaker,sport,player_id,event_id,market,side,line,game_start_time,observed_at,expires_at,payload)
   select r->>'id',v_source,r->>'sportsbookKey',r->>'sport',r->>'playerId',r->>'eventId',r->>'marketId',r->>'side',(r->>'line')::numeric,
    (r->>'gameStartTime')::timestamptz,v_observed,least(v_observed+interval '15 minutes',(r->>'gameStartTime')::timestamptz),r
   from jsonb_array_elements(p_payload->'rows') r
   where (r->>'gameStartTime')::timestamptz>now() and r->>'isAlternate'='false'
    and r->>'sportsbookKey'=split_part(v_source,':',1)
   on conflict(id) do update set
    bookmaker=excluded.bookmaker,
    sport=excluded.sport,
    player_id=excluded.player_id,
    event_id=excluded.event_id,
    market=excluded.market,
    side=excluded.side,
    line=excluded.line,
    game_start_time=excluded.game_start_time,
    observed_at=excluded.observed_at,
    expires_at=excluded.expires_at,
    payload=excluded.payload
   where row(public.active_props.bookmaker,public.active_props.sport,public.active_props.player_id,public.active_props.event_id,public.active_props.market,public.active_props.side,public.active_props.line,public.active_props.game_start_time)
      is distinct from row(excluded.bookmaker,excluded.sport,excluded.player_id,excluded.event_id,excluded.market,excluded.side,excluded.line,excluded.game_start_time)
      or (public.active_props.payload - 'observedAt' - 'ingestedAt' - 'updatedAt' - 'providerUpdatedAt')
         is distinct from (excluded.payload - 'observedAt' - 'ingestedAt' - 'updatedAt' - 'providerUpdatedAt')
      or public.active_props.observed_at < now()-interval '8 minutes';
  get diagnostics n=row_count;
  -- Chunked snapshots keep last-good rows until every batch succeeds. The
  -- final empty call prunes rows that were not touched by this observation.
  if coalesce((p_payload->>'chunked')::boolean,false) then
    if coalesce((p_payload->>'finalize')::boolean,false) then
      -- Rows that were present but materially unchanged may intentionally keep
      -- their prior observed_at for one cycle to avoid write amplification.
      -- Preserve those recent rows here; omitted rows naturally expire after
      -- their 15-minute TTL and are pruned once they age beyond this window.
      delete from public.active_props a
       where a.source=v_source
         and a.observed_at < v_observed - interval '8 minutes';
    end if;
  else
    -- Backward-compatible atomic replacement for older callers.
    delete from public.active_props a
     where a.source=v_source
       and a.id not in (
         select r->>'id' from jsonb_array_elements(p_payload->'rows') r
         where r->>'id' is not null
       );
  end if;
  -- A chunked board may contain thousands of rows. Running the global expiry
  -- cleanup after every tiny batch multiplies index/delete work and can turn a
  -- healthy refresh into a timeout storm. Clean once when the snapshot is
  -- finalized; keep the old behavior for non-chunked callers.
  if not coalesce((p_payload->>'chunked')::boolean,false)
     or coalesce((p_payload->>'finalize')::boolean,false) then
    delete from public.active_props where expires_at<now()-interval '1 day';
  end if;
  return jsonb_build_object('written',n);
 elsif p_action='history' then
  if jsonb_array_length(p_payload->'rows')>1000 then raise exception 'History batch too large';end if;
  insert into public.player_game_logs(player_id,game_id,sport,player_name,game_date,season,category,season_type,stats)
   select r.player_id,r.game_id,r.sport,r.player_name,r.game_date,r.season,r.category,r.season_type,r.stats
   from jsonb_to_recordset(p_payload->'rows') r(player_id text,game_id text,sport text,player_name text,game_date timestamptz,season text,category text,season_type integer,stats jsonb)
   where r.sport in ('NBA','NFL','MLB') and r.player_id ~ ('^history:'||r.sport||':[0-9]+$') and r.game_date<now() and r.season_type in (2,3)
   on conflict(player_id,game_id,category) do update set stats=public.player_game_logs.stats||excluded.stats,updated_at=now()
    where public.player_game_logs.stats is distinct from public.player_game_logs.stats||excluded.stats;
  get diagnostics n=row_count;return jsonb_build_object('written',n);
 elsif p_action='history_candidates' then
  return jsonb_build_object('rows',coalesce((select jsonb_agg(x) from (
   select distinct pl.id as "playerId",pl.name as "playerName",pl.team,pl.sport_key as sport,pr.market_key as "marketId",pr.market_name as market
   from public.players pl join public.props pr on pr.player_id=pl.id join public.events e on e.id=pr.event_id
   where pl.sport_key in ('MLB','NFL','NBA') and e.commence_time>now()-interval '7 days'
   order by pl.id,pr.market_key limit 5000) x),'[]'::jsonb));
 elsif p_action='read_props' then
  return private.autoscout_read_props_fast(p_token,p_payload->>'sport');
 elsif p_action='read_history' then
  return jsonb_build_object('rows',coalesce((select jsonb_agg(x) from (select * from public.player_game_logs where player_id=p_payload->>'player_id' order by game_date desc limit 500) x),'[]'::jsonb));
 else raise exception 'Invalid operation';
 end if;
 return jsonb_build_object('ok',true);
end;
$function$



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

