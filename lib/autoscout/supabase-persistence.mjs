import { assertIngestionActive, ingestionFetch } from '../ingestion/operation-deadline.mjs';
import { stableId } from './models.mjs';
const text = (value) => String(value ?? '').trim();
const SUPABASE_URL = () => text(process.env.AUTOSCOUT_SUPABASE_URL || process.env.SUPABASE_URL).replace(/\/$/, '');
const SERVICE_KEY = () => text(process.env.AUTOSCOUT_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
const PUBLIC_KEY = () => text(process.env.AUTOSCOUT_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY);
const INGEST_TOKEN = () => text(process.env.AUTOSCOUT_SUPABASE_INGEST_TOKEN);
const TRANSIENT_DATA_API_STATUSES = new Set([500, 502, 503, 504]);
const enabled = (value) => ['1', 'true', 'yes', 'on'].includes(text(value).toLowerCase());
const directPrimaryBoardWrites = () => enabled(process.env.AUTOSCOUT_DIRECT_DB_PRIMARY);

let lastWriteAt = null;
let lastError = null;
let lastCounts = { events: 0, players: 0, props: 0, lines: 0, snapshots: 0 };
let lastSnapshotAt = null;
let lastSnapshotError = null;
let lastPrune = null;

// A line snapshot is a record that a number MOVED. The table's unique key
// includes provider_updated_at, so a book re-stamping an unchanged line wrote
// a fresh row every cycle: 222k rows carrying only 86k distinct values, and
// 90MB of a 188MB database. That growth is why snapshots were switched off
// entirely on 2026-09-13, which stopped recording history altogether.
//
// Writing only actual moves keeps history affordable. The cache is per-process
// and deliberately not persisted. On startup/redeploy, the first observation
// seeds the cache without writing a snapshot; otherwise every restart would
// replay the full live board as a fake "movement" baseline and create a write
// storm. Current lines remain safely persisted in prop_lines.
const lastSeenQuote = new Map();
const MAX_TRACKED_QUOTES = 60_000;
export function changedSnapshots(lines = [], seen = lastSeenQuote) {
  const rows = [];
  for (const row of Array.isArray(lines) ? lines : []) {
    if (!row?.propId || !row?.bookmakerKey || !row?.side) continue;
    if (row.line === null || row.line === undefined) continue;
    const key = `${row.propId}|${row.bookmakerKey}|${row.side}`;
    const value = `${row.line}|${row.price ?? ''}`;
    const previous = seen.get(key);
    if (previous === value) continue;
    seen.set(key, value);
    // A fresh process has no prior quote to compare against. Seed the cache
    // only; line history should contain real movement, not restart baselines.
    if (previous === undefined) continue;
    rows.push({ prop_id: row.propId, bookmaker_key: row.bookmakerKey, side: row.side, line: row.line, price: row.price,
      provider_updated_at: iso(row.providerUpdatedAt), ingested_at: iso(row.ingestedAt) });
  }
  // Bounded so a long-running process cannot grow this map without limit.
  if (seen.size > MAX_TRACKED_QUOTES) {
    for (const key of seen.keys()) { seen.delete(key); if (seen.size <= MAX_TRACKED_QUOTES) break; }
  }
  return rows;
}

function serviceMode() { return Boolean(SUPABASE_URL() && SERVICE_KEY()); }
function rpcMode() { return Boolean(SUPABASE_URL() && PUBLIC_KEY() && INGEST_TOKEN()); }
export function persistenceConfigured() { return serviceMode() || rpcMode(); }

function baseHeaders(key, prefer = '') {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    apikey: key,
    authorization: `Bearer ${key}`,
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

async function rest(table, { method = 'GET', query = '', body = null, prefer = '' } = {}) {
  if (!serviceMode()) throw Object.assign(new Error('Auto Scout database service mode is not configured.'), { code: 'DATABASE_NOT_CONFIGURED' });
  const response = await ingestionFetch(`${SUPABASE_URL()}/rest/v1/${table}${query ? `?${query}` : ''}`, {
    method,
    headers: baseHeaders(SERVICE_KEY(), prefer),
    body: body === null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.text();
  assertIngestionActive();
  if (!response.ok) throw Object.assign(new Error(`Database ${table} request failed with HTTP ${response.status}.`), { code: 'DATABASE_WRITE_FAILED', status: response.status });
  if (!payload) return null;
  try { return JSON.parse(payload); } catch { return null; }
}

async function directRpc(name, body) {
  const response = await ingestionFetch(`${SUPABASE_URL()}/functions/v1/autoscout-db-direct`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-autoscout-ingest-token': INGEST_TOKEN(),
    },
    body: JSON.stringify({ name, args: body }),
    signal: AbortSignal.timeout(25_000),
  });
  const payload = await response.text();
  assertIngestionActive();
  if (!response.ok) throw Object.assign(new Error(`Direct database RPC ${name} failed with HTTP ${response.status}.`), { code: 'DATABASE_DIRECT_RPC_FAILED', status: response.status });
  if (!payload) return null;
  try { return JSON.parse(payload); } catch { return null; }
}

async function rpc(name, body) {
  if (!rpcMode()) throw Object.assign(new Error('Auto Scout secure RPC mode is not configured.'), { code: 'DATABASE_NOT_CONFIGURED' });
  // Canonical board persistence is the other continuous background writer.
  // When direct-primary mode is enabled, keep this write off PostgREST too so
  // it cannot starve the public snapshot/history RPCs. Reads and retention keep
  // their existing routes; a failed board write is retried on the next cycle.
  if (name === 'autoscout_ingest_board' && directPrimaryBoardWrites()) return directRpc(name, body);
  let response;
  try {
    response = await ingestionFetch(`${SUPABASE_URL()}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: baseHeaders(PUBLIC_KEY()),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    assertIngestionActive();
    return directRpc(name, body);
  }
  const payload = await response.text();
  assertIngestionActive();
  if (!response.ok && TRANSIENT_DATA_API_STATUSES.has(Number(response.status))) return directRpc(name, body);
  if (!response.ok) throw Object.assign(new Error(`Database RPC ${name} failed with HTTP ${response.status}.`), { code: 'DATABASE_WRITE_FAILED', status: response.status });
  if (!payload) return null;
  try { return JSON.parse(payload); } catch { return null; }
}

function chunks(rows, size = 350) {
  const output = [];
  for (let i = 0; i < rows.length; i += size) output.push(rows.slice(i, i + size));
  return output;
}
async function upsert(table, rows, onConflict) {
  if (!rows.length) return;
  for (const batch of chunks(rows)) await rest(table, { method: 'POST', query: onConflict ? `on_conflict=${encodeURIComponent(onConflict)}` : '', body: batch, prefer: 'resolution=merge-duplicates,return=minimal' });
}
const iso = (value) => value || null;

export function canonicalPersistedLineId(row = {}) {
  return stableId(['line', row.propId, row.bookmakerKey, row.side, row.line]);
}

function mapBoard(board, { includeSnapshots = true } = {}) {
  const data = board?.data || {};
  const events = Array.isArray(data.events) ? data.events : [];
  const players = Array.isArray(data.players) ? data.players : [];
  const props = Array.isArray(data.props) ? data.props : [];
  const lines = Array.isArray(data.lines) ? data.lines : [];
  const now = new Date().toISOString();
  const eventRows = events.map((row) => ({ id: row.id, provider: row.provider, provider_event_id: row.providerEventId, sport_key: row.sport, league_key: row.league || row.sport, home_team: row.homeTeam || null, away_team: row.awayTeam || null, commence_time: iso(row.commenceTime), status: row.status || 'SCHEDULED', home_score: row.homeScore, away_score: row.awayScore, provider_updated_at: iso(row.providerUpdatedAt), ingested_at: iso(row.ingestedAt), updated_at: now }));
  const playerRows = players.map((row) => ({ id: row.id, sport_key: row.sport, league_key: row.league || row.sport, provider: row.provider || null, provider_player_id: row.providerPlayerId || null, canonical_name: row.canonicalName || row.name, name: row.name, team: row.team || null, position: row.position || null, headshot_url: row.headshotUrl || null, updated_at: now }));
  const bookmakerMap = new Map();
  for (const row of lines) bookmakerMap.set(row.bookmakerKey, { key: row.bookmakerKey, name: row.bookmakerName || row.bookmakerKey, updated_at: now });
  const marketMap = new Map();
  for (const row of props) marketMap.set(row.marketKey, { key: row.marketKey, name: row.marketName || row.marketKey, sport_key: row.sport, period: row.period || 'game', updated_at: now });
  const propRows = props.map((row) => ({ id: row.id, event_id: row.eventId, player_id: row.playerId, sport_key: row.sport, league_key: row.league || row.sport, market_key: row.marketKey, market_name: row.marketName || row.marketKey, period: row.period || 'game', is_alternate: row.isAlternate === true, provider: row.provider, ingested_at: iso(row.ingestedAt), updated_at: now }));
  const lineRows = lines.map((row) => ({ id: canonicalPersistedLineId(row), prop_id: row.propId, provider: row.provider, bookmaker_key: row.bookmakerKey, side: row.side, line: row.line, price: row.price, implied_probability: row.impliedProbability, deeplink: row.deeplink || null, provider_updated_at: iso(row.providerUpdatedAt), ingested_at: iso(row.ingestedAt), updated_at: now }));
  const snapshotRows = includeSnapshots ? changedSnapshots(lines) : [];
  return { events: eventRows, players: playerRows, bookmakers: [...bookmakerMap.values()], markets: [...marketMap.values()], props: propRows, lines: lineRows, snapshots: snapshotRows };
}

const EMPTY_COUNTS = Object.freeze({ events: 0, players: 0, props: 0, lines: 0, snapshots: 0 });

// Production telemetry showed more than one million canonical RPC calls.
// 500-row chunks remain bounded while halving transaction/pooler round trips
// versus 250-row batches. The SQL function still has a 15s statement timeout,
// so a bad batch fails closed instead of monopolizing the persistence cycle.
const RPC_BOARD_BATCH_SIZE = 500;
function emptyBoardPayload() {
  return { events: [], players: [], bookmakers: [], markets: [], props: [], lines: [], snapshots: [] };
}

async function persistRpcBoard(rows) {
  const totals = { events: 0, players: 0, props: 0, lines: 0, snapshots: 0 };
  const ingest = async (payload) => {
    const result = await rpc('autoscout_ingest_board', { p_token: INGEST_TOKEN(), p_payload: payload });
    totals.events += Number(result?.events || 0);
    totals.players += Number(result?.players || 0);
    totals.props += Number(result?.props || 0);
    totals.lines += Number(result?.lines || 0);
    totals.snapshots += Number(result?.snapshots || 0);
  };

  // Keep FK dependencies ordered, but avoid one giant RPC transaction. The
  // previous all-in-one payload could monopolize PostgREST's internal pool long
  // enough for unrelated requests to hit PGRST003/504. Small idempotent upsert
  // transactions release the connection quickly and are safe to retry.
  await ingest({ ...emptyBoardPayload(), bookmakers: rows.bookmakers, markets: rows.markets, events: rows.events });
  for (const batch of chunks(rows.players, RPC_BOARD_BATCH_SIZE)) await ingest({ ...emptyBoardPayload(), players: batch });
  for (const batch of chunks(rows.props, RPC_BOARD_BATCH_SIZE)) await ingest({ ...emptyBoardPayload(), props: batch });
  for (const batch of chunks(rows.lines, RPC_BOARD_BATCH_SIZE)) await ingest({ ...emptyBoardPayload(), lines: batch });
  for (const batch of chunks(rows.snapshots, RPC_BOARD_BATCH_SIZE)) await ingest({ ...emptyBoardPayload(), snapshots: batch });

  return totals;
}

export async function persistNormalizedBoard(board, { includeSnapshots = true } = {}) {
  assertIngestionActive();
  if (!persistenceConfigured()) return { configured: false, persisted: false };
  const rows = mapBoard(board, { includeSnapshots });
  // An out-of-season sport produces an empty board every cycle, and writing it
  // still costs a round trip, a transaction and a WAL record. Twelve sports on
  // a 45-second timer meant thousands of these a day carrying nothing at all.
  const nothingToWrite = !rows.events.length && !rows.players.length && !rows.props.length
    && !rows.lines.length && !rows.snapshots.length && !rows.bookmakers.length && !rows.markets.length;
  if (nothingToWrite) return { configured: true, persisted: true, skipped: 'EMPTY_BOARD', counts: EMPTY_COUNTS };
  try {
    if (rpcMode() && !serviceMode()) {
      lastCounts = await persistRpcBoard(rows);
      if (lastCounts.snapshots > 0) lastSnapshotAt = new Date().toISOString();
    } else {
      await upsert('bookmakers', rows.bookmakers, 'key');
      await upsert('markets', rows.markets, 'key');
      await upsert('events', rows.events, 'id');
      await upsert('players', rows.players, 'id');
      await upsert('props', rows.props, 'id');
      await upsert('prop_lines', rows.lines, 'id');
      // This used to swallow every snapshot failure and still report success,
      // so history could stop being written with nothing anywhere saying so.
      // A snapshot failure must not fail the board write, but it must be seen.
      try {
        for (const batch of chunks(rows.snapshots)) await rest('line_snapshots', { method: 'POST', body: batch, prefer: 'resolution=ignore-duplicates,return=minimal' });
        if (rows.snapshots.length) lastSnapshotAt = new Date().toISOString();
      } catch (error) {
        lastSnapshotError = { code: error?.code || 'SNAPSHOT_WRITE_FAILED', status: error?.status || null, at: new Date().toISOString() };
      }
      lastCounts = { events: rows.events.length, players: rows.players.length, props: rows.props.length, lines: rows.lines.length, snapshots: rows.snapshots.length };
    }
    assertIngestionActive();
    lastWriteAt = new Date().toISOString();
    lastError = null;
    return { configured: true, persisted: true, at: lastWriteAt, counts: lastCounts };
  } catch (error) {
    lastError = { code: error?.code || 'DATABASE_WRITE_FAILED', status: error?.status || null, at: new Date().toISOString() };
    return { configured: true, persisted: false, error: lastError };
  }
}

export async function getLineHistory(propId, { bookmakerKey = null, side = null, limit = 250 } = {}) {
  if (!persistenceConfigured()) return { configured: false, rows: [] };
  const id = text(propId);
  if (!id) return { configured: true, rows: [] };
  if (rpcMode() && !serviceMode()) {
    const rows = await rpc('autoscout_line_history', { p_token: INGEST_TOKEN(), p_prop_id: id, p_bookmaker_key: bookmakerKey ? text(bookmakerKey) : null, p_side: side ? text(side).toUpperCase() : null, p_limit: Math.max(1, Math.min(1000, Number(limit) || 250)) });
    return { configured: true, rows: Array.isArray(rows) ? rows : [] };
  }
  const parts = [`prop_id=eq.${encodeURIComponent(id)}`, 'select=prop_id,bookmaker_key,side,line,price,provider_updated_at,ingested_at,created_at', 'order=created_at.asc', `limit=${Math.max(1, Math.min(1000, Number(limit) || 250))}`];
  if (bookmakerKey) parts.push(`bookmaker_key=eq.${encodeURIComponent(text(bookmakerKey))}`);
  if (side) parts.push(`side=eq.${encodeURIComponent(text(side).toUpperCase())}`);
  const rows = await rest('line_snapshots', { query: parts.join('&') });
  return { configured: true, rows: Array.isArray(rows) ? rows : [] };
}

// Snapshot retention.
//
// The database cannot be trimmed from the app in secure-RPC mode - there is no
// DELETE to reach for - so the cutting happens inside a token-guarded function
// that enforces its own floor. This side only decides whether to ask, and how
// old is old enough.
//
// Retention is OFF unless AUTOSCOUT_SNAPSHOT_RETENTION_DAYS is set. History is
// the one thing here that cannot be re-fetched once it is gone, so deleting it
// is an explicit choice someone makes, never a default that arrives with a
// deploy.
const RETENTION_FLOOR_DAYS = 14;
export function retentionConfig(env = process.env) {
  const raw = text(env.AUTOSCOUT_SNAPSHOT_RETENTION_DAYS);
  if (!raw) return { enabled: false, days: null, limit: 0 };
  const days = Number(raw);
  if (!Number.isFinite(days)) return { enabled: false, days: null, limit: 0, reason: 'RETENTION_DAYS_INVALID' };
  const batch = Number(text(env.AUTOSCOUT_SNAPSHOT_RETENTION_BATCH)) || 20_000;
  return {
    enabled: true,
    // The database enforces the same floor and ignores anything shorter. Doing
    // it here too means a misconfigured value is visible in health output
    // rather than silently corrected three layers down.
    days: Math.max(RETENTION_FLOOR_DAYS, Math.floor(days)),
    limit: Math.min(50_000, Math.max(1, Math.floor(batch))),
  };
}

export async function pruneLineSnapshots({ env = process.env } = {}) {
  const config = retentionConfig(env);
  if (!config.enabled) return { ran: false, reason: config.reason || 'RETENTION_DISABLED' };
  if (!rpcMode()) return { ran: false, reason: 'RETENTION_REQUIRES_RPC_MODE' };
  try {
    const result = await rpc('autoscout_prune_line_snapshots', { p_token: INGEST_TOKEN(), p_days: config.days, p_limit: config.limit });
    lastPrune = { at: new Date().toISOString(), deleted: Number(result?.deleted || 0), keepDays: Number(result?.keepDays || config.days), more: Boolean(result?.more), error: null };
    return { ran: true, ...lastPrune };
  } catch (error) {
    lastPrune = { at: new Date().toISOString(), deleted: 0, keepDays: config.days, more: false, error: { code: error?.code || 'RETENTION_FAILED', status: error?.status || null } };
    return { ran: true, ...lastPrune };
  }
}

export function persistenceHealth() {
  return {
    configured: persistenceConfigured(),
    // Without these, persistence reported healthy for two days while writing
    // no history at all. What is written, and when, is the thing to watch.
    lastSnapshotAt,
    lastSnapshotError,
    retention: { ...retentionConfig(), lastRun: lastPrune },
    backend: 'Supabase/PostgreSQL',
    mode: serviceMode() ? 'service-role' : rpcMode() ? 'secure-rpc' : 'not-configured',
    lastWriteAt,
    lastError,
    lastCounts,
  };
}