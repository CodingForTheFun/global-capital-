# Auto Scout — production coordination

Read this file before changing production. Multiple build conversations share
this repository; do not assume another conversation sees unpushed local work.

## Current owner direction — 2026-09-13

The owner explicitly reversed the ObligePay Sportsbook expansion. ObligePay.com
is the home of Auto Scout again. Remove the sportsbook from the deployed product,
not the working research engines. Visible product branding: **Auto Scout**.
Do not bring the sportsbook homepage or shared sportsbook tabs back from an older
branch. The original v5 research frontend remains the application; reuse only the
preferred navy/emerald presentation, panel spacing and navigation styling.

Restoration branch: `chatgpt/restore-autoscout-home-20260913`.
Base inspected: `d77624585961b48169b996b3d9b7a446d0965a0b`.
See `docs/autoscout-research-home-20260913.md` for exact changes and release gates.

## Production and preservation rules

- Repo: `CodingForTheFun/global-capital-`; source branch: `production-stable`.
- Railway: AutoProp Scout Pro / `autoprop-live`; start command remains
  `node frontdoor-clearsports.mjs`; production domain remains ObligePay.com.
- Work on a feature branch. Test the exact combined candidate; inspect current
  deployed SHA and configuration before promoting it. Preserve newer work.
- Keep `/` and `/apex` on the native research/account flow. Retired sportsbook
  pages redirect to Auto Scout. Retired guest/game-only APIs return 410.
- Do not migrate accounts, subscriptions, sessions, saved props or browser
  preference keys. Do not change secrets, Railway settings, volume or worker.
- Preserve account/billing routes, server-bound saves, player/event/market
  identities, research windows and game logs, Intelligence Studio, ML/Taco guards,
  original Ask/projections and the single active ingestion scheduler.
- Research presentation must not include wager execution, deposits, withdrawals,
  bankroll entry or a bet slip. Existing user data is not deleted.
- The retired Next.js sportsbook source is excluded from the deployed image and
  is retained only for recovery, not as another site or hidden product tab.

## Data and security invariants

- Regular/main lines only in the regular board/scanner; no Goblin, Demon, boosted,
  discounted or alternate outcomes. Today/tonight only where date-scoped.
- Taco-only research is a separate channel. Badges require verified, fresh,
  unexpired PrizePicks evidence for the EXACT offer, event, player, stat, side
  and line. No player-wide promotion flags or invented offers.
- Missing or ambiguous identity/data fails closed. Never fabricate logs, hit
  rates, injuries, projections, probabilities or trained model availability.
- Research statistics use the existing shared engine and its published push/
  season policy. Do not alter the legacy scanner policy incidentally.
- Do not expose another user's PickFinder credentials, sessions, saves or results.
  PickFinder is optional authenticated research, never the required prop universe.
- Provider-native data retains genuine source/book identity; do not call it
  PrizePicks unless the source explicitly identifies PrizePicks.
- Customer responses use the existing sanitizer. Keep diagnostics owner-only.
- Do not start a second ingestion scheduler or increase provider polling/budgets.
- ML predictions require genuine validated trained outputs. A missing model is
  unavailable; L5 rates or LLM analysis are not trained sports ML.
- Radar is currently visit-local; injury/lineup history and teammate participation
  remain unavailable when the underlying verified evidence has not been supplied.

## Full preserved handoff history

`docs/autoprop-coordination-history-pre-research-home.md` contains the complete,
unchanged preceding coordination file, including all cross-chat checkpoints,
provider contracts, history repairs and ML/Taco notes. Historical sportsbook
expansion instructions in that archive are superseded by the owner reversal above.

No deployment is claimed by this document. Verify CI, Railway source SHA and
actual rollout state before reporting that the restoration is live.
