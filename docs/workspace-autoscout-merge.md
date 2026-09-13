# Shared sportsbook-style workspace and Auto Scout

Owner approved deployment, then changed the direction from a separate site to
Auto Scout placed immediately beside Tools in the sports workspace.

Baseline: production-stable 09f9b050d81cad47d49884428de581265045bea3 (PR #45).
The unrelated uploaded React Router overlay is not deployed over this application.
Instead the existing Next.js frontend gains `/sportsbooks`, using ONLY the
existing same-origin `/api/account/me` and `/api/apex/props` APIs. No new paid
provider, scheduler, book API integration, payment service, or account store.

Navigation: Sports · Live · My Research · Analytics · Tools · Auto Scout.
Auto Scout is the original `/apex` application, same origin, same login, no iframe.
Its existing `.asBar` receives the same navigation using a small scoped script.
The existing guest `/`, `/preview`, account, research and AI routes are preserved.

The workspace is a player-prop sportsbook COMPARISON UI, not a licensed sportsbook.
It does not accept wagers or import the demo's balance/deposit/withdrawal code.
The image mockup's game moneyline/spread betting board is not a real new feed here.
Only actual existing prop-feed rows appear. Null prices remain line-only; no
invented L5, edge, ROI, sample games, or real-money balances appear in production.

My Research / Research Slip are session-storage snapshots scoped by account ID,
limited to 30 selections. They are separate from Auto Scout's existing Saved Props
and never write to wagers or account balances. Analytics is loaded-board coverage,
not predictive performance. Tools is a pure odds-format/reference calculator.

Release gate: existing release checks + existing Edge integrated build/QA + new
workspace tests (mocked prop data only in tests, isolated temporary local signup,
actual /apex navigation). Read-only post-deploy checks should verify the exact
release, the new public page, API auth gates, and live asset serving. Do not
claim actual wagering or merchant processing was enabled.
