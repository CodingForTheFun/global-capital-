# Auto Scout intelligence studio — integration handoff

Base: production-stable e91bb5a732e6c992fba2ebdc2f3fb2fe2cb1038d.
Work branch: chatgpt/autoscout-intelligence-integration-20260913.

Preserve PR #49 (sportsbook homepage, Ask/projected-stat changes) and the other
chat's work. No wagering, wallet, payment, authentication, provider, database,
budget, or polling behavior is introduced by this patch. Frontdoor changes only
allowlist two new static browser modules. No new dependency.

## What is implemented

- Auto Scout-only studio entry and a new Intelligence player-drawer tab.
- Line Sensitivity Map reuses lib/analytics/research.mjs; it does not duplicate
  the hit-rate engine. It responds to line, side, window and venue selection.
- Research Data Quality is six explicit evidence-availability checks, not win
  probability or a confidence estimate. Unknown identity/lineup gets no credit.
- Book Disagreement Map isolates player/event/market/side, excludes promotions
  and alternate lines, deduplicates books and exposes ambiguity/freshness.
- Scenario Lab is an explicit basketball historical per-minute what-if. It
  needs four real games with positive minutes. Assumed zero minutes returns zero.
- Prop Timeline reads stored line history on demand, using the same cache and
  route as Compare lines. Timestamped non-line observations are supported by
  the calculation module only when scoped and sourced. No new event feed.
- Player Dependency Graph calculates with/without averages only from explicit,
  sourced, verified per-game teammate participation. Missing is never absent.
- Research Brief provides deterministic, numbered evidence and text export.
  No paid AI request; no gambling recommendation.
- Change Radar compares same-series quotes across existing board refreshes
  within the current visit. It does not claim a server-wide real-time feed,
  track removals from partial coverage, or infer the cause of moves.

## Data limits that MUST remain visible

Current provider payloads do not establish a historical teammate participation
feed or timestamped injury/lineup event feed. Those panels explain missing data;
this is not a claim that every feature is fully populated for every sport.
Minute scenarios are supported only for NBA/WNBA/NCAAB with measured minutes.
Historical sensitivity is not a calibrated forecast. No invented matches,
quotes, events, or lineup effects enter the production interface.

## Verification

Local native-Node unit tests pass. The local browser endpoint was blocked by
ERR_BLOCKED_BY_ADMINISTRATOR; no alternate host/port workaround was attempted.
The repository's normal CI runs full regression plus the dedicated synthetic
browser fixture on desktop/mobile. Browser fixtures are never production data.
Do not claim deployment until actual release SHA and service success are checked.

Use `node --test tests/autoscout-intelligence-integration.test.mjs` and
`node scripts/test-intelligence-browser.mjs` after dependencies/browser install.
Screenshots and browser report are written to test-results/intelligence/.

Rollback: revert this focused integration commit. It has no data migrations.
