-- Isolated, opt-in maintenance. No changes to live RPCs, leases, polling, or tables.
-- The existing backend ingest-token boundary is retained. Public callers cannot
-- inspect coverage or insert records without that token.
create or replace function public.autoscout_verified_history_maintenance(
  p_token text, p_action text, p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer
set search_path = '' set statement_timeout = '8s' set lock_timeout = '1s'
as $function$
declare
  result jsonb;
  n integer;
  canonical_sport text;
  candidate_name text;
  candidate_sport text;
  allowed_sports constant text[] := array['NBA','NFL','MLB','WNBA','NCAAF','NHL','NCAAB','MLS','EPL','UCL','SOCCER'];
begin
  if p_token is null or not exists (
    select 1 from private.autoscout_backend_tokens
    where enabled = true and token_hash = encode(extensions.digest(p_token,'sha256'),'hex')
  ) then raise exception 'Unauthorized ingestion' using errcode='42501'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or octet_length(p_payload::text) > 2000000 then raise exception 'Invalid maintenance payload'; end if;
  -- Fail closed before dispatch. SQL NOT IN yields NULL for a NULL action,
  -- which must never be allowed to fall through to the writer path.
  if p_action is null or p_action not in ('snapshot','read_keys','insert_verified') then
    raise exception 'Invalid maintenance operation';
  end if;

  if p_action = 'snapshot' then
    -- No legacy players/props/events join: this is the actual non-expired board.
    -- All raw sport labels and non-player/unsupported scopes remain visible.
    if (select count(*) from public.active_props where expires_at > statement_timestamp()) > 100000
      or (select count(*) from public.player_game_logs) > 2000000 then
      raise exception 'Maintenance snapshot bound exceeded';
    end if;
    with active as (
      select distinct sport, payload->>'playerName' as "playerName",
        payload->>'team' as team, payload->>'homeTeam' as "homeTeam", payload->>'awayTeam' as "awayTeam",
        payload->>'providerPlayerId' as "providerPlayerId",
        coalesce(payload->>'sportsbookKey',bookmaker) as "sourceBook",
        coalesce(payload->>'market',market) as market,
        coalesce(payload->>'providerMarketKey',payload->>'marketId',market) as "providerMarketKey",
        payload->>'period' as period, payload->>'entityType' as "entityType"
      from public.active_props where expires_at > statement_timestamp()
    ), history as (
      select sport, player_id, player_name, count(*) as games, max(game_date) as latest_game_at
      from public.player_game_logs
      where game_date < statement_timestamp() and season_type in (2,3)
        and player_id ~ ('^history:' || sport || ':[0-9]+$') and source = 'ESPN'
      group by sport,player_id,player_name
    )
    select jsonb_build_object('asOf', statement_timestamp(), 'truncated', false, 'scope','active_board','completeActiveUniverse',true,
      'active', coalesce((select jsonb_agg(to_jsonb(a) order by sport,"playerName",market,team) from active a),'[]'::jsonb),
      'history', coalesce((select jsonb_agg(to_jsonb(h) order by sport,player_id,player_name) from history h),'[]'::jsonb))
    into result;
    if octet_length(result::text) > 12000000 then raise exception 'Maintenance snapshot bound exceeded'; end if;
    return result;
  end if;

  if p_action not in ('read_keys','insert_verified') then raise exception 'Invalid maintenance operation'; end if;
  if jsonb_typeof(p_payload->'rows') is distinct from 'array'
    or jsonb_array_length(p_payload->'rows') not between 1 and 100 then
    raise exception 'Invalid maintenance batch';
  end if;

  if p_action = 'read_keys' then
    select jsonb_build_object('rows', coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb)) into result
    from public.player_game_logs g
    where exists (select 1 from jsonb_to_recordset(p_payload->'rows') r(player_id text,game_id text,category text)
      where r.player_id=g.player_id and r.game_id=g.game_id and r.category=g.category);
    return result;
  end if;

  -- This lock is exclusive to maintenance writers. It never claims, extends,
  -- releases, or changes the live scheduler's database-authoritative lease.
  if not pg_try_advisory_xact_lock(331,20260919) then raise exception 'Maintenance writer busy'; end if;
  candidate_name := p_payload->'candidate'->>'playerName';
  candidate_sport := upper(p_payload->'candidate'->>'sport');
  canonical_sport := case candidate_sport when 'CFB' then 'NCAAF' when 'CBB' then 'NCAAB'
    when 'NCAAM' then 'NCAAB' when 'PREMIER_LEAGUE' then 'EPL' when 'CHAMPIONS_LEAGUE' then 'UCL' else candidate_sport end;
  if canonical_sport is null or not canonical_sport = any(allowed_sports) or candidate_name is null
    or not exists(select 1 from public.active_props where sport=candidate_sport
      and payload->>'playerName'=candidate_name and expires_at > statement_timestamp()) then
    raise exception 'Candidate no longer active or unsupported';
  end if;

  -- Defense in depth. Source identity/completion/market verification is done by
  -- the existing ESPN parser in the CLI, not inferred from provider odds.
  if exists (
    select 1 from jsonb_to_recordset(p_payload->'rows') r(
      player_id text,game_id text,sport text,player_name text,game_date timestamptz,
      season text,category text,season_type integer,stats jsonb)
    where r.sport is distinct from canonical_sport
      or r.player_id is null or r.player_id !~ ('^history:'||canonical_sport||':[0-9]+$')
      or r.game_id is null or r.game_id !~ ('^'||lower(canonical_sport)||':[0-9]+$')
      or nullif(btrim(r.player_name),'') is null or length(r.player_name)>100
      or r.game_date is null or not isfinite(r.game_date) or r.game_date >= statement_timestamp()
      or r.season is null or r.season !~ '^(19|20)[0-9]{2}$'
      or r.season_type is null or r.season_type not in (2,3)
      or (case when canonical_sport='MLB' then r.category in ('batting','pitching') else r.category='general' end) is not true
      or jsonb_typeof(r.stats) is distinct from 'object'
      or r.stats->>'gameId' is distinct from r.game_id
      or (r.stats->>'date')::timestamptz is distinct from r.game_date
      or r.stats->>'season' is distinct from r.season
      or (r.stats->>'seasonType')::integer is distinct from r.season_type
      or jsonb_typeof(r.stats->'value') is distinct from 'number'
      or jsonb_typeof(r.stats->'scoreFor') is distinct from 'number'
      or jsonb_typeof(r.stats->'scoreAgainst') is distinct from 'number'
      or (r.stats->>'scoreFor')::numeric<0 or (r.stats->>'scoreAgainst')::numeric<0
      or nullif(r.stats->>'statKind','') is null
      or (r.stats->>'teamId' ~ ('^'||canonical_sport||':[0-9]+$')) is not true
      or (r.stats->>'opponentId' ~ ('^'||canonical_sport||':[0-9]+$')) is not true
      or r.stats->>'teamId' = r.stats->>'opponentId'
      or r.stats->>'gameResult' is distinct from (case
        when (r.stats->>'scoreFor')::numeric=(r.stats->>'scoreAgainst')::numeric then 'T'
        when (r.stats->>'scoreFor')::numeric>(r.stats->>'scoreAgainst')::numeric then 'W' else 'L' end)
      or (canonical_sport in ('NBA','WNBA','NCAAB') and coalesce((r.stats->>'minutes')::numeric,0)<=0)
      or r.stats->>'didNotPlay'='true' or r.stats->>'active'='false'
      or (r.stats ? 'period' and r.stats->>'period' not in ('game','full_game','full game'))
  ) then raise exception 'Unverified history batch rejected'; end if;
  if (select count(distinct r->>'player_id') from jsonb_array_elements(p_payload->'rows') r) <> 1 then
    raise exception 'One verified player per maintenance batch required';
  end if;

  insert into public.player_game_logs(player_id,game_id,sport,player_name,game_date,season,category,season_type,stats,source)
    select distinct on(r.player_id,r.game_id,r.category)
      r.player_id,r.game_id,r.sport,r.player_name,r.game_date,r.season,r.category,r.season_type,r.stats,'ESPN'
    from jsonb_to_recordset(p_payload->'rows') r(player_id text,game_id text,sport text,player_name text,
      game_date timestamptz,season text,category text,season_type integer,stats jsonb)
    on conflict(player_id,game_id,category) do nothing;
  get diagnostics n=row_count;
  return jsonb_build_object('written',n,'insertOnly',true);
end;
$function$;
revoke all on function public.autoscout_verified_history_maintenance(text,text,jsonb) from public;
grant execute on function public.autoscout_verified_history_maintenance(text,text,jsonb) to anon, authenticated, service_role;
