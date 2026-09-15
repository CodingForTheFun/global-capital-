-- Line-snapshot retention.
--
-- Production runs in secure-RPC mode: the app holds a publishable key plus an
-- ingest token and can only reach the database through these SECURITY DEFINER
-- functions. It has no DELETE of its own, which is why snapshot growth has only
-- ever been dealt with by hand. This gives retention a reviewable home in the
-- schema instead.
--
-- Two safety properties matter more than the cleanup itself:
--   * a floor the caller cannot lower, so a wrong parameter, a stray env var or
--     a bug upstream can shorten the window it asks for but can never reach
--     history younger than the floor;
--   * a bounded batch, so one call can never turn into an unbounded delete on a
--     shared free-tier instance.
create or replace function public.autoscout_prune_line_snapshots(
  p_token text,
  p_days integer default 30,
  p_limit integer default 20000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  floor_days constant integer := 14;
  max_batch constant integer := 50000;
  keep_days integer;
  batch integer;
  cutoff timestamptz;
  removed integer;
begin
  if p_token is null or not exists(
    select 1 from private.autoscout_backend_tokens
    where enabled=true and token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
  ) then
    raise exception 'Unauthorized ingestion' using errcode='42501';
  end if;

  keep_days := greatest(coalesce(p_days, 30), floor_days);
  batch := least(greatest(coalesce(p_limit, 20000), 1), max_batch);
  cutoff := now() - make_interval(days => keep_days);

  -- Deleting by ctid keeps the batch limit honest: the subquery picks exactly
  -- `batch` oldest rows via line_snapshots_created_at_idx and nothing else is
  -- touched.
  delete from public.line_snapshots
  where ctid in (
    select ctid
    from public.line_snapshots
    where created_at < cutoff
    order by created_at
    limit batch
  );
  get diagnostics removed = row_count;

  return jsonb_build_object(
    'deleted', removed,
    'keepDays', keep_days,
    'floorDays', floor_days,
    'batch', batch,
    'cutoff', cutoff,
    'more', removed >= batch
  );
end;
$$;

revoke all on function public.autoscout_prune_line_snapshots(text, integer, integer) from public;
grant execute on function public.autoscout_prune_line_snapshots(text, integer, integer) to anon, authenticated, service_role;
