# Odds API production hotfix

Branch: `chatgpt/autoscout-odds-stability-20260913`
Base: `cb9d51e56eda2754169249785fb4f0f23776be51`

Active adapter is `lib/autoscout/providers/the-odds-api.mjs`; the requested
`apex-v2/the-odds-api-v2.mjs` has no production callers. Preserve its fixtures.

Findings: forced refreshes bypassed wrapper sharing; independent leagues each
started four concurrent calls; no provider-wide cooldown; startup warmed every
league. Large MLB responses were fully decorated, serialized, buffered, parsed,
cloned by the sanitizer and serialized again. A 23,220-line fixture used 547 MB
peak RSS through that path, versus 269 MB streaming identical sanitized JSON.
The production service has a 1 GB memory limit; observed restarts lacked a
specific OOM log, so the memory reproduction is evidence, not a claimed kernel diagnosis.

Ownership: Railway autoprop-worker uses the old autoprop-friends-v4 branch and
has no THE_ODDS_API_KEY. The data core inside autoprop-live remains the sole
scheduled Odds API owner. The frugal scheduler is disabled when ingestion is
on. No key, environment, billing, volume or worker settings changed.

Changes: shared forced/browser refreshes, stale-while-revalidate, persisted 429
cooldown, Retry-After and bounded backoff, one half-open probe, global limit 2
and 250 ms spacing, 12-second requests, temporary negative caches, shared market
discovery, no startup league fetch tree, overlapping-cycle guard, useful-market
idle detection, staggered/priority ingestion, serialized diagnostic writes.
Existing coverage budgets, market allocation and normalization remain intact.

Public props stream through the existing sanitizer row by row. The frontdoor
pipes only an attested loopback core props response; all other routes retain
existing sanitation. Shared audit results prevent duplicate per-reader trees.
Cold unavailable boards return a controlled 503; valid cached boards return 200.

Verification: 662 tests passed before final smoke-only adjustments. Mocked
coverage includes 10 callers, stale immediate return, failed refresh retention,
429/circuit recovery, discovery reuse, no-market expiry and a 23,000-row real
core HTTP response. Production smoke is skipped on PRs, waits for the deployed
SHA, checks NFL/MLB plus UI, cache and unchanged process start time once on push.
