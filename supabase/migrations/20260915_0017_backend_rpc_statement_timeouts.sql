-- Backend ingestion RPCs are called through the publishable-key Data API path,
-- so without a function-level override they inherit anon's 3-second timeout.
-- Keep the normal anon/authenticated role limits unchanged and give only these
-- token-protected machine-to-machine functions enough time for current boards.
alter function public.autoscout_ingest_board(text, jsonb)
  set statement_timeout = '15s';

alter function public.autoscout_public_store(text, text, jsonb)
  set statement_timeout = '15s';

alter function public.autoscout_public_history_store(text, text, jsonb)
  set statement_timeout = '15s';

notify pgrst, 'reload schema';
