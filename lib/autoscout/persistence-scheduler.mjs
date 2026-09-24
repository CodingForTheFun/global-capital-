import { assertIngestionActive, withIngestionDeadline, ingestionDeadlineHealth, INGESTION_BUDGET_MS as B } from '../ingestion/operation-deadline.mjs';
import { fetchUnifiedBoard } from '../../apex-v2/provider.mjs';
import { publicFeeds } from '../ingestion/public-feeds.mjs';
import { publicWorkerConfigured, runPublicIngestionCycle } from '../ingestion/public-worker.mjs';
import { runFastPrizePicksCycle } from '../ingestion/fast-prizepicks-worker.mjs';
import { runFreeSportsbooksCycle } from '../ingestion/free-sportsbooks-worker.mjs';
import { runDraftKingsPick6Cycle } from '../ingestion/draftkings-pick6-worker.mjs';
import { maybeRefreshProplineSupplement } from '../ingestion/propline-supplement.mjs';
import { maybeRefreshSportsGameOddsSupplement, sportsGameOddsDemandedSports } from '../ingestion/sportsgameodds-supplement.mjs';
import { maybeRefreshSportradarSupplement } from '../ingestion/sportradar-supplement.mjs';
import { fetchSportsGameOddsUsage, sportsGameOddsConfigured, sportsGameOddsHealth } from '../data-sources/sportsgameodds/client.mjs';
import { fetchSportsGameOddsCatalog } from './providers/sportsgameodds.mjs';
import { readPublicSchedulerState } from '../ingestion/scheduler-state.mjs';
import { decorateBoardWithScoutAudit } from './scout-rules.mjs';
import { persistNormalizedBoard, persistenceHealth, pruneLineSnapshots, retentionConfig } from './supabase-persistence.mjs';
import { AUTOMATIC_SPORTS } from './models.mjs';
import { ingestConfig } from './ingest-worker.mjs';
import { propProviderMode } from './provider-mode.mjs';

const clampInt = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
};
const PUBLIC_PERSISTENCE_SPORTS = Object.freeze([...AUTOMATIC_SPORTS, 'TENNIS']);

function persistenceSportsForMode() {
  const mode = propProviderMode();
  if (!['sportsgameodds','mesh'].includes(mode)) return PUBLIC_PERSISTENCE_SPORTS;
  const demanded = sportsGameOddsDemandedSports();
  return demanded.length ? demanded : ['NFL'];
}
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
let sportsGameOddsLocalTimer = null;

function nextSports(all, perCycle) {
  if (perCycle >= all.length) return all;
  const picked = [];
  for (let i = 0; i < perCycle; i += 1) {
    picked.push(all[sportCursor % all.length]);
    sportCursor += 1;
  }
  return picked;
}

