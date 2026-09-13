# Payment launch blockers

Do not open public paid traffic until all items below are closed.

1. Choose and approve the production processor/account for this sports-research subscription category.
2. Obtain written commercial/automated-access authorization or a licensed data agreement for every third-party feed used by the paid product where the provider's current terms restrict automated collection or commercial reuse. Replace any source that cannot be authorized.
3. Add authenticated checkout routes to the production frontdoor.
4. Verify processor success/webhook signatures server-side before granting Pro.
5. Make processor events idempotent and persist their references.
6. Wire cancellation, failed renewal, refund and chargeback events to entitlement changes.
7. Keep owner-granted complimentary access isolated from processor-managed access.
8. Publish pricing, Terms, Privacy, Refund/Cancellation and monitored Contact pages.
9. Complete a production purchase + entitlement + cancellation/refund smoke test.

Existing PayPal order helpers and checkout UI are not, by themselves, sufficient to call billing production-ready.
