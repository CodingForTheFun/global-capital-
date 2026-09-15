import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { accountSecret } from './lib/auth/secret.mjs';

const DATA = path.resolve(process.env.DATA_DIR || './data');
const FILE = path.join(DATA, 'access-codes.json');
const PEPPER = accountSecret();
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_FINITE_DAYS = 3650;
const MAX_FINITE_USES = 100000;

async function readRows() {
  try {
    const rows = JSON.parse(await fs.readFile(FILE, 'utf8'));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

async function writeRows(rows) {
  await fs.mkdir(DATA, { recursive: true, mode: 0o700 });
  const temp = `${FILE}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(temp, JSON.stringify(rows, null, 2), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temp, FILE);
  await fs.chmod(FILE, 0o600).catch(() => {});
}

function normalize(code = '') {
  return String(code).trim().toUpperCase().replace(/\s+/g, '');
}

function digest(code) {
  return crypto.createHmac('sha256', PEPPER).update(normalize(code)).digest('hex');
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

function unlimitedValue(value) {
  return value === null || String(value ?? '').trim().toLowerCase() === 'unlimited';
}

function finiteNumber(value, fallback, max) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(max, parsed);
}

// Explicit allowlist. `codeHash` must never cross this boundary, so the shape
// is built field by field rather than by spreading the stored row.
function publicRow(row) {
  const unlimitedUses = row.maxUses === null;
  const maxUses = unlimitedUses ? null : Math.max(1, Number(row.maxUses || 1));
  const uses = Number(row.uses || 0);
  return {
    id: row.id,
    label: row.label,
    hint: row.hint,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt || null,
    neverExpires: !row.expiresAt,
    maxUses,
    unlimitedUses,
    uses,
    usesRemaining: unlimitedUses ? null : Math.max(0, maxUses - uses),
    active: row.active !== false && rowUsable(row),
    lastUsedAt: row.lastUsedAt || null,
    role: 'member',
  };
}

/** True while the code behind a member session is still usable. */
function rowUsable(row, now = Date.now()) {
  if (!row) return false;
  if (row.active === false) return false;
  if (row.expiresAt) {
    const expires = Date.parse(row.expiresAt);
    if (Number.isFinite(expires) && expires <= now) return false;
  }
  return true;
}

/**
 * Generate an access code for a guest/member session.
 *
 * The owner can create as many codes as the backing volume can hold. Finite
 * durations support up to ten years for custom grants; `neverExpires` creates
 * a lifetime code. Redemption count can likewise be finite or unlimited.
 */
export async function generateAccessCode({
  label = 'Guest access',
  expiresInDays = 30,
  maxUses = 5,
  neverExpires = false,
  unlimitedUses = false,
} = {}) {
  const lifetime = neverExpires === true || unlimitedValue(expiresInDays);
  const days = lifetime ? null : finiteNumber(expiresInDays, 30, MAX_FINITE_DAYS);
  const noUseLimit = unlimitedUses === true || unlimitedValue(maxUses);
  const uses = noUseLimit ? null : finiteNumber(maxUses, 5, MAX_FINITE_USES);
  const code = `AP-${randomChunk()}-${randomChunk()}-${randomChunk()}`;
  const now = Date.now();
  const row = {
    id: crypto.randomUUID(),
    label: String(label || 'Guest access').trim().slice(0, 80) || 'Guest access',
    codeHash: digest(code),
    hint: `••••-${code.slice(-4)}`,
    createdAt: new Date(now).toISOString(),
    expiresAt: days === null ? null : new Date(now + days * 24 * 60 * 60 * 1000).toISOString(),
    maxUses: uses,
    uses: 0,
    active: true,
    lastUsedAt: null,
  };
  const rows = await readRows();
  rows.unshift(row);
  // No application-level total-code cap. The owner can create any number of
  // grants; old/revoked rows remain visible for audit and can be removed later
  // by a dedicated retention policy rather than being silently discarded.
  await writeRows(rows);
  return { code, ...publicRow(row) };
}

export async function redeemAccessCode(code) {
  const normalized = normalize(code);
  if (!/^AP-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(normalized)) return null;
  const target = digest(normalized);
  const rows = await readRows();
  const now = Date.now();

  for (const row of rows) {
    if (row.bootstrap) continue; // Ignore any legacy bootstrap row left on disk.
    if (row.active === false) continue;
    if (row.expiresAt) {
      const expires = Date.parse(row.expiresAt);
      if (Number.isFinite(expires) && expires <= now) continue;
    }
    if (row.maxUses !== null && Number(row.uses || 0) >= Number(row.maxUses || 1)) continue;
    if (!safeHashEqual(row.codeHash, target)) continue;
    row.uses = Number(row.uses || 0) + 1;
    row.lastUsedAt = new Date(now).toISOString();
    await writeRows(rows);
    return publicRow(row);
  }

  // Production accepts only codes that were generated dynamically and stored
  // as one-way digests. No hard-coded bootstrap credential is recognized.
  return null;
}

export async function listAccessCodes() {
  return (await readRows()).filter((row) => !row.bootstrap).map(publicRow);
}

export async function revokeAccessCode(id) {
  const rows = await readRows();
  const row = rows.find((item) => item.id === id && !item.bootstrap);
  if (!row) return null;
  row.active = false;
  await writeRows(rows);
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
  const row = rows.find((item) => item.id === key && !item.bootstrap) || null;
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
