-- Additive, aggregate-only backend diagnostic for #325.
-- REVIEW/APPLY EXPLICITLY. No scheduler/provider/row/lease/auth mutations.
-- Uses the EXISTING backend-token authorization contract. Do not publish tokens.
begin;
create function public.autoscout_source_freshness(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '2s'
as $function$
begin
  if p_token is null or not exists (
    select 1 from private.autoscout_backend_tokens
    where enabled = true and token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  ) then
    raise exception 'Unauthorized ingestion' using errcode = '42501';
  end if;
  return (
    with source_ids as (
      select unnest(array['prizepicks', 'underdog']) as source
      union select id from private.autoscout_public_state
        where id ~ '^(draftkings|fanduel|pinnacle|betrivers|bvda|betmgm):(NFL|NBA|WNBA|MLB|NHL|NCAAF|NCAAB|TENNIS|SOCCER)(:sportsbook)?$'
      union select distinct source from public.active_props
    ), grouped as (
      select source, sport,
        count(*) filter (where expires_at > now()) as active_rows,
        count(*) filter (where expires_at > now() and observed_at >= now() - interval '10 minutes' and observed_at <= now()) as fresh_rows,
        count(*) filter (where expires_at > now() and (observed_at < now() - interval '10 minutes' or observed_at > now() or observed_at is null)) as stale_rows,
        count(*) filter (where expires_at > now() and expires_at <= now() + interval '5 minutes') as expiring_rows,
        count(*) filter (where expires_at <= now() and game_start_time > now()) as expired_upcoming_rows,
        max(observed_at) as latest_observed_at,
        min(expires_at) filter (where expires_at > now()) as next_expiry_at
      from public.active_props group by source, sport
    ), aggregate_rows as (
      select source, sum(active_rows) as active_rows, sum(fresh_rows) as fresh_rows,
        sum(stale_rows) as stale_rows, sum(expiring_rows) as expiring_rows,
        sum(expired_upcoming_rows) as expired_upcoming_rows,
        max(latest_observed_at) as latest_observed_at, min(next_expiry_at) as next_expiry_at,
        jsonb_agg(jsonb_build_object('sport', sport, 'activeRows', active_rows, 'freshRows', fresh_rows,
          'staleRows', stale_rows, 'expiringRows', expiring_rows, 'expiredUpcomingRows', expired_upcoming_rows)
          order by sport) as sports
      from grouped group by source
    ), report as (
      select s.source, coalesce(a.active_rows, 0) as "activeRows", coalesce(a.fresh_rows, 0) as "freshRows",
        coalesce(a.stale_rows, 0) as "staleRows", coalesce(a.expiring_rows, 0) as "expiringRows",
        coalesce(a.expired_upcoming_rows, 0) as "expiredUpcomingRows",
        a.latest_observed_at as "latestObservedAt", a.next_expiry_at as "nextExpiryAt",
        coalesce(a.sports, '[]'::jsonb) as sports,
        st.state->>'status' as "fetchStatus", st.state->>'fetchedAt' as "fetchedAt",
        st.state->'retained' = 'true'::jsonb as retained,
        st.state->>'transport' as transport
      from source_ids s left join aggregate_rows a using (source)
      left join private.autoscout_public_state st on st.id = s.source
    )
    select jsonb_build_object('scope', 'active-public-store', 'dbNow', now(),
      'freshAgeSeconds', 600, 'expiryHorizonSeconds', 300,
      'sources', coalesce(jsonb_agg(to_jsonb(report) order by source), '[]'::jsonb))
    from report
  );
end;
$function$;
-- Revoke default PUBLIC access in the same transaction. Machine callers also
-- need a valid enabled backend token; a publishable key alone is insufficient.
revoke all on function public.autoscout_source_freshness(text) from public, anon, authenticated;
grant execute on function public.autoscout_source_freshness(text) to anon, service_role;
comment on function public.autoscout_source_freshness(text) is
  'Read-only source/sport freshness aggregates; existing backend token required; not provider-universe coverage.';
commit;
