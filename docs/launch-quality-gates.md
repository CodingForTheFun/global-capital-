# Oblige Props launch quality gates

A "10/10" release is a measurable release gate, not a promise that software can never fail.

## Product / UX
- Oblige Props branding is consistent on the landing page, installed web app and research shell.
- Mobile layout supports current iPhone widths without horizontal overflow in the primary prop workflow.
- Loading, unavailable, stale and retry states are explicit; missing data is never fabricated.
- Owner controls are absent from customer navigation and owner files return 404 to non-owner sessions.

## Live data
- Production health responds successfully.
- Public/zero-credit ingestion remains the primary feed path where supported.
- Provider failures degrade by source/sport rather than blanking the entire board.
- Prop identity, source/book identity, event time and line are preserved through normalization.
- Historical percentages are shown only when verified game-log evidence exists.

## Accounts / security
- Owner role is server-enforced.
- Ban immediately revokes active sessions.
- Device-level sign-out is supported.
- CSRF protection is required for owner mutations.
- API keys, password hashes, payment secrets and Railway settings never appear in owner UI responses.
- Owner-granted complimentary Pro time cannot modify processor-managed paid access.

## iPhone web app
- Manifest name is Oblige Props and display mode is standalone.
- iOS standalone/title/status-bar metadata is present.
- Service worker caches static shell assets only; no API, admin or navigation response is cached.
- Safari Add to Home Screen / Open as Web App is the immediate distribution path.

## Payments before public charging
- Processor account is approved for the product category.
- Checkout is authenticated and server-created.
- Processor confirmation/webhook is verified server-side before Pro is granted.
- Refund/cancellation/chargeback events revoke or adjust processor-managed entitlements.
- Replayed events are idempotent.
- Pricing, Terms, Privacy, Refund/Cancellation and monitored Contact pages are live before checkout.
- The production checkout is smoke-tested with a real low-value transaction and refund before opening paid traffic.

## Native App Store release
- Do not ship a thin WebView wrapper.
- Add app-specific native value (for example saved-prop/snipe push alerts, deep links, native notification controls and biometric re-entry).
- Complete Apple Developer signing, App Store Connect privacy/metadata, TestFlight/on-device QA and review access.
- Keep the product an analytics/research service: no wager execution, deposits, stakes or outcome guarantees.
