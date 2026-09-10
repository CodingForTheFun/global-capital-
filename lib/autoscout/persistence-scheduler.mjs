import { fetchUnifiedBoard } from '../../apex-v2/provider.mjs';
import { decorateBoardWithScoutAudit } from './scout-rules.mjs';
import { persistNormalizedBoard, persistenceHealth } from './supabase-persistence.mjs';
import { SUPPORTED_SPORTS } from './models.mjs';
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
    for (const sport of SUPPORTED_SPORTS) {
      try {
        const raw = await fetchUnifiedBoard(sport, {});
        const board = decorateBoardWithScoutAudit(raw);
        const includeSnapshots = board?.meta?.cacheHit !== true;
        const result = await persistNormalizedBoard(board, { includeSnapshots });
        const counts = result?.counts || {};
        console.log(`[AutoScout persistence] ${reason} ${sport} persisted=${Boolean(result?.persisted)} events=${counts.events || 0} props=${counts.props || 0} lines=${counts.lines || 0} snapshots=${counts.snapshots || 0} cache=${board?.meta?.cacheHit ? 'hit' : 'miss'}`);
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
  const ingestMinutes = clampInt(process.env.AUTOSCOUT_INGEST_MINUTES, 360, 30, 1440);
  setTimeout(() => { void persistBoards('bootstrap'); }, 6000).unref();
  const timer = setInterval(() => { void persistBoards('scheduled'); }, ingestMinutes * 60_000);
  timer.unref();
  console.log(`[AutoScout persistence] single core scheduler, interval=${ingestMinutes} minutes`);
  return timer;
}
