# ObligePay Edge guest dashboard

Next.js App Router + TypeScript + Tailwind. Sample preview at `/` and `/preview`.
All displayed sample results and matchups are illustrative, not live data.
The signed-in production research board remains at `/apex` with its original feeds,
account permissions, provider budgets and user-owned data.

The production frontdoor runs this Next.js server internally on port 3004.
Public account requests remain handled by the existing `/api/account/*` backend.
The modal uses real register/login/verify handlers; Google is enabled only when
`/api/account/health` reports it configured. No new payment or wagering system.

`GET /api/ask-prop` establishes a signed HttpOnly guest session.
`POST /api/ask-prop` validates the sample card against server-owned fixtures, bounds
request size and prompt length, and uses the existing runtime Gemini key. One
successful answer per 12-hour guest session is enforced with atomic receipts on
the existing mounted data volume. Defensive limits: 3 receipts/IP and 60 global
receipts per 12 hours. IPs are HMAC-hashed, and questions are not persisted.
Deleting sessionStorage does not reset server usage. Clearing all cookies can
create a new anonymous session, so IP/global caps are also applied. This is not
proof of a unique person. Invalid and failed provider requests do not spend the
session question. Gray chart bars are pushes and excluded from hit rate.

Local standalone UI: `npm install && npm run dev`. Account endpoints require the
integrated frontdoor. Integrated build and browser validation run through the
repository's Edge release workflow. No API keys are needed for the fixture tests.
