---
description: Changing Stripe or PayPal integration, checkout, webhooks, entitlements, grantPlan, or the BILLING_ENABLED flag.
applies: Editing payments/stripe.mjs, lib/billing/*, entitlement grants, or any checkout or webhook route.
does_not_apply: Unrelated prop-board or research features that do not touch money or entitlements.
---
Billing on this project is real money against real customers once enabled.

- The entitlements layer is processor-agnostic: `grantPlan({accountId, plan,
  source, reference})`. New payment sources should call into it rather than
  duplicating entitlement logic per-processor.
- Webhook signature verification must be over raw bytes, with a timestamp
  window (5 minutes has been the standard here) and a constant-time compare
  that checks length first.
- `BILLING_ENABLED` stays off until the full flow (checkout, webhook,
  entitlement grant) has been verified end to end. Do not flip it on as a side
  effect of an unrelated change.
- Never print, log, or commit a live secret key, webhook secret, or client
  secret. `sk_live_`-prefixed keys mean live mode; treat any code path that
  branches on that prefix as security-sensitive.
- Test with `node --check` and an actual module load, not just syntax
  checking — a TDZ bug (a binding referenced before it's defined) passes
  `node --check` but throws at runtime the first time the route is hit.
