# Release-parent recovery — 2026-09-21

Release-control only. No ObligeProps application behaviour changes here.

`production-stable` head `7dff776` carries a failed
`AutoProp Scout Pro - autoprop-live` status: its deploy-lock PR (#484) was
merged without an approving review, and the release gate correctly refused to
start a customer-facing deployment.

That failed status also makes `7dff776` unusable as a release parent, because
the gate requires the first parent of a release to carry a successful
`autoprop-live` status. Left alone it would block the next release from any
author, not only this one.

This file is deliberately **not** the watched Railway deploy-lock path, so
merging it does not start a deployment: Railway skips the build and records a
successful status, which restores a serialized parent a later reviewed
deploy-lock PR can release from. Same procedure as
`release-parent-recovery-20260920.md`.

Carried with this recovery:

- The mobile nav dock fix. The dock is centred by `left:50%` plus
  `translateX(-50%)`, and the scroll-hide patch overrode `transform` without the
  `-50%`, stranding it at the 50% mark. Measured on a 390px viewport: left 195,
  right 571, so 181px sat off-screen and Best Lines, Compare, News and Moves
  could not be reached at all on a phone. Now left 7, right 383.

No provider, auth, scheduler/lease, quote-expiry, persistence, polling, secret,
billing or database changes are included.
