# AutoProp Scout Pro — Coordination Contract

This repository is being worked on from more than one ChatGPT conversation. Those conversations do **not** communicate directly. This file is the shared source of truth that every build chat must read before changing AutoProp production.

## Production safety rules

1. Do not change the Railway production source, start command, scanner entrypoint, or hard qualifier rules without first reading this file.
2. Do not push experimental work directly into production. Use a feature branch and validate it first.
3. Current production must remain pinned until a replacement build passes validation.
4. Never re-enable Goblin/Demon/boosted/discount lines in the regular-line production scanner.
5. Never expose one user's PickFinder credentials/session/results to another user.
6. Never treat a locked/public PickFinder page as authenticated analytics.
7. Never display malformed records such as player=`PickFinder`, sport=`UNKNOWN`, pick=`N/A` as researched props.

## Permanent product invariants

- Regular/main lines only; no Green Goblin, Demon, boosted, discounted, or alternate lines.
- Today/tonight only where a slate is date-scoped.
- Missing required data fails closed.
- Adjustable research thresholds are allowed, but the hard locks above are not adjustable.
- If nothing qualifies, show clearly labeled Best Available near-misses rather than pretending they qualified.
- Provider-native player props may be used as the All Props universe when they are real, current, non-promotional outcomes. They must be labeled by source and may never be represented as PrizePicks unless the provider explicitly identifies PrizePicks.
- PickFinder is an optional authenticated research/verification source, not a requirement for the All Props board. If it cannot provide a reliable session or board, the product must remain usable from provider-native data.

## Current production

- Railway project: AutoProp Scout Pro
- Production service: `autoprop-live`
- Production domain: `autoprop-live-production.up.railway.app`
- Recovery baseline: `9165291ec29e5f54241e1657f4f0f5602901bfc4`
- Railway source branch: `production-stable`
- Railway start command verified 2026-09-09: `node server-scout.mjs`

## Active v3 branch

- Branch: `autoprop-multiuser-live-data`
- Goal: replace the single-owner architecture with per-user AutoProp accounts, per-user encrypted PickFinder sessions, isolated scan history/results/rules, corrected PickFinder login verification, live scores, and live in-game player data.
- This branch must be validated before replacing production.

## Required handoff protocol for every build chat

Before making changes:
1. Read `AUTOPROP_COORDINATION.md`.
2. Inspect the currently deployed commit/config.
3. Work on an isolated feature branch unless the change is an emergency production fix.
4. Do not overwrite another chat's branch.
5. Append a short handoff note below when changing deployment architecture or product invariants.

## Handoff log

- 2026-09-08: Cross-chat overwrite problem identified. Production was pinned to a verified regular-only baseline. New multi-user/live-data work moved to `autoprop-multiuser-live-data`.
- 2026-09-08: Multi-user v3 direction approved: every AutoProp user must connect only their own PickFinder account; live scores and live player/game data are being added.
- 2026-09-09: Claude Code session on branch `claude/pickfinder-auth-modal-fix-dle7hz`, based on `production-stable` (4a3acfa). Nothing on this branch was deployed during Claude's session.
  - Fixed the PickFinder sign-in failure where the Clerk modal backdrop intercepted pointer events and `scanner/pickfinder-v2.mjs` leaked the raw Playwright call log to the dashboard. Resilient submit (click → settle+retry → form.requestSubmit → Enter → DOM click). No CAPTCHA/2FA/verification bypass; those still fail closed.
  - `lib/safe-error.mjs` is now the ONLY place that produces backend→frontend error text. It is an allowlist: unclassified errors become generic copy. Do not reintroduce per-server `friendlyScanError` bodies that return `error.message`.
  - Added `lib/props`, `lib/filters`, `lib/scoring`, `lib/data-sources` as the universal prop/filter/score engine. One filter engine only — do not add a second filter implementation for any new page.
  - Added SportsDataIO enrichment for projections, injuries, minutes, starter/lineup context, opponent data and live status. Requires `SPORTSDATAIO_API_KEY`; unavailable feeds degrade to null, never invented data.
  - Safety branch pinned at the known-good deployed commit: `safety/known-good-9e13ab7`.
- 2026-09-09: ChatGPT takeover continued on `claude/pickfinder-auth-modal-fix-dle7hz`. Owner explicitly authorized deployment after release validation. `/props` now has an organized mobile-first All Props / Auto Prop Finder UI and both `server.mjs` and the live `server-professional.mjs` map `/props` to it. SportsDataIO runtime diagnostics discover entitlements and whether exact PrizePicks operator offers are present without returning key material or raw odds payloads.
  - Added conservative SportsDataIO player-prop normalization: only available, non-alternate OVER/UNDER outcomes with a real player, market and numeric line are eligible; missing values never become zero.
  - Added `prizePicksBoard()` as an API-first candidate source, but it is NOT enabled as the production prop universe yet. PickFinder remains the authoritative fallback until Railway runtime verification proves the configured subscription actually contains PrizePicks core offers for a league. Scout Rules continue to fail closed for any source that has not satisfied the hard locks.
  - Candidate `7ee72798d810ba3972279bd693937ca48b325b04` passed the full GitHub release-candidate workflow. `production-stable` was fast-forwarded from `4a3acfa` to the validated candidate, and this documentation commit intentionally triggers the Railway production rollout. Runtime SportsDataIO verification is configured as a one-time pre-deploy diagnostic; it prints only entitlement classifications and safe operator counts.
