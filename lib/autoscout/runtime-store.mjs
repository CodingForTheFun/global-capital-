import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { SUPPORTED_SPORTS } from './models.mjs';

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const ROOT = path.join(DATA_DIR, 'autoscout');
const BOARD_DIR = path.join(ROOT, 'boards');
const STATE_FILE = path.join(ROOT, 'diagnostics.json');
const memoryBoards = new Map();

const runtime = {
  startedAt: new Date().toISOString(),
  day: new Date().toISOString().slice(0, 10),
  providerRequestsToday: 0,
  observedCreditsToday: 0,
  apiFailuresToday: 0,
  cacheHits: 0,
  cacheMisses: 0,
  lastSuccessfulIngestion: null,
  lastProviderRequestAt: null,
  quota: { used: null, remaining: null, lastCost: null, updatedAt: null },
  syncingSports: new Set(),
  syncingEvents: new Set(),
  sports: new Map(),
  errors: [],
};

function resetDayIfNeeded() {
  const today = new Date().toISOString().slice(0, 10);
  if (runtime.day === today) return;
  runtime.day = today;
  runtime.providerRequestsToday = 0;
  runtime.observedCreditsToday = 0;
  runtime.apiFailuresToday = 0;
}

function safeSport(value) {
  const sport = String(value || '').toUpperCase();
  return SUPPORTED_SPORTS.includes(sport) ? sport : null;
}

async function atomicWrite(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(value), 'utf8');
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {});
  }
}

function boardFile(sport) { return path.join(BOARD_DIR, `${sport.toLowerCase()}.json`); }

export async function loadPersistedDiagnostics() {
  try {
    const stored = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
    if (stored?.day === runtime.day) {
      runtime.providerRequestsToday = Number(stored.providerRequestsToday || 0);
      runtime.observedCreditsToday = Number(stored.observedCreditsToday || 0);
      runtime.apiFailuresToday = Number(stored.apiFailuresToday || 0);
    }
    runtime.lastSuccessfulIngestion = stored?.lastSuccessfulIngestion || null;
    runtime.quota = { ...runtime.quota, ...(stored?.quota || {}) };
    runtime.errors = Array.isArray(stored?.errors) ? stored.errors.slice(0, 100) : [];
    for (const [sport, value] of Object.entries(stored?.sports || {})) {
      if (safeSport(sport)) runtime.sports.set(sport, value);
    }
  } catch {}
}

async function persistDiagnostics() {
  const state = snapshotDiagnostics();
  await atomicWrite(STATE_FILE, state).catch(() => {});
}

export async function readCachedBoard(sport, { allowStale = false } = {}) {
  const selected = safeSport(sport);
  if (!selected) return null;
  let entry = memoryBoards.get(selected) || null;
  if (!entry) {
    try {
      entry = JSON.parse(await fs.readFile(boardFile(selected), 'utf8'));
      if (entry?.value) memoryBoards.set(selected, entry);
    } catch {}
  }
  if (!entry?.value) {
    runtime.cacheMisses += 1;
    return null;
  }
  const expired = Number(entry.expiresAt || 0) <= Date.now();
  if (expired && !allowStale) {
    runtime.cacheMisses += 1;
    return null;
  }
  runtime.cacheHits += 1;
  return { ...entry.value, meta: { ...(entry.value.meta || {}), cacheHit: true, stale: expired } };
}

export async function writeCachedBoard(sport, value, ttlSeconds) {
  const selected = safeSport(sport);
  if (!selected || !value) return;
  const now = Date.now();
  const entry = {
    storedAt: new Date(now).toISOString(),
    expiresAt: now + Math.max(30, Number(ttlSeconds || 300)) * 1000,
    value,
  };
  memoryBoards.set(selected, entry);
  await atomicWrite(boardFile(selected), entry).catch(() => {});
}

export function markSportSync(sport, active) {
  const selected = safeSport(sport);
  if (!selected) return;
  if (active) runtime.syncingSports.add(selected); else runtime.syncingSports.delete(selected);
}

export function markEventSync(eventId, active) {
  const id = String(eventId || '').trim();
  if (!id) return;
  if (active) runtime.syncingEvents.add(id); else runtime.syncingEvents.delete(id);
}

