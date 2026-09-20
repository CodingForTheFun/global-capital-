-- Give the Railway line-history proof job a narrow read path without granting
-- anon broad SELECT on line_snapshots or copying a service-role secret into it.
-- The existing backend ingest token is validated exactly like the other
-- machine-to-machine RPCs. Return the newest bounded sample so high-volume
-- history cannot make a 50k-row proof window look stale by returning only the
-- oldest rows.
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
  v_limit integer := least(greatest(coalesce(p_limit, 50000), 1), 50000);
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
    select
      s.prop_id,
      s.bookmaker_key,
      s.side,
      s.line,
      s.price,
      s.created_at
    from public.line_snapshots s
    where s.created_at >= now() - pg_catalog.make_interval(days => v_days)
    order by s.created_at desc
    limit v_limit;
end;
$$;

revoke all on function public.autoscout_line_history_proof(text, integer, integer) from public;
grant execute on function public.autoscout_line_history_proof(text, integer, integer)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
