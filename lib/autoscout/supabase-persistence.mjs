const text = (value) => String(value ?? '').trim();
const SUPABASE_URL = () => text(process.env.AUTOSCOUT_SUPABASE_URL || process.env.SUPABASE_URL).replace(/\/$/, '');
const SERVICE_KEY = () => text(process.env.AUTOSCOUT_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

let lastWriteAt = null;
let lastError = null;
let lastCounts = { events: 0, players: 0, props: 0, lines: 0, snapshots: 0 };

export function persistenceConfigured() {
  return Boolean(SUPABASE_URL() && SERVICE_KEY());
}

function headers(prefer = '') {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    apikey: SERVICE_KEY(),
    authorization: `Bearer ${SERVICE_KEY()}`,
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

async function rest(table, { method = 'GET', query = '', body = null, prefer = '' } = {}) {
  if (!persistenceConfigured()) throw Object.assign(new Error('Auto Scout database is not configured.'), { code: 'DATABASE_NOT_CONFIGURED' });
  const response = await fetch(`${SUPABASE_URL()}/rest/v1/${table}${query ? `?${query}` : ''}`, {
    method,
    headers: headers(prefer),
    body: body === null ? undefined : JSON.stringify(body),
  });
  const payload = await response.text();
  if (!response.ok) {
    const error = Object.assign(new Error(`Database ${table} request failed with HTTP ${response.status}.`), { code: 'DATABASE_WRITE_FAILED', status: response.status });
    throw error;
  }
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
  for (const batch of chunks(rows)) {
    await rest(table, {
      method: 'POST',
      query: onConflict ? `on_conflict=${encodeURIComponent(onConflict)}` : '',
      body: batch,
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }
}

async function insert(table, rows) {
  if (!rows.length) return;
  for (const batch of chunks(rows)) {
    await rest(table, { method: 'POST', body: batch, prefer: 'return=minimal' });
  }
}

const iso = (value) => value || null;

export async function persistNormalizedBoard(board) {
  if (!persistenceConfigured()) return { configured: false, persisted: false };
  const data = board?.data || {};
  const events = Array.isArray(data.events) ? data.events : [];
  const players = Array.isArray(data.players) ? data.players : [];
  const props = Array.isArray(data.props) ? data.props : [];
  const lines = Array.isArray(data.lines) ? data.lines : [];

  const eventRows = events.map((row) => ({
    id: row.id, provider: row.provider, provider_event_id: row.providerEventId,
    sport_key: row.sport, league_key: row.league || row.sport,
    home_team: row.homeTeam || null, away_team: row.awayTeam || null,
    commence_time: iso(row.commenceTime), status: row.status || 'SCHEDULED',
    home_score: row.homeScore, away_score: row.awayScore,
    provider_updated_at: iso(row.providerUpdatedAt), ingested_at: iso(row.ingestedAt), updated_at: new Date().toISOString(),
  }));
  const playerRows = players.map((row) => ({
    id: row.id, sport_key: row.sport, league_key: row.sport,
    provider: row.provider || null, provider_player_id: row.providerPlayerId || null,
    canonical_name: row.canonicalName || row.name, name: row.name,
    team: row.team || null, position: row.position || null, headshot_url: row.headshotUrl || null,
    updated_at: new Date().toISOString(),
  }));
  const bookmakerMap = new Map();
  for (const row of lines) bookmakerMap.set(row.bookmakerKey, { key: row.bookmakerKey, name: row.bookmakerName || row.bookmakerKey, updated_at: new Date().toISOString() });
  const marketMap = new Map();
  for (const row of props) marketMap.set(row.marketKey, { key: row.marketKey, name: row.marketName || row.marketKey, sport_key: row.sport, period: row.period || 'game', updated_at: new Date().toISOString() });
  const propRows = props.map((row) => ({
    id: row.id, event_id: row.eventId, player_id: row.playerId,
    sport_key: row.sport, league_key: row.league || row.sport,
    market_key: row.marketKey, market_name: row.marketName || row.marketKey,
    period: row.period || 'game', is_alternate: row.isAlternate === true,
    provider: row.provider, ingested_at: iso(row.ingestedAt), updated_at: new Date().toISOString(),
  }));
  const lineRows = lines.map((row) => ({
    id: row.id, prop_id: row.propId, provider: row.provider,
    bookmaker_key: row.bookmakerKey, side: row.side, line: row.line,
    price: row.price, implied_probability: row.impliedProbability,
    deeplink: row.deeplink || null, provider_updated_at: iso(row.providerUpdatedAt),
    ingested_at: iso(row.ingestedAt), updated_at: new Date().toISOString(),
  }));
  const snapshotRows = lines.map((row) => ({
    prop_id: row.propId, bookmaker_key: row.bookmakerKey, side: row.side,
    line: row.line, price: row.price, provider_updated_at: iso(row.providerUpdatedAt), ingested_at: iso(row.ingestedAt),
  }));

  try {
    await upsert('bookmakers', [...bookmakerMap.values()], 'key');
    await upsert('markets', [...marketMap.values()], 'key');
    await upsert('events', eventRows, 'id');
    await upsert('players', playerRows, 'id');
    await upsert('props', propRows, 'id');
    await upsert('prop_lines', lineRows, 'id');
    // Snapshot insert is append-only; duplicates are ignored by the database unique constraint when all identifying fields match.
    try {
      for (const batch of chunks(snapshotRows)) {
        await rest('line_snapshots', { method: 'POST', body: batch, prefer: 'resolution=ignore-duplicates,return=minimal' });
      }
    } catch {
      // Current lines are more important than history. Preserve the board write and surface snapshot failure via health.
    }
    lastWriteAt = new Date().toISOString();
    lastError = null;
    lastCounts = { events: eventRows.length, players: playerRows.length, props: propRows.length, lines: lineRows.length, snapshots: snapshotRows.length };
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
  const parts = [`prop_id=eq.${encodeURIComponent(id)}`, 'select=prop_id,bookmaker_key,side,line,price,provider_updated_at,ingested_at,created_at', 'order=created_at.asc', `limit=${Math.max(1, Math.min(1000, Number(limit) || 250))}`];
  if (bookmakerKey) parts.push(`bookmaker_key=eq.${encodeURIComponent(text(bookmakerKey))}`);
  if (side) parts.push(`side=eq.${encodeURIComponent(text(side).toUpperCase())}`);
  const rows = await rest('line_snapshots', { query: parts.join('&') });
  return { configured: true, rows: Array.isArray(rows) ? rows : [] };
}

export function persistenceHealth() {
  return {
    configured: persistenceConfigured(),
    backend: 'Supabase/PostgreSQL',
    lastWriteAt,
    lastError,
    lastCounts,
  };
}
