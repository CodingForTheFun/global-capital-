# Issue 331: verified, all-sport history maintenance

This is a finite, opt-in maintenance path, not a new scheduler. The target is 100%
verified coverage of the active player population. Unsupported, ambiguous,
unavailable and budget-deferred players remain visible; they are not removed to
make a percentage look healthy. A successful canary is not full-board acceptance.

## Verified source trace

At production source `a73f28164e97cb834ef3d5d948a8a89d89c42c43`:

* `active_props` is the non-expired customer-board population used by issue 331.
  The existing `autoscout_public_history_store('history_candidates')` instead
  selects legacy `players -> props -> events`, with a 5,000-row cap. Those are
  different candidate populations. This is an identified coverage risk, not
  proof that every missing player has the same cause.
* `lib/data-sources/espn/identity.mjs` verifies exact normalized names, league,
  ESPN link/UID identity, and team context. Ambiguous matches fail closed.
  Suffix normalization already exists; blindly adding fuzzy name matches is not
  the repair.
* `lib/data-sources/espn/research.mjs` obtains public completed-game evidence,
  rejects wrong-league/incomplete/DNP games, and applies the existing market
  contract. Its current/current-prior-season behavior is unchanged here.
* `lib/autoscout/research-service-v2.mjs` warms history after successful public
  research, using a serialized, deduplicated queue capped at 40. This is
  visit-driven warming, not proof of complete active-board coverage. Its existing
  PropLine fallback does not pass through ESPN history persistence.
* `lib/ingestion/game-log-persistence.mjs` maps verified results into
  `history:SPORT:ESPN_ID` records. Maintenance reuses this mapper and adds a
  stricter validation/read-back boundary. It never uses opaque sportsbook IDs
  as ESPN IDs and never re-keys records on a display-name match.
* `normalizePrizePicks` currently passes `projection_type` into `period` when
  there is no explicit period. Maintenance recognizes `single_stat` only for
  PrizePicks and only alongside a verified, non-period market. A `1H`/`1Q` label
  or key is still blocked. No live-board normalization is changed.

## What changes and what does not

New maintenance-only code, one additive token-protected RPC, tests, a bounded
read-only canary workflow and a runbook. Existing research, PropLine, auth,
webhooks, provider budgets, leases, worker configuration, UI and table structures
are not changed. The RPC uses the existing backend ingest-token boundary and
never returns secrets. Its snapshot covers every raw active sport label.

The public route uses the existing registry: NFL, NCAAF, NBA, WNBA, NCAAB, MLB,
NHL, MLS, EPL, UCL and generic SOCCER, subject to the existing exact-market and
competition checks. Other sports/markets are reported explicitly as unsupported
by this public route. Existing PropLine research for them is not disabled or
reclassified as fake. Adding a new verified source is separate from pretending
an unsupported sport has ESPN history.

Only missing `(player_id, game_id, category)` keys can be inserted. Database
`ON CONFLICT DO NOTHING` protects richer existing rows and racing live writes.
A conflicting record is reported, never overwritten. Missing fields are not
converted to zero. First-half, quarter, season, live-period and combo markets do
not inherit full-game statistics. A real reported zero is retained.

## Rollout and use

Run the normal release checks, then apply
`supabase/migrations/20260919014000_verified_history_maintenance.sql` through the
normal reviewed migration path. It creates only a new function and grants, not a
table migration or a replacement of any live RPC. Do not run the CLI from app
boot, the live worker, or a recurring scheduler.

Use the already-secure runtime environment. The CLI reads:
`AUTOSCOUT_SUPABASE_URL` (or `SUPABASE_URL`),
`AUTOSCOUT_SUPABASE_PUBLISHABLE_KEY` (or `SUPABASE_ANON_KEY`), and
`AUTOSCOUT_SUPABASE_INGEST_TOKEN`. Do not paste credentials into command-line
arguments, logs, source files, artifacts, or issue comments.

Default audit makes no public-provider calls and no writes:

```sh
node scripts/verified-history-maintenance.mjs --mode=audit \
  --out=history-before.json --snapshot-out=history-cohort.json
```

Probe a reviewed frozen cohort using only the public parser:

