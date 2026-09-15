-- Chunked public snapshots can contain thousands of rows. Running the global
-- active_props expiry cleanup after every small chunk multiplies delete/index
-- work and can turn a healthy refresh into a timeout storm. Preserve the same
-- cleanup, but run it once when a chunked snapshot is finalized. Non-chunked
-- callers retain the original behavior.
do $migration$
declare
  v_def text;
  v_old text := $old$
  end if;
  delete from public.active_props where expires_at<now()-interval '1 day';
  return jsonb_build_object('written',n);
 elsif p_action='history' then
$old$;
  v_new text := $new$
  end if;
  if not coalesce((p_payload->>'chunked')::boolean,false)
     or coalesce((p_payload->>'finalize')::boolean,false) then
    delete from public.active_props where expires_at<now()-interval '1 day';
  end if;
  return jsonb_build_object('written',n);
 elsif p_action='history' then
$new$;
begin
  select pg_get_functiondef('public.autoscout_public_store(text,text,jsonb)'::regprocedure)
    into v_def;
  if position(v_old in v_def)=0 then
    raise exception 'autoscout_public_store cleanup block changed; refusing unsafe patch';
  end if;
  execute replace(v_def,v_old,v_new);
end
$migration$;

notify pgrst, 'reload schema';
