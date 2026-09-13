# ObligePay Edge — independent standalone preview

This branch contains a complete separate React/TypeScript sports-dashboard implementation of the approved visual concept. It is NOT the ObligePay Auto Scout application and must never be merged over production-stable or main. Deploy it to its own hosting project/service and URL.

## Run

```
cd frontend
npm install
npm test
npm run build
cd ..
node server.mjs
```

One small static Node server. No database, account credentials, sportsbook API key, payment processor, external imagery, analytics tracker or paid LLM is used. The existing Auto Scout project is not modified or called.

## Features

- Dark slate/emerald desktop dashboard and responsive mobile slip drawer.
- Sample NBA/NFL/MLB markets, sport/book/search/market filters.
- Original-line sample selection toggles with independent local Redux workspace.
- Player research modal: half-point line, over/under, L5/L10, strict hits and pushes.
- Hypothetical same-game parlay prices are blocked. Adjusted research lines cannot reuse original odds.
- Demo slips, virtual credits, local history, CSV export and odds calculator.
- Lucide React, Sonner, Tailwind, clsx, tailwind-merge.
- No real bets, deposits, withdrawals, live lines, subscriptions or account login.

All displayed market fixtures and player results are illustrative; they are not live data. Saved demo slips are ungraded. Virtual credits have no cash value. Local browser storage is namespaced and isolated by the new site's origin. The API rejects unsupported account/payment/wagering actions rather than impersonating a backend.

The earlier modernization overlay depended on another repository's missing Redux/API modules. This independent app avoids deploying that incomplete overlay or wiring it to an unknown backend. It implements the visual concept and sample interactions; it is not a migration of the original sportsbook's backend contracts.

CI verifies TypeScript, build, arithmetic, desktop/mobile interactions and optional live public-origin verification. Fixtures and screenshots are retained as artifacts. No production Auto Scout state is read or changed.
