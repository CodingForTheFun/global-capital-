// Append-only staff audit trail.
// Stores IDs and action names only: no passwords, session tokens, payment data,
// IP addresses, or provider secrets. The file lives on DATA_DIR's persistent
// volume and is readable only through owner-authorized routes.

import fs from 'node:fs/promises';
import path from 'node:path';

const DATA = path.resolve(process.env.DATA_DIR || './data');
const FILE = path.join(DATA, 'staff-audit.jsonl');
const MAX_BYTES = 2 * 1024 * 1024;
const RETAIN_LINES = 2_000;
let queue = Promise.resolve();

function clean(value, max = 120) {
  return String(value ?? '').replace(/[\r\n\t]/g, ' ').trim().slice(0, max);
}

function safeMeta(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
  const out = {};
  for (const [key, value] of Object.entries(meta).slice(0, 12)) {
    const safeKey = clean(key, 40);
    if (!safeKey) continue;
    if (typeof value === 'boolean' || Number.isFinite(value)) out[safeKey] = value;
    else if (value != null) out[safeKey] = clean(value, 160);
  }
  return out;
}

async function rotateIfNeeded() {
  const stat = await fs.stat(FILE).catch(() => null);
  if (!stat || stat.size <= MAX_BYTES) return;
  const text = await fs.readFile(FILE, 'utf8').catch(() => '');
  const kept = text.trim().split('\n').filter(Boolean).slice(-RETAIN_LINES);
  const temp = `${FILE}.${process.pid}.tmp`;
  await fs.writeFile(temp, kept.length ? `${kept.join('\n')}\n` : '', { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temp, FILE);
}

export function appendAudit({ actorId, actorRole, action, targetId = null, outcome = 'success', meta = {} } = {}) {
  const record = {
    at: new Date().toISOString(),
    actorId: clean(actorId, 80) || null,
    actorRole: clean(actorRole, 24) || null,
    action: clean(action, 100) || 'unknown',
    targetId: clean(targetId, 80) || null,
    outcome: clean(outcome, 24) || 'success',
    meta: safeMeta(meta),
  };
  const run = queue.then(async () => {
    await fs.mkdir(DATA, { recursive: true, mode: 0o700 });
    await fs.appendFile(FILE, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rotateIfNeeded();
    return record;
  });
  queue = run.then(() => {}, () => {});
  return run;
}

export async function readAudit({ limit = 250 } = {}) {
  const capped = Math.max(1, Math.min(500, Number(limit) || 250));
  const text = await fs.readFile(FILE, 'utf8').catch(() => '');
  if (!text) return [];
  return text.trim().split('\n').filter(Boolean).slice(-capped).reverse().flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}
