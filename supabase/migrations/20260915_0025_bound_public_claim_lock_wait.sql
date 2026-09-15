-- A lease claim is a tiny coordination write. During a Data API slowdown the
-- caller gives up after 10 seconds, but autoscout_public_store may keep running
-- for its wider write timeout. If it later obtains the scheduler-row lock it can
-- commit a lease whose owner the caller never received, blocking the next live
-- container until that lease expires.
--
-- Bound only the claim branch's lock wait. Prop/history writes retain their
-- existing statement timeout and are otherwise unchanged.
do $patch$
declare
  v_def text;
  v_from text := 'if p_action=''claim'' then' || E'\n';
  v_to text := 'if p_action=''claim'' then' || E'\n  perform pg_catalog.set_config(''lock_timeout'',''2s'',true);' || E'\n';
begin
  select pg_get_functiondef('public.autoscout_public_store(text,text,jsonb)'::regprocedure)
  into v_def;

  if position('perform pg_catalog.set_config(''lock_timeout'',''2s'',true);' in v_def) = 0 then
    if position(v_from in v_def) = 0 then
      raise exception 'autoscout_public_store claim branch anchor not found';
    end if;
    execute replace(v_def, v_from, v_to);
  end if;
end
$patch$;

notify pgrst, 'reload schema';
