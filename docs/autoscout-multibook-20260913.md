# Multi-platform data and filters

Production base: 91cd90f. Preserve the Odds API request gate, catalog cache and
single ingestion owner. The 25 requested platforms share `lib/constants/books.mjs`;
`books.ts` exposes the typed contract. Registration is not a live-coverage claim.
Unknown genuine provider books are also retained in the drawer.

The existing scheduled worker refreshes public supplemental feeds sequentially,
sharing a provider-wide promise/cache across sports. Browsers read cache; book
selection never requests provider data. TTL is ten minutes (Sleeper: one day),
with persisted last-good snapshots and Retry-After/exponential failure cooldown.
Pagination is bounded and partial coverage is explicit. Requests stop on access
errors; there is no proxy, authentication bypass, new credential or new scheduler.

PrizePicks JSON:API and Underdog appearance/player/game relations map into native
collections and the paired `active_props` shape. Missing prices remain null.
Only a unique exact player, start time, sport, team and stat match can reuse an
existing provider identity. Otherwise identities stay provider-scoped. Native
collections use existing persistence when the scheduled board is written.
Supplemental `active_props` snapshots also persist in the existing DATA_DIR.
`/api/apex/active-props?sport=NFL&books=draftkings,fanduel` exposes a protected,
cache-only paired view (default 100 rows, max 500, offset pagination). No database
schema replacement or migration is required. An empty books parameter means none.

LocalStorage `autoscout-selected-books`: null means all books, including newly
available provider books; [] means none; an array selects canonical IDs. The old
single-book preference migrates once. Filtering happens before grouping, target
selection, consensus, odds display, research repricing, studio and discrepancies.
Saved snapshots and storage events also honor the selected set. Game logs remain
the sole basis of rolling hit rates.

## Feed boundaries

- Sleeper `/v1/players/nfl` is a roster/identity feed, not pick'em projections.
  It cannot create a Sleeper prop line. Its documentation also distinguishes
  commercial licensing: https://docs.sleeper.com/.
- Kalshi public markets and Polymarket Gamma events are ingested as contracts.
  Generic Yes/No questions are not automatically sportsbook player props.
- Exchange promotion requires an exact reviewed mapping in the optional
  AUTOSCOUT_EXCHANGE_MAPPINGS_FILE JSON array: book, sourceId, verified,
  evidenceUrl, expectedTitle, expectedRules, period='game', yesSide='OVER',
  settlement='strict-over-no-push', expiresAt, nativePlayerId, playerName, sport,
  market, line, gameStartTime, team, nativeEventId, homeTeam, awayTeam.
  Source title/rules/threshold must still agree. Integer thresholds, combos,
  expired mappings and changed contracts fail closed. None are pre-invented.
- Kalshi ask equivalents are gross/pre-fee quotes, marked exchange payout type
  and excluded from straight-book Pro Tools mathematics. Gamma indicative marks
  remain contract metadata; they are not executable sportsbook over/under odds.
- All other named platforms can display/filter their real lines supplied by the
  existing odds provider. No unverified endpoints are invented for platforms
  lacking an available feed. Registry support does not imply 25 live integrations.

Official API references:
https://docs.kalshi.com/api-reference/market/get-markets
https://docs.polymarket.com/api-reference/events/list-events

Verification: mocked adapter, identity, filtering, rate-limit, pagination and
cache regressions; five viewport browser selection/persistence/line/discrepancy
checks; existing full release/account/ML tests. Production feed coverage must be
reported from the deployed feed diagnostics, not from mocked fixtures.
