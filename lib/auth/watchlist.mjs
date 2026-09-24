import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const DATA = path.resolve(process.env.DATA_DIR || './data');
const FILE = path.join(DATA, 'watchlists.json');
const MAX_ITEMS = 100;
let writeQueue = Promise.resolve();

const clean = (value, max) => {
  const out = String(value ?? '').trim();
  return out && out.length <= max ? out : null;
};

function invalid(message) {
  throw Object.assign(new Error(message), { code: 'REQUEST_INVALID' });
}

export function sanitizeWatchlistItem(input, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('A saved prop is required.');
  const key = clean(input.key, 320);
  const sport = clean(input.sport, 32);
  const player = clean(input.player, 160);
  const market = clean(input.market, 200);
  const period = clean(input.period || 'game', 32);
  const line = Number(input.line);
  if (!key || !sport || !player || !market || !period || !Number.isFinite(line)) {
    invalid('The saved prop is incomplete.');
  }
  return {
    key,
    sport,
    player,
    market,
    line,
    period,
    team: clean(input.team, 120),
    opponent: clean(input.opponent, 160),
    propId: clean(input.propId, 240),
    startsAt: clean(input.startsAt, 80),
    savedAt: new Date(now).toISOString(),
  };
}

async function readAll() {
  try {
    const parsed = JSON.parse(await fs.readFile(FILE, 'utf8'));
    return parsed && typeof parsed === 'object' && parsed.watchlists && typeof parsed.watchlists === 'object'
      ? parsed.watchlists
      : {};
  } catch {
    return {};
  }
}

async function writeAll(watchlists) {
  await fs.mkdir(DATA, { recursive: true });
  const temp = `${FILE}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify({ version: 1, watchlists }, null, 2), 'utf8');
    await fs.rename(temp, FILE);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {});
  }
}

function transaction(mutate) {
  const run = writeQueue.then(async () => {
    const watchlists = await readAll();
    const value = await mutate(watchlists);
    await writeAll(watchlists);
    return value;
  });
  writeQueue = run.then(() => {}, () => {});
  return run;
}

function itemsFor(watchlists, userId) {
  const rows = Array.isArray(watchlists[String(userId)]) ? watchlists[String(userId)] : [];
  return rows
    .filter((item) => item && typeof item === 'object' && clean(item.key, 320))
    .slice(0, MAX_ITEMS);
}

export async function listWatchlist(userId) {
  if (!userId) return [];
  return itemsFor(await readAll(), userId);
}

export async function upsertWatchlistItem(userId, input, { now = Date.now } = {}) {
  if (!userId) invalid('A signed-in account is required.');
  const item = sanitizeWatchlistItem(input, now());
  return transaction(async (watchlists) => {
    const items = itemsFor(watchlists, userId).filter((row) => row.key !== item.key);
    items.unshift(item);
    watchlists[String(userId)] = items.slice(0, MAX_ITEMS);
    return watchlists[String(userId)];
  });
}

export async function removeWatchlistItem(userId, key) {
  if (!userId) invalid('A signed-in account is required.');
  const cleanKey = clean(key, 320);
  if (!cleanKey) invalid('A valid saved-prop key is required.');
  return transaction(async (watchlists) => {
    const items = itemsFor(watchlists, userId).filter((row) => row.key !== cleanKey);
    if (items.length) watchlists[String(userId)] = items;
    else delete watchlists[String(userId)];
    return items;
  });
}

export async function _resetWatchlists() {
  await fs.rm(FILE, { force: true }).catch(() => {});
  writeQueue = Promise.resolve();
}
