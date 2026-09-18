# Issue 327: bounded ingestion, without a new scheduler

## Evidence and scope

Production recovered before this patch. The historical scheduler-output gap is
not proof of a socket leak: realtime/webhooks continued, and later gaps did not
carry the earlier ephemeral-port warning. This patch addresses a reproducible
HTTP/2 settlement defect and the unbounded scheduler awaits; it does not claim
to reconstruct which request caused the historical 32-minute gap.

The HTTP/2 request timer previously called stream.close() without rejecting its
response promise. A close-only stream or session error could leave that promise
pending. The request now settles on deadline, premature close, session error or
abort, and destroys only its own stream/session. Successful responses preserve
the existing body, headers, redirect and size handling.

## Bounded behavior

`operation-deadline.mjs` uses monotonic elapsed time and async-local cancellation.
The bounds are upper limits, not polling intervals or new retry schedules:

| Operation | Maximum wait |
| --- | ---: |
| Whole persistence run | 270 seconds |
| Existing worker group | 180 seconds |
| One provider/sport ingestion | 90 seconds |
| One cache-only canonical sport or retention operation | 60 seconds |
| One supplemental feed refresh | 45 seconds |
| Lease claim/state coordination | 25 seconds |
| Best-effort status | 10 seconds |
| Owner release | 8 seconds |

The free-sportsbook fetch deadline keeps its existing configured value. Parent
cancellation and existing request timeouts are composed, not replaced. HTTP/2
sessions and per-request browser contexts are closed on cancellation; the shared
browser, realtime and webhook transports are not stopped.

Timeout returns control without pretending to cancel an uncooperative promise.
The original task remains quarantined by its static source/sport key until it
actually settles. Later cycles skip that key rather than adding duplicate work;
other keys can continue. Late rejections are consumed. Async-local write gates
reject new chunks, finalization and fallback requests from an expired operation.
A permanently non-cooperative task remains unavailable and visible in quarantine;
this intentionally does not implement auto-restarts or unlimited retry queues.

Bounds apply to asynchronous waits while the event loop can run; they do not
preempt a synchronous CPU loop or undo a database transaction already accepted
by the server. Existing database observed-at and finalization rules remain the
source of truth for those writes. No claim of transaction rollback is made.

## Invariants retained

- Claim/release remain canonical-first with the existing conditional direct
  fallback. Only the owner returned by the database is released. A late or
  ambiguous claim never authorizes exclusive provider fan-out or a guessed
  release. Expired cleanup is left to database lease expiry.
- Existing database-derived next_at/leaseUntil/dbNow retry policy remains
  unchanged: one bounded retry, never recursive. No forced lease reset or
  client-side replacement lease is introduced.
- Provider lists, sport lists, endpoint selection, force flags, polling cadence,
  TTLs, error/no-props cooldowns, concurrency ceilings and paid quota policy are
  unchanged. Canonical sports still use `cacheOnly: true`.
- Partial, failed and timed-out snapshots are retained, not finalized as empty
  successes. No TTL extension, invented rows, database migration, credential
  change, auth change or customer-facing API contract change is included.
- Retention enablement, age floor and cadence are unchanged.

## Verification and rollout gate

Run `npm run check` with the committed lockfile. New fault-injection tests cover
silent HTTP/2 peers, premature close/error, repeated connection cleanup, parent
abort, late completion/rejection, duplicate-attempt quarantine, provider/sport
continuation, sync-guard recovery, ambiguous claims, blocked status/release, and
no late chunk/finalization/direct fallback. The pre-existing source-text status
assertion is now a behavioral test of rejected status writes and owner release.
No permissions/auth assertion was removed or skipped.

Before closing #327, promote only the reviewed exact SHA and verify real
scheduler completions across multiple existing polling/lease cycles, advancing
durable sport/source timestamps, actual-owner lease behavior, retained data
through a timeout, normal realtime/webhook activity, and bounded connection
counts. Do not manufacture an upstream outage against customers. Do not close
the issue merely because a deployment is healthy. This patch introduces no
automatic restart, paid polling expansion, or scheduled monitoring task.
