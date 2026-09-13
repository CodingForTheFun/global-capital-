# Win Predictor evidence checkpoint

The active player-research feed does not supply verified team-win forecasts or complete moneyline snapshots. Win Predictor must remain unavailable until an authorized feed supplies that evidence. The retired game-market route must not be re-enabled as a side effect. This module adds no requests, provider budgets or scheduled work.

`analyzeWinMarket` accepts canonical, exact-event bookmaker moneyline snapshots. Event, sport, teams, kickoff, period and settlement must match. A provider adapter must verify the event mapping and settlement rules before constructing this contract; neither names alone nor a sport-based assumption is sufficient.

For each complete book, convert American odds to implied probabilities and divide by their total. Average those normalized vectors equally across at least two distinct books observed within five minutes and within one minute of each other. These freshness thresholds are product eligibility rules, not claims of predictive accuracy. Missing, contradictory and malformed latest evidence fails closed. Never combine the best price for each outcome into a probability distribution.

Three-way regulation includes the draw. Two-way markets that refund a draw estimate probabilities conditional on a non-draw; they do not estimate draw probability. Full-game markets and regulation markets stay separate. Proportional margin removal is an assumption, and correlated books do not represent independent model votes.

Output is explicitly market-implied and never a trained prediction. A future trained Win Predictor needs its own verified model artifact, leakage-free chronological validation, documented outcome/settlement definition, calibration results, event coverage and expiry contract. Player hit rates, player projections and LLM commentary cannot substitute for that evidence.

## Published forecast connection

The 2026-09-13 follow-up connects ESPN's published Matchup Predictor through the shared public-research request cache. A dated scoreboard must uniquely match league, home/away teams and exact kickoff; the summary independently rechecks that match and team IDs. Published percentages are displayed unchanged. Missing draw probability is never derived from the residual or silently set to zero. Only a confirmed scheduled pre-game status can publish the estimate. Retrieval time is disclosed; generation time and independent calibration are not supplied by this source.

The new account-gated `/api/apex/research-matchup` route also returns team-scoped injury reports, explicitly listed starters/probables, venue weather and available team records/rankings. These loads are on demand, share the existing concurrency/backoff cache, and add no scheduler or paid provider requests. Reports not published by the source remain unavailable. A probable pitcher is not a confirmed lineup; current injuries cannot create historical with/without-player effects. Public source references: https://www.espn.com/nfl/fpi and the exact ESPN game report linked in each response.

The earlier section describes the separate moneyline engine; its input feed remains unconnected. Published team-win estimates are not reused as player-prop probabilities or as calibrated EV+ evidence. Pro Tools can now request exact cached/trained/adaptive prop estimates through the existing ML endpoint when the user opens that check.
