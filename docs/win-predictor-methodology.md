# Win Predictor evidence checkpoint

The active player-research feed does not supply verified team-win forecasts or complete moneyline snapshots. Win Predictor must remain unavailable until an authorized feed supplies that evidence. The retired game-market route must not be re-enabled as a side effect. This module adds no requests, provider budgets or scheduled work.

`analyzeWinMarket` accepts canonical, exact-event bookmaker moneyline snapshots. Event, sport, teams, kickoff, period and settlement must match. A provider adapter must verify the event mapping and settlement rules before constructing this contract; neither names alone nor a sport-based assumption is sufficient.

For each complete book, convert American odds to implied probabilities and divide by their total. Average those normalized vectors equally across at least two distinct books observed within five minutes and within one minute of each other. These freshness thresholds are product eligibility rules, not claims of predictive accuracy. Missing, contradictory and malformed latest evidence fails closed. Never combine the best price for each outcome into a probability distribution.

Three-way regulation includes the draw. Two-way markets that refund a draw estimate probabilities conditional on a non-draw; they do not estimate draw probability. Full-game markets and regulation markets stay separate. Proportional margin removal is an assumption, and correlated books do not represent independent model votes.

Output is explicitly market-implied and never a trained prediction. A future trained Win Predictor needs its own verified model artifact, leakage-free chronological validation, documented outcome/settlement definition, calibration results, event coverage and expiry contract. Player hit rates, player projections and LLM commentary cannot substitute for that evidence.
