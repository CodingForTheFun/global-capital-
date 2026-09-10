const text = (value) => String(value ?? '').trim();
const SUPABASE_URL = () => text(process.env.AUTOSCOUT_SUPABASE_URL || process.env.SUPABASE_URL).replace(/\/$/, '');
const SERVICE_KEY = () => text(process.env.AUTOSCOUT_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
const PUBLIC_KEY = () => text(process.env.AUTOSCOUT_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY);
const INGEST_TOKEN = () => text(process.env.AUTOSCOUT_SUPABASE_INGEST_TOKEN);

let lastWriteAt = null;
let lastError = null;
let lastCounts = { events: 0, players: 0, props: 0, lines: 0, snapshots: 0 };

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
  const response = await fetch(`${SUPABASE_URL()}/rest/v1/${table}${query ? `?${query}` : ''}`, {
    method,
    headers: baseHeaders(SERVICE_KEY(), prefer),
    body: body === null ? undefined : JSON.stringify(body),
  });
  const payload = await response.text();
  if (!response.ok) throw Object.assign(new Error(`Database ${table} request failed with HTTP ${response.status}.`), { code: 'DATABASE_WRITE_FAILED', status: response.status });
  if (!payload) return null;
  try { return JSON.parse(payload); } catch { return null; }
}

async function rpc(name, body) {
  if (!rpcMode()) throw Object.assign(new Error('Auto Scout secure RPC mode is not configured.'), { code: 'DATABASE_NOT_CONFIGURED' });
  const response = await fetch(`${SUPABASE_URL()}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: baseHeaders(PUBLIC_KEY()),
    body: JSON.stringify(body),
  });
  const payload = await response.text();
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

function mapBoard(board) {
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
  const lineRows = lines.map((row) => ({ id: row.id, prop_id: row.propId, provider: row.provider, bookmaker_key: row.bookmakerKey, side: row.side, line: row.line, price: row.price, implied_probability: row.impliedProbability, deeplink: row.deeplink || null, provider_updated_at: iso(row.providerUpdatedAt), ingested_at: iso(row.ingestedAt), updated_at: now }));
  const snapshotRows = lines.map((row) => ({ prop_id: row.propId, bookmaker_key: row.bookmakerKey, side: row.side, line: row.line, price: row.price, provider_updated_at: iso(row.providerUpdatedAt), ingested_at: iso(row.ingestedAt) }));
  return { events: eventRows, players: playerRows, bookmakers: [...bookmakerMap.values()], markets: [...marketMap.values()], props: propRows, lines: lineRows, snapshots: snapshotRows };
}

export async function persistNormalizedBoard(board) {
  if (!persistenceConfigured()) return { configured: false, persisted: false };
  const rows = mapBoard(board);
  try {
    if (rpcMode() && !serviceMode()) {
      const result = await rpc('autoscout_ingest_board', { p_token: INGEST_TOKEN(), p_payload: rows });
      lastCounts = {
        events: Number(result?.events ?? rows.events.length),
        players: Number(result?.players ?? rows.players.length),
        props: Number(result?.props ?? rows.props.length),
        lines: Number(result?.lines ?? rows.lines.length),
        snapshots: Number(result?.snapshots ?? rows.snapshots.length),
      };
    } else {
      await upsert('bookmakers', rows.bookmakers, 'key');
      await upsert('markets', rows.markets, 'key');
      await upsert('events', rows.events, 'id');
      await upsert('players', rows.players, 'id');
      await upsert('props', rows.props, 'id');
      await upsert('prop_lines', rows.lines, 'id');
      try {
        for (const batch of chunks(rows.snapshots)) await rest('line_snapshots', { method: 'POST', body: batch, prefer: 'resolution=ignore-duplicates,return=minimal' });
      } catch {}
      lastCounts = { events: rows.events.length, players: rows.players.length, props: rows.props.length, lines: rows.lines.length, snapshots: rows.snapshots.length };
    }
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

export function persistenceHealth() {
  return {
    configured: persistenceConfigured(),
    backend: 'Supabase/PostgreSQL',
    mode: serviceMode() ? 'service-role' : rpcMode() ? 'secure-rpc' : 'not-configured',
    lastWriteAt,
    lastError,
    lastCounts,
  };
}