- 2026-09-09: Product direction updated by owner: SCOUT PRO must become a provider-native sports research platform that remains useful without PickFinder. PickFinder may stay only as an optional per-user research source when it genuinely works. The production All Props universe is being moved toward real SportsDataIO player-prop feeds, with source labeling, no fabricated PrizePicks attribution, and the same hard promotional-line exclusions.
- 2026-09-09: `chatgpt/api-first-props-fix` passed the release workflow at commit `1fc7b1a15081783e9bb8565e2344f00234e00f71`. Production was fast-forwarded to that build, the Railway start command was changed to `node server-scout.mjs`, healthcheck to `/api/health`, and this documentation commit exists to emit a normal GitHub push event so Railway refreshes the `production-stable` source snapshot.
- 2026-09-09: Claude Code session. Fixed the empty prop board. Root cause: `lib/data-sources/sportsdataio/prop-board.mjs` called `normalizePlayerPropOffers(payload, { sport })` with no `metadata`, so market/bet/outcome names could not be resolved from the numeric type IDs the player-props feed returns; `side` and `market` came out null and every outcome was dropped at the `offerFromOutcome` gate — an empty board from a feed answering 200. Added `betting-metadata.mjs`, which loads `/{sport}/odds/json/BettingMetadata` and builds the lookup maps (cached 12h per league). Strictly additive: an unfamiliar shape or failed request yields empty maps and normalization falls back to the existing payload-name path. Do not remove the `metadata` argument at that call site. `/api/props` now also returns `boardState`, and coverage rows report `metadataLoaded`, to distinguish "feed returned nothing" from "feed returned data we could not name".
- 2026-09-10: Claude Code session on branch `claude/apex-market-project-txf4lp`, based on `production-stable` (6638fc7). Nothing was deployed and `production-stable` was not touched.
  - Cross-chat duplication caught late: an earlier attempt in this session built a parallel auth stack on a branch cut from `main`, which is 137 commits behind `production-stable`. That work is parked at `claude/supabase-auth-standalone-reference` and is NOT for merge. Read this file and check `production-stable` before starting, not `main` — `main` is abandoned and still deploys `node server.mjs`.
  - Account storage is now one interface with two backends, selected once at startup by `lib/auth/store.mjs`: the existing JSON file store (unchanged behaviour, still the default) and a new Supabase backend used when `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set. `lib/auth/service.mjs`, `routes.mjs` and `admin-routes.mjs` are untouched. Do not add a third account store.
  - Why: `public.users.id` has a foreign key to `auth.users.id`. Accounts that existed only in `users.json` could never satisfy it, so `subscriptions`, `favorites`, `alerts` and `saved_props` were unusable. The Supabase backend mints the identity through the GoTrue admin API so those keys resolve.
  - Credentials stay in one place: `public.account_state.password_hash`, RLS-enabled with no policies and grants revoked, service-role only. Verification still happens in `lib/auth/service.mjs`. Moving verification into GoTrue is a later step and must REPLACE that column, never duplicate it.
  - Database migrations applied to the live Auto Scout project and now committed under `supabase/migrations/`: profile/subscription provisioning trigger with backfill, admin RLS policies via a SECURITY DEFINER helper, `public.account_state`, and an EXECUTE lockdown on the trigger functions. `supabase/migrations/` had drifted from the deployed database; it now matches.
  - The two `autoscout_*` RPCs keep their anon EXECUTE grant on purpose: they authenticate with a SHA-256 token hash against `private.autoscout_backend_tokens` and raise 42501 otherwise. Their advisor warnings are expected. Do not "fix" them without replacing the backend-token mechanism.
- 2026-09-10: Claude Code session, branch `claude/apex-market-project-txf4lp` (based on `production-stable` 6638fc7). Not deployed.
  - **I edited `apex-v2/scout-ui-v4.js`.** If another chat is working on that file, reconcile before merging. My change is additive: it replaces the placeholder "Research status" panel in `openDetails()` with a live research panel, and appends research functions immediately before the `shell();` boot call. Nothing else in the shell was touched.
  - Root cause of the empty research board: `/apex` is served by `apex-v2/server-core.mjs`, whose provider returns odds only. The research pipeline (`lib/data-sources`, `lib/analytics/rolling.mjs`) was built for `server-scout.mjs` + `lib/props` and was never reachable from the live board. Two prop systems, one repo — see PROJECT_STATUS.md.
  - The board's `playerId` is a hash of the player name and is NOT a join key. Research resolves the player through `lib/data-sources/identity.mjs` (provider id, or name plus corroborating context; ambiguous names are refused) to get a real SportsDataIO PlayerID, then calls `playerGameLog`.
  - New: `lib/research/service.mjs` (hit rates, windows, H2H, push handling) and `lib/research/market-keys.mjs` (The Odds API `player_*` keys → canonical stat markets). New endpoint `GET /api/research` on apex core, proxied as `/api/apex/research` by `frontdoor-prod.mjs`.
  - Hit-rate semantics are shared between server and client on purpose: a push is excluded from the denominator, never counted as a loss, and an unmeasurable window is null rather than 0. The client recomputes locally so the line stepper is instant; `resHit()` in the shell mirrors `hitRateFor()` in the service. If you change one, change both.
  - An unavailable result is HTTP 200 with `available:false` and a sentence the UI prints verbatim. Do not convert these to error statuses; a blank research panel is a bug, a stated reason is an answer.
  - NOT verified against a live SportsDataIO key (none in that environment). The drawer, chart, maths and market mapping were verified in Chromium against the real live prop payload with a stubbed research response. First production open is the real provider test.

