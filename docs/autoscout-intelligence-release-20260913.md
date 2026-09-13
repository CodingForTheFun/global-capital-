# Auto Scout intelligence + BoiBook presentation integration

Base: production `141938f0519963ed0dd0f75cd003ed073ab4059d` (PR #49).
Work branch: `chatgpt/autoscout-intelligence-release-v2`.

The user supplied `boibook-built(2).zip` and requested keeping the main sportsbook
interface with Auto Scout in a separate tab. The latest production already contains
the game board and shared navigation. This change extends that implementation;
it does not replace it with the old SportsBetting React archive or a standalone site.

## Delivered source

- Auto Scout: session-based Prop Change Radar; line-sensitivity grid using the
  existing shared research engine; transparent six-check evidence-quality meter;
  exact prop/book/side timeline; unique-book line distribution; proportional what-if
  Scenario Lab; verified with/without teammate comparison; traceable local brief.
- UI: isolated navy/emerald research surfaces, responsive panels, keyboard access.
- Main sportsbook: BoiBook-inspired favorite games, American/decimal display,
  safer CSV export of displayed real quotes, responsive control bar.
- No new dependencies, automatic provider polling, AI calls or paid-data budgets.
- No authentication, billing, database, worker or payment changes.

## Feature/data boundaries

Radar observes the existing board refresh lifecycle during a visit. It is not a
persistent all-user alert service and does not invent earlier movements. Partial
snapshots never imply removals. Timeline uses existing persisted line snapshots;
other supplied injury/lineup/projection/game context is labeled as observed here,
not as a historical feed or proven cause. Scenario Lab is an explicit proportional
assumption, not an injury-aware prediction. Dependency graphs require exact IDs
and verified played/not-played history in the response; current production does
not establish broad coverage of that feed. Missing participation produces an honest
unavailable state, not inferred absences. Evidence quality is coverage, not win
probability. No claim is made that competitors lack these features.

The BoiBook source and integrated game board are a frontend and hypothetical
reference calculator, not a real-money sportsbook engine. No deposits, withdrawals,
wager execution, settlement or funds transfers are enabled by this release.

## QA and rollback

`node --test tests/intelligence-integration.test.mjs` passed 18 local tests.
Full local HTTP tests could not run successfully in this restricted runtime;
local Chromium navigation was administrator-blocked. GitHub Actions runs the normal
full regression suite and actual Playwright browser checks. Only report results from
the exact validated commit. Fixture screenshots are labeled QA and never used as
live sports data. The fixture server binds only localhost and is not loaded by
production. Existing release/account/sportsbook checks must also pass.

Rollback by reverting the final squash commit on production; keep newer unrelated
changes and deployment/provider settings. All state introduced here is client-local.
Supersedes isolated incomplete transport work in
`chatgpt/autoscout-intelligence-integration-20260913`; do not merge that branch.
