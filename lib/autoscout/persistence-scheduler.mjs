import { assertIngestionActive, withIngestionDeadline, ingestionDeadlineHealth, INGESTION_BUDGET_MS as B } from '../ingestion/operation-deadline.mjs';
import { fetchUnifiedBoard } from '../../apex-v2/provider.mjs';
import { publicFeeds } from '../ingestion/public-feeds.mjs';
import { publicWorkerConfigured, runPublicIngestionCycle } from '../ingestion/public-worker.mjs';
import { runFastPrizePicksCycle } from '../ingestion/fast-prizepicks-worker.mjs';
import { runFreeSportsbooksCycle } from '../ingestion/free-sportsbooks-worker.mjs';
import { runDraftKingsPick6Cycle } from '../ingestion/draftkings-pick6-worker.mjs';
import { maybeRefreshProplineSupplement } from '../ingestion/propline-supplement.mjs';
import { readPublicSchedulerState } from '../ingestion/scheduler-state.mjs';
import { decorateBoardWithScoutAudit } from './scout-rules.mjs';
import { persistNormalizedBoard, persistenceHealth, pruneLineSnapshots, retentionConfig } from './supabase-persistence.mjs';
import { AUTOMATIC_SPORTS } from './models.mjs';
import { ingestConfig } from './ingest-worker.mjs';

const clampInt = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
};
const PUBLIC_PERSISTENCE_SPORTS = Object.freeze([...AUTOMATIC_SPORTS, 'TENNIS']);
const TRANSIENT_DATABASE_STATUSES = new Set([429, 500, 502, 503, 504]);
const LEASE_RETRY_FALLBACK_MS = 75_000;
const LEASE_RETRY_SAFETY_MS = 5_000;
const LEASE_RETRY_MIN_MS = 5_000;
const LEASE_RETRY_MAX_MS = 305_000;

let syncRunning = false;
let leaseRetryTimer = null;
let lastSportsbookAt = 0;
let lastPick6At = 0;
let lastPruneAt = 0;
let lastSnapshotCycleAt = 0;
let sportCursor = 0;

function nextSports(all, perCycle) {
  if (perCycle >= all.length) return all;
  const picked = [];
  for (let i = 0; i < perCycle; i += 1) {
    picked.push(all[sportCursor % all.length]);
    sportCursor += 1;
  }
  return picked;
}

export function snapshotFeasibility({
  sports = PUBLIC_PERSISTENCE_SPORTS.length,
  perCycle = 1,
  cycleSeconds = 45,
  snapshotSeconds = 300,
} = {}) {
  const cycles = Math.ceil(sports / Math.max(1, perCycle));
  const sweepSeconds = cycles * cycleSeconds;
  return {
    feasible: sweepSeconds <= snapshotSeconds,
    sweepSeconds,
    snapshotSeconds,
    needsPerCycleAtLeast: Math.ceil(sports / Math.max(1, Math.floor(snapshotSeconds / Math.max(1, cycleSeconds)))),
  };
}

function due(lastAt, everySeconds) {
  return !lastAt || Date.now() - lastAt >= everySeconds * 1000;
}

