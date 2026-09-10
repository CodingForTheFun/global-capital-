# Auto Scout — Research Platform Status

Audited 2026-09-10 against the live deployment
(`https://autoprop-live-production.up.railway.app/apex`) and `production-stable`.

Nothing here is aspirational. Where a row says MISSING, the product shows an
explicit "unavailable" message rather than a fabricated value.

## Corrections to the current roadmap

Two items on the build plan are already done, and one problem is different
from how it was described.

| Claim | Reality |
| --- | --- |
| "The database layer is not connected." | **It is connected and writing.** `persistence.configured: true`, `mode: secure-rpc`, `lastError: null`, and the database holds 1,274 line snapshots, 1,448 prop lines, 315 props, 105 players, 12 events, 9 bookmakers. |
| "We need Supabase before research works." | Supabase is live and holding real rows. It was never the blocker. |
| "Research columns are empty because we lack a game-log provider." | Partly. **Roughly half the board could never even attempt research** because the market failed to map — a code defect, not a provider gap. Fixed below. |

The genuine remaining blocker for hit rates is a per-game historical stats
source that the configured plan actually serves. That is unchanged.

## Fixed in this change

### Market mapping — was silently unmapping ~50% of the board

The odds feed labels markets differently from the stat table. "Receiving
Yards" arrives as **"Reception Yards"**, "Passing TDs" as **"Pass TDs"**, and
NBA combos arrive space-separated ("Points Rebounds Assists") rather than as
the `pts+reb+ast` shorthand. `WNBA` was literally `null` in the market table,
and `NCAAF`/`NCAAB` had no table at all.

Measured against the live board before and after:

| League | Live lines | Unmapped before | Unmapped after |
| --- | --- | --- | --- |
| NFL | 761 | 369 (48%) | 20 (3%) |
| NBA | 78 | 36 (46%) | 0 |
| MLB | 447 | 164 (37%) | 0 |
| NCAAF | 66 | 66 (100%) | 38 (58%) |
| WNBA | 96 | 96 (100%) | 14 (15%) |
| **Total** | **1,448** | **731 (50%)** | **72 (5%)** |

The remaining 72 are refused on purpose:

- `player_points_q1` — a quarter-scoped market cannot be answered from
  full-game logs.
- `player_kicking_points` — needs weighted scoring (FG=3, XP=1); the summing
  model cannot express it, and approximating it would be wrong.
- `player_tds_over` — does not state which touchdowns are counted.

Mapping is now driven by the provider's **stable market key**
(`player_reception_yds`) with the display label as fallback, so a future label
rename cannot silently break research again. The key is threaded shell →
frontdoor → research service.

**Mapping a market is necessary, not sufficient.** WNBA and the college
leagues will now attempt research instead of refusing outright; whether the
stats plan returns their game logs is answered at fetch time.

### Background ingestion — line movement history did not exist

`line_snapshots` held 1,274 rows but every one was written in a single burst:
`longest_tracked_span` was `00:00:00` and the average series had 1.02
snapshots. Persistence only ran when a visitor's request missed the cache, and
`warmSports()` runs once at startup. The table was a duplicate of
`prop_lines`, not a time series, so the "Line movement" panel could never fill.

`lib/autoscout/ingest-worker.mjs` now snapshots on a schedule. It is frugal
because the odds provider bills per request:

- Default every 20 minutes, floor of 5, capped at 96 cycles/day.
- A league with no events sits out, and is re-checked every 6th cycle rather
  than abandoned.
- Forces a cache bypass — a cache hit persists nothing, which is what kept the
  table flat.
- Idle when there is no database, so requests are not spent on writes that
  would be discarded.

`line_snapshots` carries a unique index on
`(prop_id, bookmaker_key, side, line, price, provider_updated_at)`, so an
unchanged line is not re-recorded. The table is a change-log: a row appears
only when something actually moved.

Worker state is exposed at `/api/apex/diagnostics` (owner only).

## Working

| Capability | Where |
| --- | --- |
| Live prop board, sportsbook comparison, best over/under | `apex-v2/provider.mjs` |
| Supabase persistence (events, players, props, lines, snapshots) | `lib/autoscout/supabase-persistence.mjs` |
| Scheduled snapshot ingestion | `lib/autoscout/ingest-worker.mjs` |
| Market → stat mapping across NFL/NBA/MLB/NHL/WNBA/NCAAF/NCAAB | `lib/data-sources/sportsdataio/markets.mjs` |
| Player→provider identity resolution | `lib/data-sources/identity.mjs` |
| Hit-rate windows, chart, line stepper, game log | `lib/autoscout/research-service*.mjs`, `apex-v2/scout-ui-v5.js` |
| Vendor/credit hygiene on customer surfaces | `lib/public-sanitize.mjs` |

## Missing, and what each waits on

| Gap | Waiting on |
| --- | --- |
| **Per-game historical stats at scale** | A stats plan that serves game logs for the leagues on the board. This is the one real purchase decision. Everything downstream (L5/L10/L15/H2H/averages/charts) is already built and will populate the moment logs arrive. |
| **Player team on props** | The odds feed returns `team: ""`. Blocks opponent derivation, so H2H and home/away splits stay thin. Fixable by backfilling from the player directory. |
| **Projections and edge** | No projection model, and no projection feed wired. Do not ship an invented one. |
| **Injuries, depth chart, role** | Feeds exist (`injuries`, `depthCharts`) but are not surfaced on `/apex`. Wiring only. |
| **Opponent rank / defense vs position / pace** | `teamSeasonStats` is fetched but not surfaced; positional splits may not be on the current plan. |
| **Player headshots** | No licensed image source; UI falls back to initials. Will not be scraped. |
| **With/without teammate filters** | Needs per-game lineup participation history. |
| **Alerts, saved props, EV/fair probability** | Later phase; tables (`alerts`, `saved_props`, `favorites`) already exist. |

## Empty-state contract

Research failures return HTTP 200 with `available:false` and a sentence the UI
prints verbatim. Vendor names, plan limits and credit balances are stripped at
the frontdoor by `lib/public-sanitize.mjs` before anything reaches a customer;
owner diagnostics keep the full detail.

A blank research panel is a bug. A stated reason is an answer.
