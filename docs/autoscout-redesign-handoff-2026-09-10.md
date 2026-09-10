# Auto Scout redesign — Phase 2 candidate

Base: production-stable fc93118. Feature branch: chatgpt/autoscout-paid-research.

All four implementation milestones are committed and published. Preserve newer work when resuming. Do not repeat Phase 1 or rebuild these components.

## Implemented

- Readable navy workspace, contained sticky desktop table, responsive cards, primary navigation, full-screen mobile drawer with Back.
- Native filter sheet, active-filter count, per-sport saved filters, date filter, optional Rules switch (only statistical thresholds), hidden columns and sortable column controls.
- Explicit bounded research batches and on-demand drawer requests. Showing more rows no longer fetches historical research automatically.
- Overview, Game log and Compare lines panels, keyboard navigation, lazy history, partial-coverage explanations, unloaded-vs-unavailable values and sportsbook identity even without quoted odds.
- ClearSports matches provider-prefixed team IDs via the shared strict matcher. Supplied injury context survives unavailable game logs and fallback selection; a full pipeline regression verifies the injury, genuine zero season total and absent projection are retained correctly.
- Saved request generation guards, per-prop pending mutation guard, immediate server-profile state removal on successful logout and nonblocking initial board load.

## Verification and limitations

`npm run check`: 309 passed, zero failed. Changed UI JavaScript syntax and diff whitespace passed. One later focus-restoration selector adjustment received syntax verification. Existing security and persistence tests are included in the suite.

No browser QA has been claimed for this candidate. The known supervised preview restriction remains; do not retry alternate hosts or ports to bypass it. Complete the requested High desktop/mobile review, then return to Medium for verified defects.

Three provider key names are present in Railway, but OAuth withholds their values. A live public API request in this session was blocked by network policy; provider account access and real projection/game-log availability have not been verified. Do not equate the local response-fixture tests with proof of live provider coverage. The ClearSports official documentation at https://www.clearsportsapi.com/docs still does not document WNBA or MLB player-stat feeds; do not invent endpoints or assume its NBA game predictions are player projections.

Last inspected Railway deployment: 5f83a1c4-0a2c-41d3-bad8-201c1fbb7a5b, SUCCESS but still source 25dec72. Existing merged Astra source fc93118 has not been confirmed live. Ordinary redeploy reused the old snapshot; the Railway agent reported a usage limit. Preserve all unrelated staged Railway changes. Release requires deploying the verified new source, checking the exact commit and testing live research. Do not report this redesign as deployed.
