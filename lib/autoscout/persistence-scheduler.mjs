import { fetchUnifiedBoard } from '../../apex-v2/provider.mjs';
import { publicFeeds } from '../ingestion/public-feeds.mjs';
import { publicWorkerConfigured } from '../ingestion/public-worker.mjs';
import { claimPublicCycle, releasePublicCycle } from '../ingestion/public-persistence.mjs';
import { runFastPrizePicksCycle } from '../ingestion/fast-prizepicks-worker.mjs';
import { runFastUnderdogCycle } from '../ingestion/fast-underdog-worker.mjs';
import { runFreeSportsbooksCycle } from '../ingestion/free-sportsbooks-worker.mjs';
import { runDraftKingsPick6Cycle } from '../ingestion/draftkings-pick6-worker.mjs';
import { decorateBoardWithScoutAudit } from './scout-rules.mjs';
import { persistNormalizedBoard, persistenceHealth } from './supabase-persistence.mjs';
import { AUTOMATIC_SPORTS } from './models.mjs';
import { ingestConfig } from './ingest-worker.mjs';

const clampInt = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
};
const PUBLIC_PERSISTENCE_SPORTS = Object.freeze([...AUTOMATIC_SPORTS, 'TENNIS']);

let fastRunning = false;
let slowRunning = false;
let boardPersistRunning = false;
let lastSportsbookAt = 0;
let lastPick6At = 0;

function due(lastAt, everySeconds) {
  return !lastAt || Date.now() - lastAt >= everySeconds * 1000;
}

async function persistCachedBoards(reason) {
  if (boardPersistRunning || !persistenceHealth().configured) return;
  boardPersistRunning = true;
  try {
    // Browser reads are database/cache-first. This pass only materializes the
    // newest zero-credit snapshots into the existing normalized persistence path.
    for (const sport of PUBLIC_PERSISTENCE_SPORTS) {
      try {
        const raw = await fetchUnifiedBoard(sport, { cacheOnly: true });
        const board = decorateBoardWithScoutAudit(raw);
        const result = await persistNormalizedBoard(board, { includeSnapshots: false });
        const counts = result?.counts || {};
        console.log(`[AutoScout persistence] ${reason} ${sport} public-only persisted=${Boolean(result?.persisted)} events=${counts.events || 0} props=${counts.props || 0} lines=${counts.lines || 0}`);
      } catch (error) {
        console.log(`[AutoScout persistence] ${reason} ${sport} failed code=${String(error?.code || 'PERSIST_SYNC_FAILED').slice(0, 80)}`);
      }
    }
  } finally {
    boardPersistRunning = false;
  }
}

async function refreshFastDfs(reason, intervalSeconds) {
  if (fastRunning || !persistenceHealth().configured || !publicWorkerConfigured()) return;
  fastRunning = true;
  let owner = null;
  let claimed = false;
  try {
    const lease = await claimPublicCycle(intervalSeconds);
    claimed = Boolean(lease?.claimed && lease?.owner);
    owner = claimed ? lease.owner : null;
    if (!claimed) return;

    // Keep the high-change DFS sources on their own zero-credit lane. Run them
    // sequentially so a 45-second cadence does not become a request burst.
    const results = [];
    results.push(await runFastPrizePicksCycle());
    results.push(await runFastUnderdogCycle());
    const written = results.reduce((sum, row) => sum + Number(row?.written || 0), 0);
    console.log(`[AutoScout fast DFS] ${reason} claimed=true written=${written}`, JSON.stringify(results));
  } catch (error) {
    console.log(`[AutoScout fast DFS] ${reason} failed code=${String(error?.code || 'FAST_DFS_FAILED').slice(0, 80)}`);
  } finally {
    if (owner) await releasePublicCycle(owner).catch(() => {});
    fastRunning = false;
  }

  // The live database snapshot is already fresh at this point. Materializing
  // cached boards is intentionally outside the lease and outside fastRunning,
  // so a slow normalization pass can never delay the next provider refresh.
  if (claimed) void persistCachedBoards(`${reason}-dfs`);
}

async function refreshSlowSources(reason, sportsbookSeconds, pick6Seconds) {
  if (slowRunning || !persistenceHealth().configured) return;
  slowRunning = true;
  try {
    if (due(lastSportsbookAt, sportsbookSeconds)) {
      lastSportsbookAt = Date.now();
      try {
        const books = await runFreeSportsbooksCycle();
        const written = books.results?.reduce((sum, row) => sum + Number(row?.written || 0), 0) || 0;
        console.log(`[AutoScout free sportsbooks] ${reason} written=${written}`, JSON.stringify(books.results || []));
      } catch (error) {
        console.log(`[AutoScout free sportsbooks] ${reason} failed code=${String(error?.code || 'FREE_SPORTSBOOK_FAILED').slice(0, 80)}`);
      }
    }

    if (due(lastPick6At, pick6Seconds)) {
      lastPick6At = Date.now();
      try {
        const dk = await runDraftKingsPick6Cycle();
        console.log('[AutoScout DraftKings Pick6]', JSON.stringify(dk));
      } catch (error) {
        console.log(`[AutoScout DraftKings Pick6] failed code=${String(error?.code || 'DRAFTKINGS_PICK6_FAILED').slice(0, 80)}`);
      }
    }

    // Keep the older supplemental cache healthy on its conservative TTL. This
    // lane may take a while; it is deliberately isolated from the fast DFS loop.
    await publicFeeds.refresh();
    console.log('[AutoScout public feeds]', JSON.stringify(publicFeeds.health()));
  } finally {
    slowRunning = false;
  }

  void persistCachedBoards(`${reason}-slow`);
}

export function startFrugalPersistence() {
  if (ingestConfig().enabled) return null;

  const ingestSeconds = clampInt(process.env.AUTOSCOUT_PUBLIC_INGEST_SECONDS, 45, 30, 300);
  const sportsbookSeconds = clampInt(process.env.AUTOSCOUT_SPORTSBOOK_INGEST_SECONDS, 180, 60, 900);
  const pick6Seconds = clampInt(process.env.AUTOSCOUT_PICK6_INGEST_SECONDS, 180, 60, 900);
  const slowTickSeconds = Math.min(sportsbookSeconds, pick6Seconds, 180);

  setTimeout(() => { void refreshFastDfs('bootstrap', ingestSeconds); }, 5000).unref();
  setTimeout(() => { void refreshFastDfs('bootstrap-retry', ingestSeconds); }, 20_000).unref();
  const fastTimer = setInterval(() => { void refreshFastDfs('scheduled', ingestSeconds); }, ingestSeconds * 1000);
  fastTimer.unref();

  // Slow public sportsbooks and supplemental feeds have their own overlap guard.
  // They can never hold the fast DFS lease or fastRunning flag.
  setTimeout(() => { void refreshSlowSources('bootstrap', sportsbookSeconds, pick6Seconds); }, 12_000).unref();
  const slowTimer = setInterval(() => { void refreshSlowSources('scheduled', sportsbookSeconds, pick6Seconds); }, slowTickSeconds * 1000);
  slowTimer.unref();

  console.log(`[AutoScout persistence] fast DFS interval=${ingestSeconds}s slow-books interval=${slowTickSeconds}s paid-refresh=off`);
  return fastTimer;
}
