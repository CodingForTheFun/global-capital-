import { fetchUnifiedBoard } from '../../apex-v2/provider.mjs';
import { publicFeeds } from '../ingestion/public-feeds.mjs';
import { publicWorkerConfigured, runPublicIngestionCycle } from '../ingestion/public-worker.mjs';
import { runFastPrizePicksCycle } from '../ingestion/fast-prizepicks-worker.mjs';
import { runFreeSportsbooksCycle } from '../ingestion/free-sportsbooks-worker.mjs';
import { runDraftKingsPick6Cycle } from '../ingestion/draftkings-pick6-worker.mjs';
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

let syncRunning = false;
let lastSportsbookAt = 0;
let lastPick6At = 0;
let lastPruneAt = 0;

function due(lastAt, everySeconds) {
  return !lastAt || Date.now() - lastAt >= everySeconds * 1000;
}

async function persistBoards(reason) {
  if (syncRunning || !persistenceHealth().configured) return;
  syncRunning = true;
  try {
    let publicClaimed = false;
    if (publicWorkerConfigured()) {
      try {
        const snapshot = await runPublicIngestionCycle();
        publicClaimed = Boolean(snapshot.claimed);
        const written = snapshot.results?.reduce((sum, row) => sum + Number(row?.written || 0), 0) || 0;
        console.log(`[AutoScout public snapshots] ${reason} claimed=${publicClaimed} written=${written}`, JSON.stringify(snapshot.results || []));
      } catch (error) {
        console.log(`[AutoScout public snapshots] ${reason} failed code=${String(error?.code || 'PUBLIC_SNAPSHOT_FAILED').slice(0, 80)}`);
      }
    }

    // PrizePicks' general supplemental cache intentionally remains conservative,
    // but the ingestion owner may refresh the live public board more frequently.
    // This path is zero-credit, single-owner and never uses a paid provider.
    if (publicClaimed) {
      try {
        const fastPrizePicks = await runFastPrizePicksCycle();
        console.log('[AutoScout fast PrizePicks]', JSON.stringify(fastPrizePicks));
      } catch (error) {
        console.log(`[AutoScout fast PrizePicks] failed code=${String(error?.code || 'PRIZEPICKS_FAST_REFRESH_FAILED').slice(0,80)}`);
      }
    }

    // Sportsbooks are deliberately slower than DFS pick'em feeds so Auto Scout
    // stays respectful of anonymous sportsbook endpoints while the high-change
    // PrizePicks/Underdog board can update much faster.
    const sportsbookSeconds = clampInt(process.env.AUTOSCOUT_SPORTSBOOK_INGEST_SECONDS, 180, 60, 900);
    if (publicClaimed && due(lastSportsbookAt, sportsbookSeconds)) {
      lastSportsbookAt = Date.now();
      try {
        const books = await runFreeSportsbooksCycle();
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
        const dk = await runDraftKingsPick6Cycle();
        console.log('[AutoScout DraftKings Pick6]', JSON.stringify(dk));
      } catch (error) {
        console.log(`[AutoScout DraftKings Pick6] failed code=${String(error?.code || 'DRAFTKINGS_PICK6_FAILED').slice(0,80)}`);
      }
    }

    // Refresh remaining free supplemental feeds. Their own per-provider TTLs and
    // single-flight guards prevent the fast scheduler from multiplying requests.
    await publicFeeds.refresh();
    console.log('[AutoScout public feeds]', JSON.stringify(publicFeeds.health()));

    // Tennis is public/cache only here and never widens automatic paid-provider polling.
    for (const sport of PUBLIC_PERSISTENCE_SPORTS) {
      try {
        const raw = await fetchUnifiedBoard(sport, { cacheOnly: true });
        const board = decorateBoardWithScoutAudit(raw);
        // Snapshots are what line history is made of, and this scheduler is the
        // only thing writing continuously - switching them off here stopped the
        // history dead. They only carry lines that actually moved now, so the
        // volume that made them expensive is gone.
        const result = await persistNormalizedBoard(board, { includeSnapshots: true });
        const counts = result?.counts || {};
        console.log(`[AutoScout persistence] ${reason} ${sport} public-only persisted=${Boolean(result?.persisted)} events=${counts.events || 0} props=${counts.props || 0} lines=${counts.lines || 0}`);
        // A transient database/API outage affects every following sport too. Do
        // not turn one 503 into a dozen more failed writes in the same cycle;
        // leave the live in-memory feeds alone and probe again next scheduled run.
        const status = Number(result?.error?.status || 0);
        if (!result?.persisted && TRANSIENT_DATABASE_STATUSES.has(status)) {
          console.log(`[AutoScout persistence] ${reason} database-degraded status=${status}; remaining sport writes deferred`);
          break;
        }
      } catch (error) {
        console.log(`[AutoScout persistence] ${reason} ${sport} failed code=${String(error?.code || 'PERSIST_SYNC_FAILED').slice(0, 80)}`);
      }
    }

    // Snapshot retention, at most once a day and only when someone has set a
    // window. Unset means the call is never made - history is not something a
    // deploy should start deleting on its own.
    if (retentionConfig().enabled && due(lastPruneAt, 86_400)) {
      lastPruneAt = Date.now();
      const pruned = await pruneLineSnapshots();
      if (pruned.ran) console.log(`[AutoScout retention] ${reason} keepDays=${pruned.keepDays} deleted=${pruned.deleted || 0} more=${Boolean(pruned.more)} error=${pruned.error?.code || 'none'}`);
    }
  } finally {
    syncRunning = false;
  }
}

export function startFrugalPersistence() {
  if (ingestConfig().enabled) return null;
  const ingestSeconds = clampInt(process.env.AUTOSCOUT_PUBLIC_INGEST_SECONDS, 45, 30, 300);
  setTimeout(() => { void persistBoards('bootstrap'); }, 5000).unref();
  // A previous container can leave the shared scheduler lease just beyond startup.
  // Retry once; the database lease still prevents duplicate provider fan-out.
  setTimeout(() => { void persistBoards('bootstrap-retry'); }, 20_000).unref();
  const timer = setInterval(() => { void persistBoards('scheduled'); }, ingestSeconds * 1000);
  timer.unref();
  console.log(`[AutoScout persistence] single public-feed scheduler, interval=${ingestSeconds} seconds, paid-refresh=off`);
  return timer;
}
