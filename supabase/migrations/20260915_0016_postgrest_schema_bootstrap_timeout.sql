-- Keep PostgREST schema-cache bootstrap healthy when Supabase's timezone
-- introspection takes longer than the platform's default 8-second
-- authenticator timeout. User-facing anon/authenticated role limits remain
-- unchanged (3s/8s respectively).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    alter role authenticator set statement_timeout = '15s';
  end if;
end
$$;

-- Apply the role setting to PostgREST and rebuild its schema cache without a
-- database restart or customer-data mutation.
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
