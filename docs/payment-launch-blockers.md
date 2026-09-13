# Payment launch blockers

Do not open public paid traffic until all items below are closed.

1. Choose and approve the production processor/account for this sports-research subscription category.
2. Add authenticated checkout routes to the production frontdoor.
3. Verify processor success/webhook signatures server-side before granting Pro.
4. Make processor events idempotent and persist their references.
5. Wire cancellation, failed renewal, refund and chargeback events to entitlement changes.
6. Keep owner-granted complimentary access isolated from processor-managed access.
7. Publish pricing, Terms, Privacy, Refund/Cancellation and monitored Contact pages.
8. Complete a production purchase + entitlement + cancellation/refund smoke test.

Existing PayPal order helpers and checkout UI are not, by themselves, sufficient to call billing production-ready.
