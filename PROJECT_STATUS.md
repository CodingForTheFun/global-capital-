# Auto Scout — Research Platform Status

Audited 2026-09-10 against the live deployment
(`https://autoprop-live-production.up.railway.app/apex`) and `production-stable`.

This file records what is actually working, what is missing, and which data
source each gap is waiting on. Nothing here is aspirational: if a row says
MISSING, the product currently shows an explicit "unavailable" message rather
than a fabricated value.

## Architecture note

There are two prop systems in this repository. They are not the same app.

| Path | Served by | Provider |
| --- | --- | --- |
| `/apex` (live) | `frontdoor-prod.mjs` → `apex-v2/server-core.mjs`, shell `apex-v2/scout-ui-v4.js` | `apex-v2/provider.mjs` → The Odds API |
| `/props` | `server-scout.mjs` → `lib/props/*` | `lib/data-sources/*` (SportsDataIO enrichment) |

The research pipeline (`lib/data-sources`, `lib/analytics/rolling.mjs`) was
built for the second one. The live board is the first. That is why the live
board showed no research data despite the pipeline existing.

## Audit answers

1. **What prop data is returned?** Real player-prop lines from The Odds API:
   player, market, line, side, price, sportsbook, deeplink, consensus, event,
   timestamps. Verified live: NBA returned 78 lines / 18 props / 2 events / 3
   books.
2. **Which leagues work?** NFL, NBA, WNBA, MLB, NHL, NCAAF, NCAAB are wired.
   Live coverage depends on the slate; the board is capped at `maxEvents: 2`
   and `maxMarketsPerEvent: 6` to conserve credits.
3. **Which player markets work?** Live NBA returned points, rebounds, assists,
   threes, PRA, points+rebounds, points+assists.
4. **What historical stat provider is connected?** SportsDataIO
   (`SPORTSDATAIO_API_KEY`), configured in production.
5. **Which historical endpoints return data?** `PlayerGameStatsBySeason`
   (game logs) is wired through `adapter.playerGameLog`. Not yet verified
   against a live key from this environment — see Unverified below.
6. **Are player identities matched across providers?** They are now. The board's
   `playerId` is a hash of the name and is useless as a join key. Resolution
   goes through `lib/data-sources/identity.mjs`, which requires a provider id
   or a name plus corroborating context, and refuses ambiguous matches.
7. **Are events matched?** Event identity is internal to the odds provider.
   Cross-provider event matching is NOT implemented.
8. **Are team IDs normalized?** Partially. `sameTeam()` compares loosely. The
   live board returns `team: ""` on props, which is the main blocker for
   opponent-aware research — see MISSING below.
9. **Are game logs stored?** No. They are fetched per request and cached in
   memory by the SportsDataIO client. Nothing is persisted to `line_snapshots`
   equivalents for game logs.
10. **Is the frontend requesting the correct APIs?** It is now:
    `/api/apex/research` is proxied to `apex-v2` and consumed by the drawer.

## Working

| Capability | Where |
| --- | --- |
| Live prop board, sportsbook comparison, best over/under | `apex-v2/provider.mjs`, shell |
| Line movement storage + read | `lib/autoscout/supabase-persistence.mjs`, `/api/apex/line-history` |
| Player→provider identity resolution | `lib/data-sources/identity.mjs` |
| Game-log fetch | `lib/data-sources/sportsdataio` (`playerGameLog`) |
| L5/L10/L15/L20/Season/H2H hit rates + averages | `lib/research/service.mjs` |
| Push handling (excluded from denominator) | `hitRateFor()` |
| Game-by-game bar chart with movable line threshold | `apex-v2/scout-ui-v4.js` |
| Instant recalculation when the line or side changes | client-side, no refetch |
| Research game log table | drawer |
| Market mapping incl. derived PRA/PR/PA/RA/STOCKS | `lib/research/market-keys.mjs`, `sportsdataio/markets.mjs` |

## Missing, and what each is waiting on

| Gap | Blocked by | Notes |
| --- | --- | --- |
| **Player team on props** | The Odds API returns `team: ""` | Without it, opponent cannot be derived, so H2H and home/away splits stay empty for most props. Needs a team backfill from the SportsDataIO player directory. |
| **Minutes, started/bench, team result in the game log** | `gameLogValues()` extracts only value/date/opponent/home-away | Additive change to `normalize.mjs` + `rolling.mjs`; the columns exist in the provider payload. |
| **Projections and edge** | No projection model | `projections` feed exists in the endpoint catalog. Nothing computes a defensible probability, so no EV/edge is displayed. Do not ship a fabricated one. |
| **Opponent rank / defense vs position / pace** | `teamSeasonStats` is fetched but not surfaced | Requires positional splits SportsDataIO may not expose on the current plan. |
| **Injuries and depth chart in the research view** | Feeds exist (`injuries`, `depthCharts`) but are not surfaced in `/apex` | Wiring only. |
| **Player headshots** | No licensed image source | `/api/apex/player-artwork` currently 404s for most players; the UI falls back to initials. Will not be scraped. |
| **With/without teammate filters** | Requires per-game lineup participation history | Not available from the current feeds. |
| **Persisted game logs** | No storage layer for them | Every research open re-fetches (cached in memory only). |
| **Alternate lines** | Opt-in in the board, not in research | Research always uses the consensus/main line as its starting point. |
| **Live in-game stats** | `games` feed wired for scores only | No live player stat stream. |

## Unverified

- `playerGameLog` has **not** been executed against a live SportsDataIO key from
  this environment; no key is present here. The service, hit-rate maths, market
  mapping, and the whole drawer were verified against a harness using the real
  live prop payload. First production open of the drawer is the real test of
  the provider call.
- If SportsDataIO's plan does not cover `PlayerGameStatsBySeason` for a league,
  the drawer will report "No historical game data available for this player."
  That message distinguishes a plan/entitlement problem from a UI problem.

## Empty-state contract

Every research failure returns HTTP 200 with `available:false` and a sentence
the UI prints verbatim:

- `PROVIDER_NOT_CONFIGURED` — stats provider not connected.
- `MARKET_UNSUPPORTED` — no historical stat mapping for this market.
- `PLAYER_UNMATCHED` — player could not be matched to the statistics provider.
- `NO_GAME_LOG` — no historical game data available for this player.
- `PROVIDER_ERROR` — the statistics provider did not respond.

A blank research panel is a bug. A stated reason is an answer.