export function fairSportPersistenceBudget({
  cycleMs = B.cycle,
  elapsedMs = 0,
  sportsRemaining = 1,
  maxSportMs = B.sport,
  safetyMs = 10_000,
} = {}) {
  const remainingCycleMs = Math.max(0, Number(cycleMs) - Math.max(0, Number(elapsedMs)) - Math.max(0, Number(safetyMs)));
  const share = Math.floor(remainingCycleMs / Math.max(1, Number(sportsRemaining) || 1));
  return Math.max(1_000, Math.min(Math.max(1_000, Number(maxSportMs) || B.sport), share || 1_000));
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

/**
 * Is there a public scraped-feed worker to coordinate with this cycle?
 *
 * The scheduler's lease exists to stop two processes running the public feeds
 * at once. It is not a claim on the paid providers, and when no public worker
 * runs there is nothing for it to arbitrate.
 *
 * Exported because the answer decides whether PropLine and Sportradar refresh
 * at all: they are gated on the lease, and a lease that is never granted stops
 * them silently rather than loudly.
 */
export function publicFeedWorkerActive(providerMode, workerConfigured) {
  return providerMode !== 'sportsgameodds' && Boolean(workerConfigured);
}

/**
 * Does this process own provider ingestion for this cycle?
 *
 * Owned when the lease was granted, or when there was no public worker to take
 * it from — the case that regressed, because ownership defaulted to false and
 * was only ever set inside the branch that a disabled public feed skips.
 */
export function ownsProviderIngestion(providerMode, workerConfigured, leaseClaimed) {
  return publicFeedWorkerActive(providerMode, workerConfigured) ? Boolean(leaseClaimed) : true;
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


function startSportradarRefresh() {
  void maybeRefreshSportradarSupplement()
    .then((result) => {
      if (!result?.skipped || result?.reason === 'disabled_or_unconfigured') {
        console.log('[AutoScout Sportradar supplement]', JSON.stringify({
          sport: result?.sport || null,
          props: result?.props || 0,
          events: result?.events || 0,
          books: result?.books || 0,
          skipped: Boolean(result?.skipped),
          reason: result?.reason || null,
          error: result?.error || null,
        }));
      }
    })
    .catch((error) => {
      console.log(`[AutoScout Sportradar supplement] failed code=${String(error?.code || 'SPORTRADAR_SUPPLEMENT_FAILED').slice(0,80)}`);
    });
}

function startSportsGameOddsEntitlementProbe() {
  if (!sportsGameOddsConfigured()) {
    console.log('[AutoScout SportsGameOdds entitlement]', JSON.stringify({
      configured: false,
      authenticated: false,
      reason: 'not_configured',
    }));
    return;
  }
  void fetchSportsGameOddsUsage({ force: true })
    .then((usage) => {
      const health = sportsGameOddsHealth();
      console.log('[AutoScout SportsGameOdds entitlement]', JSON.stringify({
        configured: true,
        authenticated: true,
        tier: usage?.tier || health.tier || null,
        monthlyMax: health.monthly?.max ?? null,
        monthlyUsed: health.monthly?.used ?? null,
        monthlyRemaining: health.monthly?.remaining ?? null,
      }));
    })
    .catch((error) => {
      console.log('[AutoScout SportsGameOdds entitlement]', JSON.stringify({
        configured: true,
        authenticated: false,
        error: String(error?.code || error?.name || 'SPORTSGAMEODDS_ENTITLEMENT_FAILED').slice(0, 80),
      }));
    });
}

function startSportsGameOddsRefresh() {
  void maybeRefreshSportsGameOddsSupplement()
    .then((result) => {
      if (!result?.skipped || ['monthly_reserve'].includes(result?.reason)) {
        console.log('[AutoScout SportsGameOdds supplement]', JSON.stringify({
          sport: result?.sport || null,
          props: result?.props || 0,
          events: result?.events || 0,
          skipped: Boolean(result?.skipped),
          reason: result?.reason || null,
          error: result?.error || null,
          monthlyRemaining: result?.monthly?.remaining ?? result?.policy?.monthly?.remaining ?? null,
        }));
      }
    })
    .catch((error) => {
      console.log(`[AutoScout SportsGameOdds supplement] failed code=${String(error?.code || 'SPORTSGAMEODDS_SUPPLEMENT_FAILED').slice(0,80)}`);
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
  persistNormalizedBoard, retentionConfig, pruneLineSnapshots, startPropLineRefresh, startSportradarRefresh, startSportsGameOddsRefresh };

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
    retentionConfig, pruneLineSnapshots, startPropLineRefresh, startSportradarRefresh, startSportsGameOddsRefresh } = deps;
  const cycleStartedAt = Date.now();
  let retryLeaseAfterRun = false;
  let retryLeaseTiming = null;
  try {
    let deferDatabaseWrites = false;
    const providerMode = propProviderMode();
    const apiOnly = ['sportsgameodds','mesh'].includes(providerMode);
    const meshMode = providerMode === 'mesh';
    const publicWorkerActive = publicFeedWorkerActive(providerMode, publicWorkerConfigured());
    // Strictly the public scraped-feed lease. Every scraped path below stays
    // gated on it, unchanged.
    let publicClaimed = false;
    if (publicWorkerActive) {
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
        const code = String(error?.code || 'PUBLIC_SNAPSHOT_FAILED').slice(0, 80);
        const status = Number(error?.status || 0);
        // A bounded public-feed timeout is already cancellation-fenced and must
        // not suppress the independent canonical cached-board writes. Only a
        // concrete database/public-store failure defers those writes.
        deferDatabaseWrites = /DATABASE|PUBLIC_STORE/.test(code) || TRANSIENT_DATABASE_STATUSES.has(status);
        console.log(`[AutoScout public snapshots] ${reason} failed code=${code} canonicalWritesDeferred=${deferDatabaseWrites}`);
      }
    }

    assertIngestionActive();
    // The paid providers need exclusive ownership, which the public lease grants
    // when a public worker is running and nothing needs to grant when one is
    // not. Gating them on the lease alone is what silently stopped them: mesh
    // and API-only modes turn the public feeds off, so `publicClaimed` was never
    // assigned and stayed false for the life of the process. PropLine and
    // Sportradar were then never called once — `startedAt` null, `cycles` 0 —
    // while SportsGameOdds kept working from its own timer.
    //
    // Deliberately narrower than `publicClaimed` itself: the scraped-feed paths
    // below keep waiting on the real lease, because two processes scraping the
    // same book is the contention it exists to prevent.
    // PropLine is a paid API provider with its own quota guard and process-local
    // in-flight/nextAt fencing. It must not depend on the public scraped-feed
    // lease: another process may legitimately own that lease while this process
    // is still the only one configured with the PropLine key. Gating PropLine on
    // publicClaimed is what made Streaming Lite usage stall at nearly zero.
    startPropLineRefresh();

    if (ownsProviderIngestion(providerMode, publicWorkerConfigured(), publicClaimed)) {
      startSportradarRefresh();
    }

    if (publicClaimed && !apiOnly) {
      try {
        const fastPrizePicks = await withIngestionDeadline('scheduler-fast-prizepicks', () => runFastPrizePicksCycle(), budgets.provider);
        console.log('[AutoScout fast PrizePicks]', JSON.stringify(fastPrizePicks));
      } catch (error) {
        console.log(`[AutoScout fast PrizePicks] failed code=${String(error?.code || 'PRIZEPICKS_FAST_REFRESH_FAILED').slice(0,80)}`);
      }
    }

    const sportsbookSeconds = clampInt(process.env.AUTOSCOUT_SPORTSBOOK_INGEST_SECONDS, 180, 60, 900);
    if (publicClaimed && !apiOnly && due(lastSportsbookAt, sportsbookSeconds)) {
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
    if (publicClaimed && !apiOnly && due(lastPick6At, pick6Seconds)) {
      lastPick6At = Date.now();
      try {
        const dk = await withIngestionDeadline('scheduler-pick6', () => runDraftKingsPick6Cycle(), budgets.group);
        console.log('[AutoScout DraftKings Pick6]', JSON.stringify(dk));
      } catch (error) {
        console.log(`[AutoScout DraftKings Pick6] failed code=${String(error?.code || 'DRAFTKINGS_PICK6_FAILED').slice(0,80)}`);
      }
    }

    if (!apiOnly) {
      try {
        await withIngestionDeadline('scheduler-feed-cache', () => publicFeeds.refresh(), budgets.group);
        console.log('[AutoScout public feeds]', JSON.stringify(publicFeeds.health()));
      } catch (error) {
        console.warn('[AutoScout public feeds retained]', JSON.stringify({ code: error?.code || 'PUBLIC_FEED_FAILED' }));
      }
      assertIngestionActive();
    }

    if (deferDatabaseWrites) {
      console.log(`[AutoScout persistence] ${reason} database-degraded; canonical board and retention writes deferred`);
      return;
    }

    const snapshotSeconds = clampInt(process.env.AUTOSCOUT_SNAPSHOT_INTERVAL_SECONDS, 300, 45, 3600);
    const snapshotsDue = due(lastSnapshotCycleAt, snapshotSeconds);
    if (snapshotsDue) lastSnapshotCycleAt = Date.now();

    const activePersistenceSports = persistenceSportsForMode();
    const perCycle = ['sportsgameodds','mesh'].includes(propProviderMode())
      ? clampInt(process.env.AUTOSCOUT_PERSIST_SPORTS_PER_CYCLE, activePersistenceSports.length, 1, activePersistenceSports.length)
      : clampInt(process.env.AUTOSCOUT_PERSIST_SPORTS_PER_CYCLE, PUBLIC_PERSISTENCE_SPORTS.length, 1, PUBLIC_PERSISTENCE_SPORTS.length);
    const selectedSports = nextSports(activePersistenceSports, perCycle);
    for (let index = 0; index < selectedSports.length; index += 1) {
      const sport = selectedSports[index];
      const startedAt = Date.now();
      const sportBudgetMs = fairSportPersistenceBudget({
        cycleMs: budgets.cycle,
        elapsedMs: startedAt - cycleStartedAt,
        sportsRemaining: selectedSports.length - index,
        maxSportMs: budgets.sport,
      });
      try {
        const result = await withIngestionDeadline(`scheduler-sport:${sport}`, async () => {
          const raw = await fetchUnifiedBoard(sport, { cacheOnly: true });
          assertIngestionActive();
          const board = decorateBoardWithScoutAudit(raw);
          return persistNormalizedBoard(board, { includeSnapshots: snapshotsDue });
        }, sportBudgetMs);
        const counts = result?.counts || {};
        if (result?.skipped) continue;
        console.log(`[AutoScout persistence] ${reason} ${sport} ${apiOnly ? providerMode + '-api-only' : 'public-only'} persisted=${Boolean(result?.persisted)} events=${counts.events || 0} props=${counts.props || 0} lines=${counts.lines || 0} snapshots=${counts.snapshots || 0} elapsedMs=${Date.now()-startedAt} budgetMs=${sportBudgetMs}`);
        const status = Number(result?.error?.status || 0);
        if (!result?.persisted && TRANSIENT_DATABASE_STATUSES.has(status)) {
          console.log(`[AutoScout persistence] ${reason} database-degraded status=${status}; remaining sport writes deferred`);
          break;
        }
      } catch (error) {
        console.log(`[AutoScout persistence] ${reason} ${sport} failed code=${String(error?.code || 'PERSIST_SYNC_FAILED').slice(0, 80)} elapsedMs=${Date.now()-startedAt} budgetMs=${sportBudgetMs}`);
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

export function startSportsGameOddsLocalRefresh() {
  if (sportsGameOddsLocalTimer) return sportsGameOddsLocalTimer;
  const primary = ['sportsgameodds','mesh'].includes(propProviderMode());
  const seconds = clampInt(process.env.SPORTSGAMEODDS_LOCAL_REFRESH_SECONDS, primary ? 30 : 60, 30, 300);
  const tick = () => startSportsGameOddsRefresh();
  setTimeout(tick, primary ? 750 : 5000).unref?.();
  sportsGameOddsLocalTimer = setInterval(tick, seconds * 1000);
  sportsGameOddsLocalTimer.unref?.();
  console.log(`[AutoScout SportsGameOdds supplement] local demand refresh interval=${seconds}s; mode=${primary ? 'primary' : 'fallback'}; paid calls remain quota-aware`);
  return sportsGameOddsLocalTimer;
}

export function startFrugalPersistence() {
  // Verify the paid key once per process without fetching event objects. This
  // uses SportsGameOdds' account-usage endpoint and never logs credential data.
  setTimeout(startSportsGameOddsEntitlementProbe, 1500).unref?.();
  setTimeout(() => {
    void fetchSportsGameOddsCatalog().then((catalog) => {
      console.log('[AutoScout SportsGameOdds catalog]', JSON.stringify({
        sports: catalog?.sports?.map((row) => row.id) || [],
        leagues: catalog?.leagues?.length || 0,
        error: catalog?.error || null,
      }));
    }).catch(() => {});
  }, 2200).unref?.();
  // SportsGameOdds is a process-local customer gap cache. It must follow local
  // board demand and must not depend on which process owns the DB persistence
  // lease. Processes with no local demand make no paid SportsGameOdds calls.
  startSportsGameOddsLocalRefresh();
  if (ingestConfig().enabled) return null;
  const ingestSeconds = clampInt(process.env.AUTOSCOUT_PUBLIC_INGEST_SECONDS, 45, 30, 300);
  setTimeout(() => { void persistBoards('bootstrap'); }, 5000).unref();
  setTimeout(() => { void persistBoards('bootstrap-retry'); }, 20_000).unref();
  const timer = setInterval(() => { void persistBoards('scheduled'); }, ingestSeconds * 1000);
  timer.unref();
  const startupPersistenceSports = persistenceSportsForMode();
  const perCycle = ['sportsgameodds','mesh'].includes(propProviderMode())
    ? clampInt(process.env.AUTOSCOUT_PERSIST_SPORTS_PER_CYCLE, startupPersistenceSports.length, 1, startupPersistenceSports.length)
    : clampInt(process.env.AUTOSCOUT_PERSIST_SPORTS_PER_CYCLE, PUBLIC_PERSISTENCE_SPORTS.length, 1, PUBLIC_PERSISTENCE_SPORTS.length);
  const snapshotSeconds = clampInt(process.env.AUTOSCOUT_SNAPSHOT_INTERVAL_SECONDS, 300, 45, 3600);
  const feasibility = snapshotFeasibility({ sports: startupPersistenceSports.length, perCycle, cycleSeconds: ingestSeconds, snapshotSeconds });
  if (!feasibility.feasible) {
    console.log(`[AutoScout persistence] WARNING line history cannot accumulate: each sport comes round every ${feasibility.sweepSeconds}s but snapshots compare every ${feasibility.snapshotSeconds}s. Raise AUTOSCOUT_PERSIST_SPORTS_PER_CYCLE to at least ${feasibility.needsPerCycleAtLeast}, or raise AUTOSCOUT_SNAPSHOT_INTERVAL_SECONDS above ${feasibility.sweepSeconds}.`);
  }
  console.log(`[AutoScout persistence] scheduler interval=${ingestSeconds}s, sports-per-cycle=${perCycle}/${startupPersistenceSports.length}, snapshot-interval=${snapshotSeconds}s, provider-mode=${propProviderMode()}, public-feeds=${['sportsgameodds','mesh'].includes(propProviderMode())?'off':'on'}, selected-provider-cache=enabled`);
  return timer;
}
