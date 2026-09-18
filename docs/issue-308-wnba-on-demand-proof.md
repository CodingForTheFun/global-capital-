# Issue #308: one-game, read-only WNBA proof

This is an operator diagnostic, not a scheduler, a collector, a repair, or a backfill.
An old `player_game_logs` timestamp is not evidence that on-demand research is stale.

## Run in a checkout of the branch under review

Use Node 22 (or Node >=20.3 for AbortSignal.any). No API keys or database credentials are required.

```sh
node --test tests/wnba-on-demand-proof.test.mjs tests/wnba-on-demand-provider-proof.test.mjs
node scripts/wnba-on-demand-proof.mjs --live --date 2026-09-17
```

Without `--live`, the CLI exits 2 before importing the provider or accessing the network.
Optional `--event-id <numeric-id>` and `--athlete-id <numeric-id>` narrow selection; they do not bypass verification.
By default, choose the earliest verified completed event on the Eastern-time slate, then the participant with most recorded minutes (ID tie-break). There is no fallback loop over players or games.

The diagnostic independently reads the dated ESPN WNBA scoreboard and that game's summary. It requires a completed regular/postseason event, matching event/team identity, a WNBA league, and positive box-score minutes. DNP/inactive and unknown stats are rejected; an actual zero in PTS remains valid.

It then invokes a fresh `createPublicResearch()` from `lib/data-sources/espn/research.mjs`, the same factory that supplies `fetchPublicResearch`. The request uses the supported full-game `player_points` market. Success requires the returned athlete identity, exact `wnba:<event-id>`, timestamp, season/type, team/opponent IDs, positive minutes, and points to match the independently verified box score. A date alone does not pass.

## Safety boundary

Only new diagnostic, CLI, test, and documentation files are added. No production behavior is modified.
The diagnostic does not import `research-service-v2`, invoke `researchPlayerProp`, run H2H backfill, queue persistence, query the database, evict the production cache, modify auth, or alter provider polling. Its isolated factory only warms its own short-lived in-memory cache.

All injected network access is credential-free GET with redirects rejected and a strict ESPN endpoint/verified-athlete/team allowlist. No keys, cookies, raw error strings, raw payloads, or environment variables are printed. Native prior-season requests are blocked before network access, rather than forced or widened. A blocked read is recorded; it never manufactures game rows.

Limits: 10 total upstream requests, 30-second whole-probe deadline, 7-second request timeout, 2,000,000 response bytes. Duplicate requests are blocked. A transport failure prevents further upstream requests. No cron, automatic live CI job, HTTP debug route, or npm live hook is added.

## Interpret the JSON and exit code

- `HEALTHY` / 0: this one verified game was returned by the isolated supported provider path, with matching points.
- `FAILING` / 1: returned identity/data conflict, duplicate target event, or successful complete current-season output omits the verified event without a transport/policy block.
- `UNVERIFIABLE` / 2: prerequisite/schema/identity proof unavailable, upstream failure, incomplete coverage, policy block affecting a negative result, timeout, or exact provider fail-closed result. `providerCode` retains that provider code when available.

Output records the observation time, selected participant/event, supported market, request count and sanitized status/error trace, returned coverage, and SHA-256 of the provider source file. The source hash is NOT a deployment SHA: record `git rev-parse HEAD` and the runtime/deployment identity separately when attaching evidence to #308.

This tests the supported on-demand provider source path without the persistence-writing outer wrapper. It does NOT prove the customer HTTP route, authentication, finalization, deferred persistence, or the already-running process's cache contents. A local/CI run is not production-runtime evidence. To make the in-runtime claim, execute against the matching deployed source in an authorized read-only production diagnostic session; do not redeploy or restart simply to obtain proof.

## Regression and verification record

The unit suite deliberately uses clearly labeled artificial test objects. They are not real September 17 history. The integration suite reuses the repository's existing August WNBA capture without changing its dates and imports the actual provider factory. Neither fixture suite proves current live ESPN behavior.

At preparation: 16 unit tests passed on Node 22.16.0; CLI opt-in guard returned intentional exit 2; syntax checks passed. The two actual-provider integration tests are added for the full repository, but have not been executed in the isolated local artifact directory. Direct ESPN access failed here at DNS resolution; no verified September 17 participant or returned live game has been established. Keep #308 open pending integration CI and the real read-only runtime result.
