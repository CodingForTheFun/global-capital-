-- Keep public ingestion resilient under temporary production database pressure.
-- These changes are intentionally narrow: index the expiry cleanup predicate
-- and give only the token-protected ingestion RPCs a 30-second statement cap.
create index if not exists active_props_expires_at_idx
  on public.active_props (expires_at);

alter function public.autoscout_public_store(text, text, jsonb)
  set statement_timeout = '30s';

alter function public.autoscout_public_props_store(text, text, jsonb)
  set statement_timeout = '30s';

alter function public.autoscout_public_history_store(text, text, jsonb)
  set statement_timeout = '30s';

notify pgrst, 'reload schema';