```sh
node scripts/verified-history-maintenance.mjs --mode=probe \
  --snapshot-in=history-cohort.json --max-players=12 --max-requests=80 \
  --max-rows=200 --max-ms=180000 --out=history-probe.json \
  --evidence-out=history-evidence.json
```

Apply requires the exact `cohortHash` printed by the audit, a snapshot no older
than 30 minutes, a currently active candidate at the database write boundary,
and freshly fetched public evidence. The CLI does NOT ingest the evidence JSON:

```sh
node scripts/verified-history-maintenance.mjs --mode=apply \
  --snapshot-in=history-cohort.json --approve-snapshot=REVIEWED_64_CHARACTER_HASH \
  --max-players=12 --max-requests=80 --max-rows=200 --max-ms=180000 \
  --out=history-after.json
```

Defaults: 12 players, 80 public requests, 200 proposed/inserted rows, 180 seconds,
300 ms minimum between public request starts, one request at a time, 9 seconds
per request, 4 MB per public response, at most two existing exact markets per
player and at most 40 completed game records per player. Hard ceilings are 100
players, 500 public requests, 1,000 rows and 10 minutes. No paid-provider imports
or fallbacks are reachable from the maintenance transport. 429, 401/403, exhausted
budgets and unverified persistence halt further work. There is no automatic retry
schedule. `--offset=N` advances a finite run over a reviewed cohort; refresh an
expired cohort and review changes rather than assuming offsets are stable across
new snapshots. Sports are interleaved so a large football slate cannot monopolize
a batch.

Files are created exclusively with mode 0600. Choose fresh report names for each
run. Reports contain public sporting data and operational status, never secrets.
The evidence export exists for human/source review and is not an import command.

## Acceptance and metrics

`storedNameCoveragePct` is explicitly a diagnostic name-match metric comparable
to the issue audit, not proof of correct identity or exact-market coverage.
`publicVerifiedThisRun` requires the existing public identity/game parser.
`durablePlayersProvedThisRun` additionally requires exact read-back of evidence.
`exactMarketCoveragePct` and `completeSeasonCoveragePct` remain null rather than
being inferred from the existence of one game. The 40-game maintenance sample is
not represented as a full-season/L20/H2H guarantee.

After apply, the CLI re-reads history but recomputes coverage against the same
frozen active cohort. Live ingestion may also change stored coverage during that
window, so the net percentage delta is not attributed entirely to maintenance.
The report separately records rows acknowledged inserted and read-back failures.
A write acknowledgement without matching persisted evidence is UNVERIFIABLE,
not success. Exact read-back includes player name, season, season type and ESPN
provenance in addition to the natural key, sport, game date and freshly proved
stat fields; richer stored stat objects may retain extra fields. Null or unknown
maintenance actions fail closed before writer dispatch. Keep issue 331 open until
measured acceptance actually passes.

The initial investigation measured NFL 250/522 (47.9%), MLB 81/130 (62.3%), WNBA
12/18 (66.7%), NCAAF 65/494 (13.2%), and NBA 6/6 (100%) using an issue-style raw
sport/name audit. These are a changing baseline, not post-fix results. Period and
season aliases must be audited separately; a zero for an exact raw alias does
not prove there is no base-league identity history.

## Read-only production canary

`docs/diagnostics/history-331-canary.json` contains only actual candidate context
from a read-only production query at 2026-09-19 01:48:01 UTC. It is a selected
12-name, six-sport cohort, explicitly NOT the entire board. There are no invented
history rows in this file. The separate `verified-history-canary.yml` workflow
runs on changes to that file/workflow on the issue branch, or manual dispatch.
It has read-only repository permission, no database/provider credentials, no
scheduler and no write path; it exports bounded results and real public evidence.
The fixed canary must not be used as a perpetual freshness or 100% coverage claim.

## Recovery

Stop invoking maintenance; the live app does not import it. No existing history
is deleted or updated. A partially completed apply is safe to retry after a new
review because inserts are idempotent. Do not delete genuine inserted game logs
to roll back a diagnostic. Removing the unused maintenance RPC is optional and
must not touch the existing history RPC, live lease, or provider configuration.
