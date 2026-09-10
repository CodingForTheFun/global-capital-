import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const sourcePath = './frontdoor-prod.mjs';
const runtimePath = './.frontdoor-clearsports-runtime.mjs';
const oldImport = "./lib/autoscout/research-service.mjs";
const newImport = "./lib/autoscout/research-service-v2.mjs";

const source = readFileSync(sourcePath, 'utf8');
if (!source.includes(oldImport)) {
  throw new Error('ClearSports bootstrap could not locate the research-service import.');
}

writeFileSync(runtimePath, source.replace(oldImport, newImport), 'utf8');
await import(pathToFileURL(runtimePath).href);

const [{ fetchUnifiedBoard }, { decorateBoardWithScoutAudit }, { persistNormalizedBoard, persistenceHealth }, { SUPPORTED_SPORTS }] = await Promise.all([
  import('./apex-v2/provider.mjs'),
  import('./lib/autoscout/scout-rules.mjs'),
  import('./lib/autoscout/supabase-persistence.mjs'),
  import('./lib/autoscout/models.mjs'),
]);

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

const ingestMinutes = clampInt(process.env.AUTOSCOUT_INGEST_MINUTES, 360, 30, 1440);
setTimeout(() => { void persistBoards('bootstrap'); }, 6000).unref();
setInterval(() => { void persistBoards('scheduled'); }, ingestMinutes * 60_000).unref();
console.log(`[AutoScout persistence] scheduled every ${ingestMinutes} minutes; cached boards backfill without creating synthetic line-history snapshots.`);
