-- autoscout_public_store validated its source with:
--
--   if not ( v_source in ('prizepicks','underdog') or ... ) then
--     raise exception 'Invalid source';
--   end if;
--
-- In SQL, NULL in (...) is NULL, not false. So for a null source the whole
-- expression is NULL, `not NULL` is NULL, and `if NULL` does not fire. The
-- guard let a null straight through to
--
--   insert into private.autoscout_public_state(id, state) values (v_source, ...)
--
-- which failed on the not-null constraint and surfaced as an HTTP 500 - 34 of
-- them in one twenty-minute window. Every one was swallowed by a
-- .catch(() => {}) on the caller, so nothing anywhere reported it.
--
-- This makes the guard reject a null source explicitly, so a missing source is
-- a clean 'Invalid source' rejection. Both validation sites (the 'status' and
-- 'props' branches) are patched, and the migration refuses to act if the
-- function has been reshaped since - better to do nothing than rewrite blind.
do $migration$
declare
  original text;
  patched text;
  sites integer;
begin
  select pg_get_functiondef(p.oid) into original
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'autoscout_public_store';

  if original is null then
    raise exception 'autoscout_public_store not found';
  end if;

  if position('v_source is null or not (' in original) > 0 then
    return; -- already guarded
  end if;

  patched := replace(original, 'if not (', 'if v_source is null or not (');

  sites := (length(patched) - length(original)) / length('v_source is null or ');
  if sites <> 2 then
    raise exception 'expected exactly 2 guard sites, would have patched %', sites;
  end if;

  execute patched;
end
$migration$;
