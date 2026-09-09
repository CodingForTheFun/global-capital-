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
- Railway start command verified 2026-09-09: `node server-professional.mjs`

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
