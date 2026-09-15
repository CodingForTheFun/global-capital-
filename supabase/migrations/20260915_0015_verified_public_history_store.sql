create or replace function public.autoscout_public_history_store(
  p_token text,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if p_token is null or not exists(
    select 1 from private.autoscout_backend_tokens
    where enabled=true and token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
  ) then
    raise exception 'Unauthorized ingestion' using errcode='42501';
  end if;

  if octet_length(p_payload::text) > 16000000 then
    raise exception 'Payload too large';
  end if;

  if p_action='history' then
    if jsonb_typeof(p_payload->'rows') <> 'array' then raise exception 'Invalid rows'; end if;
    if jsonb_array_length(p_payload->'rows') > 1000 then raise exception 'History batch too large'; end if;

    insert into public.player_game_logs(player_id,game_id,sport,player_name,game_date,season,category,season_type,stats)
    select r.player_id,r.game_id,r.sport,r.player_name,r.game_date,r.season,r.category,r.season_type,r.stats
    from jsonb_to_recordset(p_payload->'rows')
      r(player_id text,game_id text,sport text,player_name text,game_date timestamptz,season text,category text,season_type integer,stats jsonb)
    where r.sport in ('NBA','NFL','MLB','WNBA','NCAAF','NHL','NCAAB','MLS','EPL','UCL','SOCCER')
      and r.player_id ~ ('^history:'||r.sport||':[0-9]+$')
      and r.game_date < now()
      and r.season_type in (2,3)
    on conflict(player_id,game_id,category) do update
      set stats=public.player_game_logs.stats||excluded.stats,updated_at=now()
      where public.player_game_logs.stats is distinct from public.player_game_logs.stats||excluded.stats;
    get diagnostics n=row_count;
    return jsonb_build_object('written',n);

  elsif p_action='history_candidates' then
    return jsonb_build_object('rows',coalesce((
      select jsonb_agg(x) from (
        select distinct pl.id as "playerId",pl.name as "playerName",pl.team,pl.sport_key as sport,
          pr.market_key as "marketId",pr.market_name as market
        from public.players pl
        join public.props pr on pr.player_id=pl.id
        join public.events e on e.id=pr.event_id
        where pl.sport_key in ('NBA','NFL','MLB','WNBA','NCAAF','NHL','NCAAB','MLS','EPL','UCL','SOCCER')
          and e.commence_time > now()-interval '7 days'
        order by pl.id,pr.market_key
        limit 5000
      ) x
    ),'[]'::jsonb));

  elsif p_action='read_history' then
    return jsonb_build_object('rows',coalesce((
      select jsonb_agg(x) from (
        select * from public.player_game_logs
        where player_id=p_payload->>'player_id'
        order by game_date desc
        limit 500
      ) x
    ),'[]'::jsonb));
  else
    raise exception 'Invalid operation';
  end if;
end;
$$;

revoke all on function public.autoscout_public_history_store(text,text,jsonb) from public;
grant execute on function public.autoscout_public_history_store(text,text,jsonb) to anon, authenticated;
