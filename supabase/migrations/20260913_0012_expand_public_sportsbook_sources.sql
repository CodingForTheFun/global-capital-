-- Extend the existing token-protected public snapshot RPC to the additional
-- zero-credit sportsbook collectors. This changes only the source allowlist;
-- write validation, freshness checks and fail-closed row filters are preserved.
create or replace function public.autoscout_public_store(
  p_token text,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare n integer; v_owner text; v_source text; v_observed timestamptz;
begin
 if p_token is null or not exists(select 1 from private.autoscout_backend_tokens
  where enabled=true and token_hash=encode(extensions.digest(p_token,'sha256'),'hex')) then
  raise exception 'Unauthorized ingestion' using errcode='42501';
 end if;
 if octet_length(p_payload::text)>64000000 then raise exception 'Payload too large';end if;
 if p_action='claim' then
  insert into private.autoscout_public_state(id) values('scheduler') on conflict do nothing;
  v_owner=gen_random_uuid()::text;
  update private.autoscout_public_state set owner=v_owner,lease_until=now()+interval '5 minutes',next_at=now()+interval '150 seconds'
   where id='scheduler' and next_at<=now() and lease_until<=now();
  get diagnostics n=row_count;
  return jsonb_build_object('claimed',n=1,'owner',case when n=1 then v_owner else null end);
 elsif p_action='release' then
  update private.autoscout_public_state set lease_until='-infinity' where id='scheduler' and owner=p_payload->>'owner';
 elsif p_action='status' then
  v_source=p_payload->>'source';
  if not (
    v_source in ('prizepicks','underdog')
    or (split_part(v_source,':',1)='draftkings' and split_part(v_source,':',2) in ('NFL','NBA','WNBA','MLB','NHL','NCAAF','NCAAB','TENNIS'))
    or (split_part(v_source,':',1) in ('fanduel','pinnacle') and split_part(v_source,':',2) in ('NFL','NBA','WNBA','MLB','NHL','NCAAF','NCAAB','TENNIS'))
  ) then raise exception 'Invalid source';end if;
  insert into private.autoscout_public_state(id,state) values(v_source,p_payload->'state') on conflict(id) do update set state=excluded.state;
 elsif p_action='props' then
  v_source=p_payload->>'source';v_observed=(p_payload->>'observed_at')::timestamptz;
  if not (
    v_source in ('prizepicks','underdog')
    or (split_part(v_source,':',1)='draftkings' and split_part(v_source,':',2) in ('NFL','NBA','WNBA','MLB','NHL','NCAAF','NCAAB','TENNIS'))
    or (split_part(v_source,':',1) in ('fanduel','pinnacle') and split_part(v_source,':',2) in ('NFL','NBA','WNBA','MLB','NHL','NCAAF','NCAAB','TENNIS'))
  ) or v_observed is null
   or v_observed>now()+interval '1 minute' or v_observed<now()-interval '5 minutes' then raise exception 'Invalid snapshot';end if;
  if jsonb_typeof(p_payload->'rows')<>'array' then raise exception 'Invalid rows';end if;
  perform pg_advisory_xact_lock(hashtext('public-ingestion:'||v_source));
  if exists(select 1 from public.active_props where source=v_source and observed_at>v_observed) then return jsonb_build_object('ignored',true);end if;
  delete from public.active_props where source=v_source;
  insert into public.active_props(id,source,bookmaker,sport,player_id,event_id,market,side,line,game_start_time,observed_at,expires_at,payload)
   select r->>'id',v_source,r->>'sportsbookKey',r->>'sport',r->>'playerId',r->>'eventId',r->>'marketId',r->>'side',(r->>'line')::numeric,
    (r->>'gameStartTime')::timestamptz,v_observed,least(v_observed+interval '10 minutes',(r->>'gameStartTime')::timestamptz),r
   from jsonb_array_elements(p_payload->'rows') r
   where (r->>'gameStartTime')::timestamptz>now() and r->>'isAlternate'='false'
    and r->>'sportsbookKey'=split_part(v_source,':',1)
   on conflict(id) do update set observed_at=excluded.observed_at,expires_at=excluded.expires_at,payload=excluded.payload;
  get diagnostics n=row_count;
  delete from public.active_props where expires_at<now()-interval '1 day';
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
  if exists(select 1 from public.active_props where sport=upper(p_payload->>'sport') and expires_at>now()) then
   return jsonb_build_object('rows',coalesce((select jsonb_agg(payload) from public.active_props where sport=upper(p_payload->>'sport') and expires_at>now()),'[]'::jsonb),'source','active-public','stale',false);
  end if;
  return jsonb_build_object(
   'rows',coalesce((select jsonb_agg(q.payload) from (
    with ranked as (
     select pl.*,row_number() over(partition by pl.prop_id,pl.bookmaker_key,pl.side order by coalesce(pl.provider_updated_at,pl.ingested_at,pl.updated_at) desc,pl.updated_at desc) rn
     from public.prop_lines pl
     join public.props pr0 on pr0.id=pl.prop_id
     join public.events e0 on e0.id=pr0.event_id
     where pr0.sport_key=upper(p_payload->>'sport')
      and pr0.is_alternate=false and pr0.period='game'
      and e0.commence_time>now()
      and coalesce(pl.provider_updated_at,pl.ingested_at,pl.updated_at)>now()-interval '2 hours'
      and pl.side in ('OVER','UNDER') and pl.line is not null
    )
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
    from ranked pl
    join public.props pr on pr.id=pl.prop_id
    join public.events e on e.id=pr.event_id
    join public.players p on p.id=pr.player_id
    left join public.bookmakers b on b.key=pl.bookmaker_key
    where pl.rn=1 and p.name is not null and pr.market_key !~ '(_q[1-4]|_h[12])$'
    order by e.commence_time,p.name,pr.market_key,pl.bookmaker_key,pl.side
    limit 5000
   ) q),'[]'::jsonb),
   'source','canonical-last-good','stale',true,'maxAgeMinutes',120,'generatedAt',now());
 elsif p_action='read_history' then
  return jsonb_build_object('rows',coalesce((select jsonb_agg(x) from (select * from public.player_game_logs where player_id=p_payload->>'player_id' order by game_date desc limit 500) x),'[]'::jsonb));
 else raise exception 'Invalid operation';
 end if;
 return jsonb_build_object('ok',true);
end;
$function$;
