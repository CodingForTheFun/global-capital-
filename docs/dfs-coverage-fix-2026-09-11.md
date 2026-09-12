# PrizePicks / Underdog coverage fix — 2026-09-11

## Scope and baseline

Targeted candidate based on production-stable `3a95ac06bdf41bc05e4ecd6b31640a4baa98211e` (also verified as the Railway production deployment). Read the production coordination contract and preserve all newer Astra/Claude application, authentication, research, and persistence work. No production merge, deployment, Railway configuration, credentials, billing, Supabase, or polling scheduler changes were made for this task.

## Confirmed implementation limitations

The deployed odds adapter defaulted to two events per sport, at most 25 popularity-ranked markets per event, and five bookmaker regions. This truncated the fetched universe and could deprioritize DFS-specific markets. It already supported the PrizePicks and Underdog bookmaker keys; another provider is not introduced. Missing quota headers also coerced null into zero in runtime accounting.

## Candidate changes

- Default to 25 listed events rather than two; retain explicit owner event limits (bounded at 100).
- Discover the returned supported market catalog without the old 25-market truncation. Default per-event ceiling is 100, bounded at 200 when explicitly configured.
- Prioritize PrizePicks/Underdog markets and allocate a constrained refresh across games before filling comparison markets.
- Default to the existing ten named DFS/comparison bookmakers rather than five regions. Explicit region/source overrides remain respected.
- Cap estimated provider spend at 250 credits per sport refresh by default via `THE_ODDS_API_MAX_CREDITS_PER_REFRESH`, honor known remaining quota, and reserve concurrent in-flight spend. This is a per-refresh ceiling, not a claim of a monthly spending cap.
- Preserve shared board caching/coalescing and the existing refresh cadence. Version the board's coverage signature so the old two-game cache cannot silently survive the policy change. Discovery cache is bounded and expires without adding polling.
- Keep successful games when a different event fails. Label incomplete, empty, excluded-source, and stale states honestly.
- Add `meta.coverage`: returned-catalog scope, games checked, market counts, reasons, and separate PrizePicks/Underdog counts and original update timestamps. Add safe copy through the existing `meta.warning` contract. No frontend redesign.
- Reject unsolicited bookmakers/markets, flagged promotions, alternate markets in regular requests, and non-default Underdog multipliers. Keep real zero values and missing values distinct. Do not create research statistics or relabel another book's line.
- Correct null quota-header handling without changing the rest of runtime storage.

## Verification actually performed

`node --test tests/dfs-coverage.test.mjs`: 19 reported tests passed, zero failures (18 subtests plus their parent).

Syntax checks passed for the modified adapter, new coverage helper, and runtime store. Git blob hashes of the unchanged source/dependencies were verified against GitHub before editing; uploaded candidate blobs are hash-matched to the local tested files.

Network-free tests exercise the actual adapter with explicitly synthetic HTTP fixtures: six games rather than two, 35 markets rather than 25, platform identity/counts/timestamps, zero values, legacy cache migration, shared-cache reuse, DFS priority, fair budget allocation, explicit caps, one-event failure, empty coverage, excluded sources, promotional/alternate rejection, region overrides, null quota headers, concurrent reservations, and stale fallback.

The fixture's 24 PrizePicks and 24 Underdog lines are TEST COUNTS, not live production counts. No paid live provider requests were made to obtain those results.

## Remaining release gates

The isolated coding environment has only the targeted source/dependencies and no production provider key. Full-repository `npm run check`, live-provider candidate verification, and candidate desktop/mobile browser QA are not claimed by the local test result. Use the existing release-check workflow on the candidate and verify real platform counts/timestamps before release. A successful smoke test of the old production site would not verify this candidate.

`coverage.complete` means the returned provider catalog was checked within the configured scope. It does NOT assert every selection on the consumer PrizePicks/Underdog apps is supplied by the provider. Event/market/budget limits, unavailable or unsupported markets, and upstream coverage can still yield partial boards; those states are now explicit. Larger slates may still require a consciously approved budget rather than unbounded polling.

Do not merge or deploy this candidate until the owner's release restriction is lifted and release gates are satisfied. No additional Astra or Claude task is required to preserve this checkpoint.
