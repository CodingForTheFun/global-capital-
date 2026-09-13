# Main sportsbook interface, projections and Ask repair

Owner request: make the sportsbook the main ObligePay application; Auto Scout stays beside Tools. Add projected stat, fix Ask, include verified Taco promotions and broaden book/prop coverage.

## Implemented
- Root `/` now serves the game-market workspace for every session. `/sportsbooks` remains an alias. `/preview` retains clearly labeled samples. Existing `/apex` is unchanged except projected-stat display.
- Real featured game odds (moneyline, spread, total) use The Odds API. Shared provider quota accounting; 15-minute cache; concurrent requests coalesced; persistent 120-credit/day featured-game budget. No new scheduler. All returned book choices are rendered. Past start times are NOT asserted to mean live games.
- Game selections and a reference single/parlay calculator. Same-game and mixed-book parlays have no invented multiplier. No wager processing, deposit, withdrawal, settlement, or customer funds ledger is connected.
- Prop columns show every returned book, not the previous four-column cap. Drill-down calls the existing game-history/Ask/projection endpoints.
- Projected stat separates AI model output from the recent-form baseline. The baseline is the recency-weighted mean of 4–25 verified game results (six-game half-life); no opponent/injury adjustment or claim of calibrated future accuracy.
- Ask now chooses the configured provider (including Gemini), with optional explicit ASK_PROVIDER/ASK_MODEL. Gemini uses the existing runtime key, server-side, with bounded card context. Existing account limits and routes remain intact.
- Separate Taco board and strict promotion metadata adapter. No low line, +100 price, alternate, Goblin, or generic discount is inferred to be a Taco. Expired or unverifiable promotions are excluded. No extra promo polling.

## Verified limitation
A single unauthenticated public PrizePicks projections request returned HTTP 403 on this release investigation. No proxy, bypass, or retries were used. The connected odds feed does not yet provide verified Taco metadata. Therefore live Taco ingestion is NOT certified; the page reports this limitation instead of generating offers. Promotion adapter fixtures are tests only.

## Scope and budget
Broaden THE_ODDS_API_REGIONS to us,us2,us_dfs at rollout to include the provider's available US sportsbook and DFS groups, rather than ten named books. Keep the owner's existing per-refresh budget (observed 500 credits), market caps and single persistence scheduler. Broader scope can still be partial under that budget. Do not advertise every worldwide sportsbook/prop. Specialty/non-Over-Under props still require their own outcome semantics; this release does not coerce them into numeric player props.

## Verification
Run npm run check, Next.js build, original guest/account suite (now at /preview), original workspace tests (Player props tab) and scripts/verify-sportsbook.mjs. Test accounts and feeds exist only in isolated temporary data. Verify deployed SHA, live account readiness, actual game-market HTTP response and one real guest AI answer without creating production users. No merchant or wagering capability is implied by passing UI tests.
