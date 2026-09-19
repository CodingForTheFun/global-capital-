# Issue #325: bounded source freshness and timeout-flapping repair

Base examined: production-stable 7d2e80f33247e3112c5a9527c2b5630ca95d0aa2.

## Evidence and limits

On 2026-09-19 at 10:35 and 10:37 UTC, current production repeated the direct
Underdog timeout / spare HTTP 426 pattern. PrizePicks continued refreshing.
At 10:38:25 UTC the public store contained 6,979 active Underdog rows: 6,946
fresh within ten minutes, 33 older than ten minutes and expiring within five
minutes. Last observed timestamp was 10:32:08.986 UTC. This is not a new
scheduler-wide stall. These counts are an audit snapshot, not timeless values.

The production SQL intentionally skips materially unchanged row updates until
eight minutes old. Thus written=0 is not zero coverage, and max(observed_at)
is not evidence that every row is fresh. Bookmaker names alone do not identify
ingestion paths. This diagnostic scopes itself to active_props.source and
sport in the public store; PropLine's independent live/canonical paths are not
claimed as covered by this report.

## Changes

- Release non-2xx response bodies and abort each owned request on exit. Existing
  12-second request budget, URL order, pagination, feed TTL, retry-after,
  exponential backoff, max bytes, and scheduler/deadline fences remain intact.
- Keep primary transport cause separate from a spare's status. A failed
  Underdog primary timeout no longer launches HTTP2/browser/edge/paid fallback
  attempts in the same recovery chain. Normal scheduled attempts, both current
  direct URLs, and genuine non-timeout zero-credit recovery remain available.
- Persist bounded source attempt metadata in the existing atomic feed cache:
  attempt/completion time, duration, primary cause, consecutive successes and
  at most twelve observations in the previous hour. Three transitions flag
  flapping. Cached reads never count as attempts or new successful observations.
- Add one aggregate-only, token-protected database read. The existing feed-cache
  refresh calls it; there is no new timer or scheduler. Single-flight, at most
  once per minute, 2.5-second client budget, existing ingestion deadline, no
  retries or database fallback. It does not call any upstream provider.
- Log source/sport active, fresh, stale, soon-expiring and expired-upcoming rows;
  include Underdog and PrizePicks even at zero. Other known sources are retained
  in the catalog, not asserted to be an exhaustive enabled provider universe.
- Warn/critically report degradation, deduplicate unchanged incidents, and keep
  recovery pending until two distinct newer persisted observations have fresh
  active rows. Never infer recovery from repeated cached reads or delta writes.
  A flapping window remains degraded until it actually settles.

The raw freshness share is freshRows/activeRows, NOT percent of all props that
exist at a bookmaker. Expiry counts include ordinary event starts; expired
coverage warnings specifically require future events. A recent successful empty
fetch may be idle; missing/error telemetry is unknown, never a fabricated zero.
Last-known-good values and their timestamps/expiry are not extended or rewritten
by any diagnostic. There are no user/auth, secrets, paid-polling, research/UI,
webhook, lease, quota, provider scope, account, or production configuration changes.

## Release gates (do not close #325 on a single recovery)

1. Run the exact candidate's full release checks and integration regressions.
2. Review scripts/sql/source-freshness-install.sql against the live schema. It
   creates one aggregate-only function with the existing backend-token check,
   empty search_path, no row writes, and explicit grants/revokes in one
   transaction. It is NOT automatically applied by the application. Validate
   rejection of null/invalid tokens and publishable-key-only calls, valid backend
   access, response contract, aggregate accuracy and query budget before rollout.
   It intentionally uses CREATE, not replacement of an existing function.
3. Deploy only the tested combined candidate on the latest production head.
   Confirm the actual Railway SHA and read-only observer logs. Missing function
   or authorization errors must show UNKNOWN without affecting ingestion.
4. Observe at least two *scheduled*, distinct successful Underdog observations
   with DB read-back. Verify fresh active rows per sport and no concealed expired
   upcoming cohort, no fallback/paid credit changes, no later writes by timed-out
   tasks, intact lease ownership, other-source progress, and canonical health.
   Keep open through a recurrence-free observation window spanning the existing
   fifteen-minute retained-data TTL; no forced upstream probes or restart cure.

## Rollback

Revert only this application commit on the current production branch after
preserving intervening changes. The additive SQL function may remain unused;
removing it is unnecessary for recovery. Do not reset provider caches, extend
expires_at, truncate tables, rotate secrets, reset leases, widen polling, or
enable paid fallback. The observer logs require an existing operations log/alert
consumer for external notification; this patch does not create a notification
subscription or close GitHub issues automatically.