function timestampMs(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function startPropLineRefresh() {
  void maybeRefreshProplineSupplement()
    .then((propline) => {
      if (!propline?.skipped || ['quota_reserve','no_markets'].includes(propline?.reason)) {
        console.log('[AutoScout PropLine supplement]', JSON.stringify({
          sport: propline?.sport || null,
          props: propline?.props || 0,
          events: propline?.events || 0,
          skipped: Boolean(propline?.skipped),
          reason: propline?.reason || null,
          error: propline?.error || null,
        }));
      }
    })
    .catch((error) => {
      console.log(`[AutoScout PropLine supplement] failed code=${String(error?.code || 'PROPLINE_SUPPLEMENT_FAILED').slice(0,80)}`);
    });
}

export function __leaseRetryPolicy(reason, timerPending = false, timing = null) {
  let delayMs = LEASE_RETRY_FALLBACK_MS;
  const nextAt = timestampMs(timing?.nextAt);
  const leaseUntil = timestampMs(timing?.leaseUntil);
  const dbNow = timestampMs(timing?.dbNow);
  const authoritativeTarget = Math.max(nextAt ?? -Infinity, leaseUntil ?? -Infinity);
  if (Number.isFinite(authoritativeTarget) && dbNow !== null) {
    delayMs = Math.min(
      LEASE_RETRY_MAX_MS,
      Math.max(LEASE_RETRY_MIN_MS, authoritativeTarget - dbNow + LEASE_RETRY_SAFETY_MS),
    );
  }
  return {
    delayMs,
    shouldSchedule: !timerPending && !String(reason).includes('lease-retry'),
  };
}

function scheduleLeaseRetry(reason, timing = null) {
  const policy = __leaseRetryPolicy(reason, Boolean(leaseRetryTimer), timing);
  if (!policy.shouldSchedule) return;
  leaseRetryTimer = setTimeout(() => {
    leaseRetryTimer = null;
    void persistBoards(`${reason}-lease-retry`);
  }, policy.delayMs);
  leaseRetryTimer.unref?.();
}

const dependencies = { persistenceHealth, publicWorkerConfigured, runPublicIngestionCycle,
  readPublicSchedulerState, runFastPrizePicksCycle, runFreeSportsbooksCycle,
  runDraftKingsPick6Cycle, publicFeeds, fetchUnifiedBoard, decorateBoardWithScoutAudit,
  persistNormalizedBoard, retentionConfig, pruneLineSnapshots, startPropLineRefresh };

async function persistBoards(reason, deps = dependencies, budgets = B) {
  if (syncRunning || !deps.persistenceHealth().configured) return;
  syncRunning = true;
  try {
    await withIngestionDeadline('scheduler-cycle', () => persistBoardsCycle(reason, deps, budgets), budgets.cycle);
  } catch (error) {
    console.warn('[AutoScout persistence bounded failure]', JSON.stringify({ reason,
      code: String(error?.code || 'PERSIST_SYNC_FAILED').slice(0, 80),
      operations: ingestionDeadlineHealth().active }));
  } finally { syncRunning = false; }
}

async function persistBoardsCycle(reason, deps, budgets) {
  const { publicWorkerConfigured, runPublicIngestionCycle, readPublicSchedulerState,
    runFastPrizePicksCycle, runFreeSportsbooksCycle, runDraftKingsPick6Cycle, publicFeeds,
    fetchUnifiedBoard, decorateBoardWithScoutAudit, persistNormalizedBoard,
    retentionConfig, pruneLineSnapshots, startPropLineRefresh } = deps;
  let retryLeaseAfterRun = false;
  let retryLeaseTiming = null;
  try {
    let publicClaimed = false;
    let deferDatabaseWrites = false;
    if (publicWorkerConfigured()) {
      try {
        const snapshot = await withIngestionDeadline('scheduler-public', () => runPublicIngestionCycle(), budgets.group);
        publicClaimed = Boolean(snapshot.claimed);
        const written = snapshot.results?.reduce((sum, row) => sum + Number(row?.written || 0), 0) || 0;
        console.log(`[AutoScout public snapshots] ${reason} claimed=${publicClaimed} written=${written}`, JSON.stringify(snapshot.results || []));
        if (!publicClaimed) {
          retryLeaseAfterRun = !String(reason).includes('lease-retry');
          if (retryLeaseAfterRun) retryLeaseTiming = await withIngestionDeadline('scheduler-lease-state', () => readPublicSchedulerState(), budgets.coordination);
          console.log(`[AutoScout persistence] ${reason} lease-unclaimed; exclusive provider ingestion deferred; canonical cached-board persistence continues`);
        } else if (leaseRetryTimer) {
          clearTimeout(leaseRetryTimer);
          leaseRetryTimer = null;
        }
      } catch (error) {
        deferDatabaseWrites = true;
        console.log(`[AutoScout public snapshots] ${reason} failed code=${String(error?.code || 'PUBLIC_SNAPSHOT_FAILED').slice(0, 80)}`);
      }
    }

    assertIngestionActive();
    if (publicClaimed) startPropLineRefresh();

    if (publicClaimed) {
      try {
        const fastPrizePicks = await withIngestionDeadline('scheduler-fast-prizepicks', () => runFastPrizePicksCycle(), budgets.provider);
        console.log('[AutoScout fast PrizePicks]', JSON.stringify(fastPrizePicks));
      } catch (error) {
        console.log(`[AutoScout fast PrizePicks] failed code=${String(error?.code || 'PRIZEPICKS_FAST_REFRESH_FAILED').slice(0,80)}`);
      }
    }

    const sportsbookSeconds = clampInt(process.env.AUTOSCOUT_SPORTSBOOK_INGEST_SECONDS, 180, 60, 900);
    if (publicClaimed && due(lastSportsbookAt, sportsbookSeconds)) {
      lastSportsbookAt = Date.now();
      try {
        const books = await withIngestionDeadline('scheduler-free-books', () => runFreeSportsbooksCycle(), budgets.group);
        const written = books.results?.reduce((sum, row) => sum + Number(row?.written || 0), 0) || 0;
        console.log(`[AutoScout free sportsbooks] ${reason} written=${written}`, JSON.stringify(books.results || []));
      } catch (error) {
        console.log(`[AutoScout free sportsbooks] ${reason} failed code=${String(error?.code || 'FREE_SPORTSBOOK_FAILED').slice(0,80)}`);
      }
    }

    const pick6Seconds = clampInt(process.env.AUTOSCOUT_PICK6_INGEST_SECONDS, 180, 60, 900);
    if (publicClaimed && due(lastPick6At, pick6Seconds)) {
      lastPick6At = Date.now();
      try {
        const dk = await withIngestionDeadline('scheduler-pick6', () => runDraftKingsPick6Cycle(), budgets.group);
        console.log('[AutoScout DraftKings Pick6]', JSON.stringify(dk));
      } catch (error) {
        console.log(`[AutoScout DraftKings Pick6] failed code=${String(error?.code || 'DRAFTKINGS_PICK6_FAILED').slice(0,80)}`);
      }
    }

    try {
      await withIngestionDeadline('scheduler-feed-cache', () => publicFeeds.refresh(), budgets.group);
      console.log('[AutoScout public feeds]', JSON.stringify(publicFeeds.health()));
    } catch (error) {
      console.warn('[AutoScout public feeds retained]', JSON.stringify({ code: error?.code || 'PUBLIC_FEED_FAILED' }));
    }
    assertIngestionActive();

    if (deferDatabaseWrites) {
      console.log(`[AutoScout persistence] ${reason} database-degraded; canonical board and retention writes deferred`);
      return;
    }

    const snapshotSeconds = clampInt(process.env.AUTOSCOUT_SNAPSHOT_INTERVAL_SECONDS, 300, 45, 3600);
    const snapshotsDue = due(lastSnapshotCycleAt, snapshotSeconds);
    if (snapshotsDue) lastSnapshotCycleAt = Date.now();

    const perCycle = clampInt(process.env.AUTOSCOUT_PERSIST_SPORTS_PER_CYCLE, PUBLIC_PERSISTENCE_SPORTS.length, 1, PUBLIC_PERSISTENCE_SPORTS.length);
    for (const sport of nextSports(PUBLIC_PERSISTENCE_SPORTS, perCycle)) {
      try {
        const result = await withIngestionDeadline(`scheduler-sport:${sport}`, async () => {
          const raw = await fetchUnifiedBoard(sport, { cacheOnly: true });
          assertIngestionActive();
          const board = decorateBoardWithScoutAudit(raw);
          return persistNormalizedBoard(board, { includeSnapshots: snapshotsDue });
        }, budgets.sport);
        const counts = result?.counts || {};
        if (result?.skipped) continue;
        console.log(`[AutoScout persistence] ${reason} ${sport} public-only persisted=${Boolean(result?.persisted)} events=${counts.events || 0} props=${counts.props || 0} lines=${counts.lines || 0} snapshots=${counts.snapshots || 0}`);
        const status = Number(result?.error?.status || 0);
        if (!result?.persisted && TRANSIENT_DATABASE_STATUSES.has(status)) {
          console.log(`[AutoScout persistence] ${reason} database-degraded status=${status}; remaining sport writes deferred`);
          break;
        }
      } catch (error) {
        console.log(`[AutoScout persistence] ${reason} ${sport} failed code=${String(error?.code || 'PERSIST_SYNC_FAILED').slice(0, 80)}`);
      }
    }

    if (retentionConfig().enabled && due(lastPruneAt, 86_400)) {
      lastPruneAt = Date.now();
      const pruned = await withIngestionDeadline('scheduler-retention', () => pruneLineSnapshots(), budgets.sport);
      if (pruned.ran) console.log(`[AutoScout retention] ${reason} keepDays=${pruned.keepDays} deleted=${pruned.deleted || 0} more=${Boolean(pruned.more)} error=${pruned.error?.code || 'none'}`);
    }
  } finally {
    // A timed-out continuation must not install a new retry timer.
    assertIngestionActive();
    if (retryLeaseAfterRun) scheduleLeaseRetry(reason, retryLeaseTiming);
  }
}

export function __testPersistBoards(reason, overrides = {}, budgets = {}) {
  return persistBoards(reason, { ...dependencies, ...overrides }, { ...B, ...budgets });
}

export function __testNextSports(all, perCycle, cursor = 0) {
  sportCursor = cursor;
  return nextSports(all, perCycle);
}

export function startFrugalPersistence() {
  if (ingestConfig().enabled) return null;
  const ingestSeconds = clampInt(process.env.AUTOSCOUT_PUBLIC_INGEST_SECONDS, 45, 30, 300);
  setTimeout(() => { void persistBoards('bootstrap'); }, 5000).unref();
  setTimeout(() => { void persistBoards('bootstrap-retry'); }, 20_000).unref();
  const timer = setInterval(() => { void persistBoards('scheduled'); }, ingestSeconds * 1000);
  timer.unref();
  const perCycle = clampInt(process.env.AUTOSCOUT_PERSIST_SPORTS_PER_CYCLE, PUBLIC_PERSISTENCE_SPORTS.length, 1, PUBLIC_PERSISTENCE_SPORTS.length);
  const snapshotSeconds = clampInt(process.env.AUTOSCOUT_SNAPSHOT_INTERVAL_SECONDS, 300, 45, 3600);
  const feasibility = snapshotFeasibility({ perCycle, cycleSeconds: ingestSeconds, snapshotSeconds });
  if (!feasibility.feasible) {
    console.log(`[AutoScout persistence] WARNING line history cannot accumulate: each sport comes round every ${feasibility.sweepSeconds}s but snapshots compare every ${feasibility.snapshotSeconds}s. Raise AUTOSCOUT_PERSIST_SPORTS_PER_CYCLE to at least ${feasibility.needsPerCycleAtLeast}, or raise AUTOSCOUT_SNAPSHOT_INTERVAL_SECONDS above ${feasibility.sweepSeconds}.`);
  }
  console.log(`[AutoScout persistence] single public-feed scheduler, interval=${ingestSeconds} seconds, sports-per-cycle=${perCycle}/${PUBLIC_PERSISTENCE_SPORTS.length}, snapshot-interval=${snapshotSeconds} seconds, primary-paid-refresh=off, propline-supplement=quota-aware`);
  return timer;
}
