# Backend release-parent recovery — 2026-09-20

This is a release-control-only recovery marker after the direct watched deploy-lock push at `fdaee0e42c795d41d1144973daf8e1760a6c74e0` was correctly rejected by the production review gate.

- Source application change: PR #439 (`Contain #326 on current backend head`).
- No ObligeProps application behavior changes are made here.
- This file is not the active Railway watched deploy-lock path, so this merge should not start a customer-facing deployment.
- No provider, auth, scheduler/lease, quote-expiry, persistence, polling, secret, billing, or database changes are included.
- Purpose: restore a PR-backed serialized parent so a separate reviewed deploy-lock PR can release the already-tested #326 backend duplicate-chunk fast-fail through the normal production gate.
