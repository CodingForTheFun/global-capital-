-- Keep the line-history proof small enough for PostgREST's normal 1,000-row
-- response cap while still proving both freshness and repeated tracking over
-- time. The sample combines the newest rows with the oldest/newest bookends
-- from recent series that have already spanned at least one hour.
create or replace function public.autoscout_line_history_proof(
  p_token text,
  p_days integer default 7,
  p_limit integer default 50000
)
returns table(
  prop_id text,
  bookmaker_key text,
  side text,
  line numeric,
  price integer,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '15s'
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 7), 1), 30);
  v_limit integer := least(greatest(coalesce(p_limit, 1000), 1), 1000);
  v_cutoff timestamptz := now() - pg_catalog.make_interval(days => v_days);
begin
  if p_token is null or not exists (
    select 1
    from private.autoscout_backend_tokens
    where enabled = true
      and token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  ) then
    raise exception 'Unauthorized ingestion' using errcode = '42501';
  end if;

  return query
  with tracked as (
    select
      s.prop_id,
      s.bookmaker_key,
      s.side,
      min(s.created_at) as first_at,
      max(s.created_at) as last_at
    from public.line_snapshots s
    where s.created_at >= v_cutoff
    group by s.prop_id, s.bookmaker_key, s.side
    having max(s.created_at) - min(s.created_at) >= interval '1 hour'
    order by max(s.created_at) desc
    limit 200
  ),
  bookends as (
    select x.prop_id,x.bookmaker_key,x.side,x.line,x.price,x.created_at
    from tracked t
    join lateral (
      (select s.prop_id,s.bookmaker_key,s.side,s.line,s.price,s.created_at
       from public.line_snapshots s
       where s.prop_id=t.prop_id
         and s.bookmaker_key=t.bookmaker_key
         and s.side=t.side
         and s.created_at >= v_cutoff
       order by s.created_at asc
       limit 1)
      union all
      (select s.prop_id,s.bookmaker_key,s.side,s.line,s.price,s.created_at
       from public.line_snapshots s
       where s.prop_id=t.prop_id
         and s.bookmaker_key=t.bookmaker_key
         and s.side=t.side
         and s.created_at >= v_cutoff
       order by s.created_at desc
       limit 1)
    ) x on true
  ),
  fresh as (
    select s.prop_id,s.bookmaker_key,s.side,s.line,s.price,s.created_at
    from public.line_snapshots s
    where s.created_at >= v_cutoff
    order by s.created_at desc
    limit 600
  ),
  sample as (
    select distinct
      q.prop_id,q.bookmaker_key,q.side,q.line,q.price,q.created_at
    from (
      select * from fresh
      union all
      select * from bookends
    ) q
  )
  select
    s.prop_id,s.bookmaker_key,s.side,s.line,s.price,s.created_at
  from sample s
  order by s.created_at desc
  limit v_limit;
end;
$$;

revoke all on function public.autoscout_line_history_proof(text, integer, integer) from public;
grant execute on function public.autoscout_line_history_proof(text, integer, integer)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
