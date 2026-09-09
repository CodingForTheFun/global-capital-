import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const DATA = path.resolve(process.env.DATA_DIR || './data');
const FILE = path.join(DATA, 'access-codes.json');
const PEPPER = process.env.DASHBOARD_SESSION_SECRET || process.env.AUTOPROP_MASTER_KEY || process.env.DASHBOARD_PASSWORD || 'autoprop-local-only';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BOOTSTRAP = {
  id: 'friend-20260908',
  label: 'Friend access',
  salt: 'c1583dc3abc8e0cad22d2dc7cd9ad3a7',
  hash: 'ba8d3b3223afe0990867f6e496dedd707c645716e5028fcdf19379169be11b6a',
  hint: '••••-K62U',
  createdAt: '2026-09-08T23:38:59+00:00',
  expiresAt: '2026-10-08T23:38:59+00:00',
  maxUses: 5,
};

async function readRows() {
  try {
    const rows = JSON.parse(await fs.readFile(FILE, 'utf8'));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

async function writeRows(rows) {
  await fs.mkdir(DATA, { recursive: true });
  const temp = `${FILE}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(temp, JSON.stringify(rows, null, 2), 'utf8');
  await fs.rename(temp, FILE);
}

function normalize(code = '') {
  return String(code).trim().toUpperCase().replace(/\s+/g, '');
}

function digest(code) {
  return crypto.createHmac('sha256', PEPPER).update(normalize(code)).digest('hex');
}

// scryptSync blocks the event loop for ~100ms per call, which would stall every
// other dashboard request during a redemption attempt. Use the async form.
function bootstrapDigest(code) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(normalize(code), Buffer.from(BOOTSTRAP.salt, 'hex'), 32, {
      N: 16384,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    }, (error, derived) => (error ? reject(error) : resolve(derived.toString('hex'))));
  });
}

function safeHashEqual(a, b) {
  const aa = Buffer.from(String(a), 'hex');
  const bb = Buffer.from(String(b), 'hex');
  return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
}

function randomChunk(length = 4) {
  let out = '';
  while (out.length < length) out += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  return out;
}

// Explicit allowlist. `codeHash` and `salt` must never cross this boundary, so
// the shape is built field by field rather than by spreading the stored row.
function publicRow(row) {
  const maxUses = Number(row.maxUses || 1);
  const uses = Number(row.uses || 0);
  return {
    id: row.id,
    label: row.label,
    hint: row.hint,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    maxUses,
    uses,
    usesRemaining: Math.max(0, maxUses - uses),
    active: row.active !== false,
    lastUsedAt: row.lastUsedAt || null,
    role: 'member',
  };
}

/** True while the code behind a member session is still usable. */
function rowUsable(row, now = Date.now()) {
  if (!row) return false;
  if (row.active === false) return false;
  if (Date.parse(row.expiresAt || '') <= now) return false;
  return true;
}

export async function generateAccessCode({ label = 'Friend access', expiresInDays = 30, maxUses = 5 } = {}) {
  const days = Math.max(1, Math.min(90, Number(expiresInDays) || 30));
  const uses = Math.max(1, Math.min(20, Number(maxUses) || 5));
  const code = `AP-${randomChunk()}-${randomChunk()}-${randomChunk()}`;
  const now = Date.now();
  const row = {
    id: crypto.randomUUID(),
    label: String(label || 'Friend access').trim().slice(0, 80) || 'Friend access',
    codeHash: digest(code),
    hint: `••••-${code.slice(-4)}`,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + days * 24 * 60 * 60 * 1000).toISOString(),
    maxUses: uses,
    uses: 0,
    active: true,
    lastUsedAt: null,
  };
  const rows = await readRows();
  rows.unshift(row);
  await writeRows(rows.slice(0, 250));
  return { code, ...publicRow(row) };
}

export async function redeemAccessCode(code) {
  const normalized = normalize(code);
  if (!/^AP-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(normalized)) return null;
  const target = digest(normalized);
  const rows = await readRows();
  const now = Date.now();

  for (const row of rows) {
    if (row.bootstrap) continue;
    if (row.active === false) continue;
    if (Date.parse(row.expiresAt || '') <= now) continue;
    if (Number(row.uses || 0) >= Number(row.maxUses || 1)) continue;
    if (!safeHashEqual(row.codeHash, target)) continue;
    row.uses = Number(row.uses || 0) + 1;
    row.lastUsedAt = new Date(now).toISOString();
    await writeRows(rows);
    return publicRow(row);
  }

  if (Date.parse(BOOTSTRAP.expiresAt) > now && safeHashEqual(await bootstrapDigest(normalized), BOOTSTRAP.hash)) {
    let row = rows.find((item) => item.id === BOOTSTRAP.id);
    if (!row) {
      row = {
        id: BOOTSTRAP.id,
        label: BOOTSTRAP.label,
        hint: BOOTSTRAP.hint,
        createdAt: BOOTSTRAP.createdAt,
        expiresAt: BOOTSTRAP.expiresAt,
        maxUses: BOOTSTRAP.maxUses,
        uses: 0,
        active: true,
        lastUsedAt: null,
        bootstrap: true,
      };
      rows.unshift(row);
    }
    if (row.active === false || Number(row.uses || 0) >= Number(row.maxUses || BOOTSTRAP.maxUses)) return null;
    row.uses = Number(row.uses || 0) + 1;
    row.lastUsedAt = new Date(now).toISOString();
    await writeRows(rows.slice(0, 250));
    return publicRow(row);
  }

  return null;
}

export async function listAccessCodes() {
  return (await readRows()).map(publicRow);
}

export async function revokeAccessCode(id) {
  const rows = await readRows();
  let row = rows.find((item) => item.id === id);
  if (!row && id === BOOTSTRAP.id) {
    row = {
      id: BOOTSTRAP.id,
      label: BOOTSTRAP.label,
      hint: BOOTSTRAP.hint,
      createdAt: BOOTSTRAP.createdAt,
      expiresAt: BOOTSTRAP.expiresAt,
      maxUses: BOOTSTRAP.maxUses,
      uses: 0,
      active: false,
      lastUsedAt: null,
      bootstrap: true,
    };
    rows.unshift(row);
  }
  if (!row) return null;
  row.active = false;
  await writeRows(rows.slice(0, 250));
  invalidateAccessCodeCache(row.id);
  return publicRow(row);
}

/**
 * Re-validate a member session against the code that issued it.
 *
 * Session cookies live for 30 days, so without this a revoked or expired code
 * would keep working until the cookie lapsed. Called on every authenticated
 * request, so results are briefly memoised to avoid re-reading the volume
 * during dashboard polling.
 */
const activeCache = new Map();
const ACTIVE_CACHE_MS = 5000;

export async function isAccessCodeActive(id, { now = Date.now() } = {}) {
  const key = String(id || '');
  if (!key) return false;
  const cached = activeCache.get(key);
  if (cached && now - cached.at < ACTIVE_CACHE_MS) return cached.value;

  const rows = await readRows();
  const row = rows.find((item) => item.id === key)
    || (key === BOOTSTRAP.id ? { ...BOOTSTRAP, uses: 0, active: true } : null);
  // A member session outlives its use count (uses are consumed at redemption),
  // so only revocation and expiry end it.
  const value = rowUsable(row, now);
  activeCache.set(key, { value, at: now });
  return value;
}

/** Drop memoised state so a revoke takes effect immediately. */
export function invalidateAccessCodeCache(id) {
  if (id) activeCache.delete(String(id));
  else activeCache.clear();
}
