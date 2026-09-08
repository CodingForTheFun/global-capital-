import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const DATA = path.resolve(process.env.DATA_DIR || './data');
const FILE = path.join(DATA, 'access-codes.json');
const PEPPER = process.env.DASHBOARD_SESSION_SECRET || process.env.AUTOPROP_MASTER_KEY || process.env.DASHBOARD_PASSWORD || 'autoprop-local-only';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

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

function publicRow(row) {
  return {
    id: row.id,
    label: row.label,
    hint: row.hint,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    maxUses: row.maxUses,
    uses: row.uses,
    active: row.active !== false,
    lastUsedAt: row.lastUsedAt || null,
  };
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
    if (row.active === false) continue;
    if (Date.parse(row.expiresAt || '') <= now) continue;
    if (Number(row.uses || 0) >= Number(row.maxUses || 1)) continue;
    if (!safeHashEqual(row.codeHash, target)) continue;
    row.uses = Number(row.uses || 0) + 1;
    row.lastUsedAt = new Date(now).toISOString();
    await writeRows(rows);
    return publicRow(row);
  }
  return null;
}

export async function listAccessCodes() {
  return (await readRows()).map(publicRow);
}

export async function revokeAccessCode(id) {
  const rows = await readRows();
  const row = rows.find((item) => item.id === id);
  if (!row) return null;
  row.active = false;
  await writeRows(rows);
  return publicRow(row);
}
