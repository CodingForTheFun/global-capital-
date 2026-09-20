# Release parent recovery — 2026-09-20

This documentation-only commit restores a clean Railway release parent after an
undeployable direct watch-marker push. It changes no ObligeProps application,
provider, auth, scheduler, lease, quote-expiry, persistence, or polling behavior.

The customer-facing opponent-directory code was already merged in PR #431.
After this documentation-only commit is merged, Railway should skip the
autoprop-live build because the active watch pattern matches only the dedicated
manual deploy-lock file. That skipped commit provides the serialized parent
status required before the next reviewed deploy-lock PR can start.
