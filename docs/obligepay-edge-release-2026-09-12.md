# ObligePay Edge release integration — 2026-09-12

Owner requested deployment of the sportsbook-style merge and Next.js guest dashboard.
Actual production uses `production-stable`, not `main`. Base: 3a470ad8bb35f2d92173a5d495c9fc1a459b5f20.
PR #41 was based on old `main`; do not deploy that tree over production.
This candidate selectively imports its guest app and theme, preserving all current
account, entitlement, provider normalization, PrizePicks/Underdog, and ingestion code.

Architecture: unchanged Railway `autoprop-live` service and mounted `/app/data`.
Unchanged configured command `node frontdoor-clearsports.mjs` starts the existing
frontdoor and an internal Next.js process on port 3004. Anonymous `/` and public
`/preview` serve the guest dashboard; signed-in `/` and `/apex` retain the real
research board. Existing account routes handle registration/login. Google is
explicitly unavailable when not configured. Authenticated routes are not ungated.
The healthcheck remains `/api/health` and also waits for the new guest process.

No production API keys are changed or exposed. Guest Q&A uses the existing
runtime Gemini key, with sample-only validated context, bounded payloads, one
answer per signed guest session, mounted-volume receipts and spend limits.
No additional provider feed, scheduler, paid hosting service, or database is added.
The existing payment implementation is preserved, not declared operational:
PayPal requires merchant credentials and approval; nothing here takes wagers.

Validation: use the Edge integrated release workflow plus existing release checks.
Its signup account and LLM fixture exist only in a temporary local test data path.
Promote only the tested candidate into production-stable. After rollout, verify
Railway reports SUCCESS for the promoted SHA, public root + `/preview` load, old
research/account routes remain reachable, and assets and healthchecks succeed.
Rollback is the previous production deployment, not old `main` or PR #41.
