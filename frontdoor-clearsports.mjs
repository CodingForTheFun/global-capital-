import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createClearSportsClient } from './lib/data-sources/clearsports/client.mjs';

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

function findFirstArray(value, path = 'root', depth = 0) {
  if (Array.isArray(value)) return { path, rows: value };
  if (!value || typeof value !== 'object' || depth > 3) return null;
  for (const [key, child] of Object.entries(value)) {
    const found = findFirstArray(child, `${path}.${key}`, depth + 1);
    if (found) return found;
  }
  return null;
}

function safeSchema(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return { type: typeof row };
  const topKeys = Object.keys(row).slice(0, 60);
  const nested = {};
  for (const key of topKeys) {
    const value = row[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) nested[key] = Object.keys(value).slice(0, 30);
  }
  return { topKeys, nested };
}

function safeIdentityPreview(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return {};
  const out = {};
  const allow = /(player|name|first|last|team|athlete|season|game|date)/i;
  for (const [key, value] of Object.entries(row)) {
    if (!allow.test(key)) continue;
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) out[key] = String(value).slice(0, 80);
  }
  return out;
}

setTimeout(async () => {
  try {
    const client = createClearSportsClient({ timeoutMs: 9000, maxEntries: 10 });
    const probe = await client.probe();
    console.log(`[ClearSports self-check] configured=${probe.configured} reachable=${probe.reachable} status=${probe.status ?? 0} active=${probe.active} creditsRemaining=${probe.creditsRemaining ?? 'unknown'} creditsTotal=${probe.creditsTotal ?? 'unknown'}`);
    if (!probe.reachable) return;

    const stats = await client.get('/nfl/player-stats', { ttlMs: 0 });
    if (!stats.ok) {
      console.log(`[ClearSports schema-check] nfl/player-stats status=${stats.status || 0} code=${stats.code || 'UNKNOWN'}`);
      return;
    }
    const found = findFirstArray(stats.data);
    const rows = found?.rows || [];
    const stafford = rows.find((row) => /matthew\s+stafford/i.test(JSON.stringify(row))) || null;
    console.log(`[ClearSports schema-check] path=${found?.path || 'none'} rows=${rows.length} sample=${JSON.stringify(safeSchema(rows[0]))}`);
    console.log(`[ClearSports identity-check] first=${JSON.stringify(safeIdentityPreview(rows[0]))} staffordFound=${Boolean(stafford)} stafford=${JSON.stringify(safeIdentityPreview(stafford))}`);
  } catch (error) {
    console.log(`[ClearSports self-check] failed=${String(error?.name || 'ERROR')}`);
  }
}, 2500);
