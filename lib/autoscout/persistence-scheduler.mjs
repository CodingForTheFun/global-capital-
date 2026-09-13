import { fetchUnifiedBoard } from '../../apex-v2/provider.mjs';
import { publicFeeds } from '../ingestion/public-feeds.mjs';
import { publicWorkerConfigured, runPublicIngestionCycle } from '../ingestion/public-worker.mjs';
import { decorateBoardWithScoutAudit } from './scout-rules.mjs';
import { persistNormalizedBoard, persistenceHealth } from './supabase-persistence.mjs';
import { AUTOMATIC_SPORTS } from './models.mjs';
import { ingestConfig } from './ingest-worker.mjs';

const clampInt = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
};

let syncRunning = false;

async function persistBoards(reason) {
  if (syncRunning || !persistenceHealth().configured) return;
  syncRunning = true;
  try {
    if (publicWorkerConfigured()) {
      try {
        const snapshot = await runPublicIngestionCycle();
        const written = snapshot.results?.reduce((sum, row) => sum + Number(row?.written || 0), 0) || 0;
        console.log(`[AutoScout public snapshots] ${reason} claimed=${Boolean(snapshot.claimed)} written=${written}`, JSON.stringify(snapshot.results || []));
      } catch (error) {
        console.log(`[AutoScout public snapshots] ${reason} failed code=${String(error?.code || 'PUBLIC_SNAPSHOT_FAILED').slice(0, 80)}`);
      }
    }
    // Refresh remaining free supplemental feeds. PrizePicks/Underdog are single-flight
    // and will be no-ops here if the atomic snapshot cycle just refreshed them.
    await publicFeeds.refresh();
    console.log('[AutoScout public feeds]', JSON.stringify(publicFeeds.health()));
    for (const sport of AUTOMATIC_SPORTS) {
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
    syncRunning = false;
  }
}

export function startFrugalPersistence() {
  if (ingestConfig().enabled) return null;
  const ingestMinutes = clampInt(process.env.AUTOSCOUT_PUBLIC_INGEST_MINUTES, 3, 2, 30);
  setTimeout(() => { void persistBoards('bootstrap'); }, 6000).unref();
  // A previous container can leave the cross-instance scheduler's next_at a few
  // seconds beyond startup. Retry once so a deployment does not sit empty until
  // the first three-minute interval; the database lease still prevents duplicates.
  setTimeout(() => { void persistBoards('bootstrap-retry'); }, 20_000).unref();
  const timer = setInterval(() => { void persistBoards('scheduled'); }, ingestMinutes * 60_000);
  timer.unref();
  console.log(`[AutoScout persistence] single public-feed scheduler, interval=${ingestMinutes} minutes, paid-refresh=off`);
  return timer;
}
