---
description: Changing prop ingestion, The Odds API, PrizePicks, Underdog, ESPN, PropLine, Supabase schema or RPCs, authentication, or customer data.
applies: Editing a provider integration under lib/ingestion, lib/data-sources, or lib/autoscout/providers, or a Supabase migration, or auth/gate code.
does_not_apply: UI-only changes that do not touch how data is fetched, normalized, persisted, or authenticated.
---
- Do not alter prop ingestion, The Odds API, PrizePicks, Underdog, ESPN,
  PropLine, Supabase, billing contracts, authentication contracts, or customer
  data without the change being specifically requested and understood.
- Supabase RPCs here use `SECURITY DEFINER`, `SET search_path = ''`, and a
  token hash check against `private.autoscout_backend_tokens`
  (`encode(digest(p_token,'sha256'),'hex')`). A destructive migration (delete,
  truncate, drop) needs a floor the caller cannot lower and explicit
  authorization before applying it to production.
- Gate matching in lib/auth/gate.mjs is by exact prefix, not by directory: a
  new API route needs its own entry in `GATED_API_PREFIXES` even if a sibling
  route looks like it should already cover it (`/api/apex/propline` does not
  match `/api/apex/props`).
- Do not restore or reconnect obligepay.com to this sports product.
- Any change to a provider's on-demand vs. polled behavior should account for
  the shared daily/rate quota (PropLine's reserve, The Odds API's credit
  pool) — verify the actual cost against the current tier before shipping.
