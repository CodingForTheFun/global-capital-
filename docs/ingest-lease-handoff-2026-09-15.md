# Ingest lease — findings handoff, 2026-09-15

Status: diagnosis only. No fix attempted for the lease itself.

Branch: `claude/obligepay-credit-saving-mode-qsinxn`, identical to `production-stable` at `939c46c`.

The persistence/lease path has been actively worked today (`f9231ce`, `e8d1729`,
`d89dc31`, `291dd5e`, `6c41dff`, `939c46c`). This is what I found while chasing
line history and PropLine, written down so it does not have to be re-derived.
Everything here is evidence from production logs, the database, or DNS — not
inference.

## The failure that matters

At 21:07, on `939c46c`:

    [AutoScout public snapshots] bootstrap claimed=false written=0 []

`claimed=false`, no error. Not a 500, not a timeout — the claim simply did not
win. Consequences are larger than they look, because three separate things are
gated behind that one boolean in `lib/autoscout/persistence-scheduler.mjs`:

    if (publicClaimed) startPropLineRefresh();          // PropLine
    if (publicClaimed && due(lastSportsbookAt, ...))    // FanDuel/Pinnacle/etc
    if (publicClaimed && due(lastPick6At, ...))         // DraftKings Pick6

So one unwon lease stops DFS ingestion, every sportsbook cycle, Pick6, and
PropLine. `active_props` then ages out — rows expire at
`least(observed_at + 10 min, gameStartTime)` — and the customer board goes
empty. Measured at 21:0x: `live_props = 0`, newest observation 18 minutes old.

This is the single highest-leverage thing in the system right now.

## Claim semantics

`autoscout_public_store(p_token, 'claim', ...)` updates:

    where id='scheduler' and next_at<=now() and lease_until<=now()

and returns `claimed = (row_count = 1)`. A container that dies mid-cycle leaves
`lease_until` in the future; nothing releases it except `release`, which runs in
a `finally` that a hard kill skips. With ~15 restarts today, a stale lease is
worth ruling out before anything else. The row is `private.autoscout_public_state`
where `id = 'scheduler'`.

Observed earlier at 13:53: `lease_until = -infinity`, `next_at` 30 minutes in the
past, both conditions satisfiable — so the claim *should* have won and did not,
which is why the 500s below mattered.

## Fixed already, listed so it is not re-investigated

**Null source, HTTP 500 — fixed in `18f7520`.** `autoscout_public_store`
validated with `if not ( v_source in (...) or ... )`. `NULL in (...)` is NULL,
`not NULL` is NULL, `if NULL` does not fire, so a null source fell through to
`insert into private.autoscout_public_state(id, ...) values (v_source, ...)` and
died on the not-null constraint as a 500. 34 occurrences in one 20-minute
window. Every one was swallowed by `.catch(() => {})` in the callers, so it was
invisible outside the database's own error log. Both guard sites now reject null
explicitly. Verified: `guard_sites=2`, null source returns `Invalid source`.

Worth noting the caller was never identified — all four call sites
(`public-worker`, `free-sportsbooks-worker`, `draftkings-pick6-worker`,
`fast-prizepicks-worker`) pass string literals or template strings. Something
still reaches that RPC with no source. The guard makes it fail cleanly rather
than as a constraint violation, but the origin is unexplained.

**Pooler NXDOMAIN — fixed in `291dd5e`.** For the record, DNS at the time:

| host | result |
|---|---|
| `aws-0-us-east-1.pooler.supabase.com` | 44.216.29.125 |
| `aws-1-us-east-1.pooler.supabase.com` | 18.213.155.45 |
| `aws-7-us-east-1.pooler.supabase.com` | NXDOMAIN |

## Line history — mine, and now unblocked from my side

Snapshots need the same quote observed twice inside one process: the first
seeds the comparison, the second is what can differ. Whether that is possible
depends on three independently tunable numbers, and a bad combination records
nothing rather than failing.

Production ran `sports-per-cycle=1/12` with `snapshot-interval=1800` for much of
today: each sport came round once an hour against a half-hour window. History
stopped at 13:18 and every health field stayed green.

`snapshotFeasibility()` in the scheduler now does the arithmetic and warns at
startup when the numbers cannot work, naming the sweep time, the window, and the
smallest sufficient change (`59ddf75`). The default is now every sport per cycle.
Current live config is `12/12` at 300s with no warning — feasible.

**These two variables are assigned to Claude by the owner:**
`AUTOSCOUT_PERSIST_SPORTS_PER_CYCLE`, `AUTOSCOUT_SNAPSHOT_INTERVAL_SECONDS`.
They were set to working values three times and reverted three times; the owner
resolved the ownership. Throttling them is still legitimate if the database
needs it — the warning now says what it costs.

History cannot resume until the lease is won, because no board is fetched at all
while `claimed=false`.

## PropLine

Not a duplicate implementation. One integration in layers:
`lib/ingestion/propline-supplement.mjs` imports `proplineConfigured`/
`proplineQuota` from `lib/data-sources/propline/client.mjs` and `fetchBoard`
from `lib/autoscout/providers/propline.mjs`; `lib/data-sources/propline/realtime.mjs`
imports `WEBHOOK_PATH` and `sportFromProplineKey` from the same tree. Nothing
needs reconciling.

Confirmed working when the lease is won, at 20:57:

    [PropLine verify] authenticated=true sports=56 tier=streaming-lite
                      dailyLimit=250000 remaining=249638
    [AutoScout PropLine supplement] {"sport":"NFL","props":779,"events":12}

The webhook receiver (`/api/propline/webhook`, HMAC-SHA256 over raw bytes,
5-minute timestamp window, constant-time compare, sequence-gap tracking for
`/replay`) is mounted but inert: `PROPLINE_WEBHOOK_SECRET` is not set and no
subscription has been registered. That is owner setup, not code.

## Suggested order

1. Inspect `private.autoscout_public_state` where `id='scheduler'` — `lease_until`,
   `next_at`, `owner`. Rule out a lease stranded by a killed container.
2. Consider whether a lease should expire on its own rather than relying on a
   `finally` that a hard kill skips.
3. Once `claimed=true` holds across a few cycles, line history and PropLine
   should both resume with no further change.