export function recordProviderRequest({ cost = null, remaining = null, used = null } = {}) {
  resetDayIfNeeded();
  runtime.providerRequestsToday += 1;
  runtime.lastProviderRequestAt = new Date().toISOString();
  if (Number.isFinite(Number(cost))) runtime.observedCreditsToday += Number(cost);
  if (Number.isFinite(Number(used))) runtime.quota.used = Number(used);
  if (Number.isFinite(Number(remaining))) runtime.quota.remaining = Number(remaining);
  if (Number.isFinite(Number(cost))) runtime.quota.lastCost = Number(cost);
  runtime.quota.updatedAt = new Date().toISOString();
  void persistDiagnostics();
}

export function recordProviderError({ provider = 'unknown', endpoint = null, sport = null, event = null, status = null, reason = null, code = null } = {}) {
  resetDayIfNeeded();
  runtime.apiFailuresToday += 1;
  runtime.errors.unshift({ provider, endpoint, sport: safeSport(sport) || sport || null, event: event || null, status: Number(status) || null, code: code || null, reason: String(reason || 'Provider request failed').slice(0, 500), timestamp: new Date().toISOString() });
  runtime.errors = runtime.errors.slice(0, 100);
  void persistDiagnostics();
}

export function recordSportIngestion(sport, board, { ttlSeconds = null } = {}) {
  const selected = safeSport(sport);
  if (!selected) return;
  const meta = board?.meta || {};
  const props = Array.isArray(board?.props) ? board.props : [];
  const events = Array.isArray(board?.data?.events) ? board.data.events : [];
  const markets = Array.isArray(board?.data?.props) ? board.data.props : [];
  const lines = Array.isArray(board?.data?.lines) ? board.data.lines : [];
  const bookmakers = new Set(lines.map((row) => row.bookmakerKey).filter(Boolean));
  runtime.lastSuccessfulIngestion = new Date().toISOString();
  runtime.sports.set(selected, {
    sport: selected,
    status: 'ok',
    events: events.length || Number(meta.events || 0),
    propMarkets: new Set(markets.map((row) => row.marketKey).filter(Boolean)).size || (Array.isArray(meta.marketKeys) ? meta.marketKeys.length : 0),
    bookmakers: bookmakers.size || Number(meta.sportsbookCount || 0),
    lines: lines.length || props.length,
    props: markets.length || new Set(props.map((row) => [row.eventId,row.playerName,row.marketId].join('|'))).size,
    provider: meta.provider || null,
    fetchedAt: meta.fetchedAt || runtime.lastSuccessfulIngestion,
    ttlSeconds: ttlSeconds ?? meta.cacheSeconds ?? null,
    lastError: null,
  });
  void persistDiagnostics();
}

export function recordSportFailure(sport, error) {
  const selected = safeSport(sport);
  if (!selected) return;
  const previous = runtime.sports.get(selected) || { sport: selected, events: 0, propMarkets: 0, bookmakers: 0, lines: 0, props: 0 };
  runtime.sports.set(selected, { ...previous, status: 'error', lastError: String(error?.message || error || 'Unknown error').slice(0, 500), failedAt: new Date().toISOString() });
  void persistDiagnostics();
}

export function snapshotDiagnostics() {
  resetDayIfNeeded();
  const hits = runtime.cacheHits;
  const misses = runtime.cacheMisses;
  const sports = Object.fromEntries(SUPPORTED_SPORTS.map((sport) => [sport, runtime.sports.get(sport) || { sport, status: 'not-synced', events: 0, propMarkets: 0, bookmakers: 0, lines: 0, props: 0 }]));
  return {
    service: 'Auto Scout data core',
    startedAt: runtime.startedAt,
    day: runtime.day,
    requestsToday: runtime.providerRequestsToday,
    estimatedCreditsUsedToday: runtime.observedCreditsToday,
    apiFailuresToday: runtime.apiFailuresToday,
    cache: {
      hits,
      misses,
      hitPercentage: hits + misses ? Number(((hits / (hits + misses)) * 100).toFixed(1)) : null,
      persistence: 'Railway volume',
    },
    quota: { ...runtime.quota },
    lastSuccessfulIngestion: runtime.lastSuccessfulIngestion,
    lastProviderRequestAt: runtime.lastProviderRequestAt,
    sportsCurrentlySyncing: [...runtime.syncingSports],
    eventsCurrentlySyncing: [...runtime.syncingEvents],
    propsCurrentlyStored: Object.values(sports).reduce((sum, row) => sum + Number(row.lines || 0), 0),
    sports,
    errors: runtime.errors.slice(0, 50),
  };
}
