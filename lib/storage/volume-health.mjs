import { lstatSync, readdirSync, statfsSync } from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const MB = 1024 * 1024;
const DEFAULT_WARN_RATIO = 0.80;
const DEFAULT_CRITICAL_RATIO = 0.90;
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

export function classifyStorage(usedRatio, {
  warnRatio = DEFAULT_WARN_RATIO,
  criticalRatio = DEFAULT_CRITICAL_RATIO,
} = {}) {
  const ratio = Math.max(0, finite(usedRatio));
  if (ratio >= criticalRatio) return 'critical';
  if (ratio >= warnRatio) return 'warning';
  return 'healthy';
}

export function storageHealth(root = DATA_DIR, options = {}) {
  try {
    const fs = statfsSync(root);
    const blockSize = finite(fs.bsize);
    const totalBytes = blockSize * finite(fs.blocks);
    const freeBytes = blockSize * finite(fs.bavail);
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    const usedRatio = totalBytes > 0 ? usedBytes / totalBytes : 0;
    return {
      available: true,
      status: classifyStorage(usedRatio, options),
      usedPct: Number((usedRatio * 100).toFixed(1)),
      totalMB: Number((totalBytes / MB).toFixed(1)),
      freeMB: Number((freeBytes / MB).toFixed(1)),
    };
  } catch (error) {
    return {
      available: false,
      status: 'unavailable',
      usedPct: null,
      totalMB: null,
      freeMB: null,
      code: String(error?.code || 'STORAGE_STAT_FAILED').slice(0, 60),
    };
  }
}

export function storageInventory(root = DATA_DIR, { maxEntries = 10_000, limit = 12 } = {}) {
  const stack = [{ absolute: root, relative: '' }];
  const topLevelBytes = new Map();
  const files = [];
  let scanned = 0;
  let truncated = false;

  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current.absolute, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      scanned += 1;
      if (scanned > maxEntries) {
        truncated = true;
        stack.length = 0;
        break;
      }
      const relative = current.relative ? `${current.relative}/${entry.name}` : entry.name;
      const absolute = path.join(current.absolute, entry.name);
      let stat;
      try { stat = lstatSync(absolute); } catch { continue; }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        stack.push({ absolute, relative });
        continue;
      }
      if (!stat.isFile()) continue;

      const bytes = finite(stat.size);
      const topLevel = relative.split('/')[0] || relative;
      topLevelBytes.set(topLevel, (topLevelBytes.get(topLevel) || 0) + bytes);
      files.push({ path: relative, bytes });
    }
  }

  const sortRows = (rows) => rows.sort((a, b) => b.bytes - a.bytes).slice(0, limit);
  return {
    scanned,
    truncated,
    topLevel: sortRows([...topLevelBytes.entries()].map(([name, bytes]) => ({
      name,
      mb: Number((bytes / MB).toFixed(2)),
      bytes,
    }))).map(({ bytes, ...row }) => row),
    largestFiles: sortRows(files).map(({ path: filePath, bytes }) => ({
      path: filePath,
      mb: Number((bytes / MB).toFixed(2)),
    })),
  };
}

function reportStorage({ force = false } = {}) {
  const health = storageHealth();
  if (!force && health.status === 'healthy') return health;

  const inventory = health.available ? storageInventory() : { scanned: 0, truncated: false, topLevel: [], largestFiles: [] };
  const payload = {
    ...health,
    scanned: inventory.scanned,
    truncated: inventory.truncated,
    topLevel: inventory.topLevel,
    largestFiles: inventory.largestFiles,
  };
  const line = `[storage] ${JSON.stringify(payload)}`;
  if (health.status === 'warning' || health.status === 'critical') console.warn(line);
  else console.log(line);
  return health;
}

export function startStorageMonitor({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  reportStorage({ force: true });
  const timer = setInterval(() => reportStorage(), Math.max(60_000, Number(intervalMs) || DEFAULT_INTERVAL_MS));
  timer.unref?.();
  return timer;
}
