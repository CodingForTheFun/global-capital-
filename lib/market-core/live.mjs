import crypto from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const text = (value) => String(value ?? '').trim();
const norm = (value) => text(value).toLowerCase();
const finite = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const sportLabel = (value) => {
  const raw = norm(value);
  if (!raw) return null;
  if (raw === 'ncaaf' || raw.includes('ncaaf') || raw.includes('college_football')) return 'NCAAF';
  if (raw === 'ncaab' || raw.includes('ncaab') || raw.includes('college_basketball')) return 'NCAAB';
  if (raw === 'wnba' || raw.includes('wnba')) return 'WNBA';
  if (raw === 'nba' || raw.includes('nba')) return 'NBA';
  if (raw === 'mlb' || raw.includes('mlb')) return 'MLB';
  if (raw === 'nhl' || raw.includes('nhl')) return 'NHL';
  if (raw === 'nfl' || raw.includes('nfl')) return 'NFL';
  if (raw === 'tennis' || raw.includes('tennis')) return 'TENNIS';
  if (raw === 'soccer' || raw.includes('soccer')) return 'SOCCER';
  return text(value).toUpperCase();
};

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const STATE_PATH = path.join(DATA_DIR, 'market-core-state.json');
const MAX_EVENTS = 5_000;
const MAX_QUOTES = 20_000;
const MAX_SEEN = 12_000;
const MAX_CLIENTS = 300;
const HEARTBEAT_MS = 15_000;
const PERSIST_DELAY_MS = 500;

let cursor = 0;
let latestAt = null;
let persistedAt = null;
let events = [];
let seen = [];
const quotes = new Map();
const clients = new Set();
let persistTimer = null;

function quoteKey(provider, outcomeId) {
  const id = text(outcomeId);
  return id ? `${norm(provider) || 'unknown'}|${id}` : null;
}

function hashEvent(type, data) {
  const payload = [
    type,
    data?.outcome_id,
    data?.event?.id || data?.event_id,
    data?.bookmaker_key || data?.book_key,
    data?.player_id || data?.player_name,
    data?.market_key,
    data?.outcome_name,
    data?.timestamp || data?.resolved_at || data?.created_at,
    data?.current?.point,
    data?.current?.price_american ?? data?.current?.price,
    data?.resolution,
    data?.steam_score,
  ].map(text).join('|');
  return crypto.createHash('sha1').update(payload).digest('hex');
}

function eventType(type) {
  switch (norm(type)) {
    case 'line_movement': return 'quote.changed';
    case 'market_suspended': return 'market.suspended';
    case 'resolution': return 'market.resolved';
    case 'steam': return 'signal.steam';
    default: return `provider.${norm(type) || 'event'}`;
  }
}

function normalizeEvent(type, data, { provider = 'unknown', providerSequence = null, deliveryId = null, receivedAt = new Date().toISOString() } = {}) {
  const event = data?.event && typeof data.event === 'object' ? data.event : {};
  const previous = data?.previous && typeof data.previous === 'object' ? data.previous : {};
  const current = data?.current && typeof data.current === 'object' ? data.current : {};
  const sourceType = text(type || data?.event_type);
  const providerSeq = finite(providerSequence);
  const eventId = text(event?.id || data?.event_id) || null;
  const outcomeId = text(data?.outcome_id) || null;
  const idempotencyKey = deliveryId == null || text(deliveryId) === ''
    ? `${norm(provider)}:${hashEvent(sourceType, data)}`
    : `${norm(provider)}:delivery:${text(deliveryId)}`;

  return {
    idempotencyKey,
    provider: norm(provider) || 'unknown',
    providerSequence: providerSeq,
    sourceType,
    kind: eventType(sourceType),
    sport: sportLabel(data?.sport || data?.sport_key),
    eventId,
    homeTeam: text(event?.home_team || data?.home_team) || null,
    awayTeam: text(event?.away_team || data?.away_team) || null,
    playerId: text(data?.player_id) || null,
    playerName: text(data?.player_name || data?.subject) || null,
    market: text(data?.market_key || data?.market) || null,
    sportsbook: text(data?.bookmaker_key || data?.book_key || data?.bookmaker?.key) || null,
    outcomeId,
    side: text(data?.outcome_name || data?.side).toUpperCase() || null,
    previous: {
      line: finite(previous?.point),
      price: finite(previous?.price_american ?? previous?.price),
    },
    current: {
      line: finite(current?.point ?? data?.point ?? data?.line),
      price: finite(current?.price_american ?? current?.price ?? data?.price_american ?? data?.price),
    },
    steamScore: finite(data?.steam_score),
    booksMoved: finite(data?.books_moved),
    booksQuoting: finite(data?.books_quoting),
    booksAgreeing: finite(data?.books_agreeing),
    consensusDirection: text(data?.consensus_direction) || null,
    resolution: text(data?.resolution).toLowerCase() || null,
    actualValue: finite(data?.actual_value),
    markets: Array.isArray(data?.markets)
      ? data.markets.slice(0, 50).map((row) => ({
          key: text(row?.key || row?.market_key) || null,
          description: text(row?.description) || null,
        }))
      : [],
    occurredAt: text(data?.timestamp || data?.resolved_at || data?.created_at || receivedAt) || receivedAt,
    receivedAt,
  };
}

function envelopeItems(envelope = {}, provider = 'unknown') {
  const payload = envelope?.payload && typeof envelope.payload === 'object' ? envelope.payload : {};
  const receivedAt = new Date().toISOString();
  if (payload.batch === true && Array.isArray(payload.events)) {
    return payload.events.map((item) => normalizeEvent(
      item?.event_type || payload?.event_type || envelope?.type,
      item?.data && typeof item.data === 'object' ? item.data : {},
      {
        provider,
        providerSequence: item?.seq ?? envelope?.sequence,
        deliveryId: item?.delivery_id ?? null,
        receivedAt: text(item?.created_at) || receivedAt,
      },
    ));
  }
  return [normalizeEvent(envelope?.type || payload?.event_type, payload, {
    provider,
    providerSequence: envelope?.sequence,
    deliveryId: envelope?.deliveryId,
    receivedAt,
  })];
}

function rememberQuote(row) {
  if (row.kind !== 'quote.changed' || !row.outcomeId) return;
  const key = quoteKey(row.provider, row.outcomeId);
  if (!key) return;
  const previous = quotes.get(key) || {};
  quotes.delete(key);
  quotes.set(key, {
    ...previous,
    provider: row.provider,
    sport: row.sport,
    eventId: row.eventId,
    playerId: row.playerId,
    playerName: row.playerName,
    market: row.market,
    sportsbook: row.sportsbook,
    outcomeId: row.outcomeId,
    side: row.side,
    line: row.current.line ?? previous.line ?? null,
    price: row.current.price ?? previous.price ?? null,
    updatedAt: row.occurredAt || row.receivedAt,
    sequence: row.sequence,
  });
  while (quotes.size > MAX_QUOTES) quotes.delete(quotes.keys().next().value);
}

function persistNow() {
  persistTimer = null;
  if (process.env.NODE_ENV === 'test' || process.env.MARKET_CORE_PERSIST === '0') return;
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${STATE_PATH}.${process.pid}.tmp`;
    persistedAt = new Date().toISOString();
    writeFileSync(tmp, JSON.stringify({
      version: 1,
      cursor,
      latestAt,
      persistedAt,
      events: events.slice(0, MAX_EVENTS),
      seen: seen.slice(0, MAX_SEEN),
      quotes: [...quotes.values()].slice(-MAX_QUOTES),
    }), { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, STATE_PATH);
  } catch (error) {
    console.log(`[market-core] persist failed code=${text(error?.code || 'WRITE_FAILED').slice(0, 60)}`);
  }
}

function persistSoon() {
  if (persistTimer || process.env.NODE_ENV === 'test' || process.env.MARKET_CORE_PERSIST === '0') return;
  persistTimer = setTimeout(persistNow, PERSIST_DELAY_MS);
  persistTimer.unref?.();
}

function restore() {
  if (process.env.NODE_ENV === 'test' || process.env.MARKET_CORE_PERSIST === '0') return;
  try {
    const parsed = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    cursor = Number.isFinite(Number(parsed?.cursor)) ? Number(parsed.cursor) : 0;
    latestAt = text(parsed?.latestAt) || null;
    persistedAt = text(parsed?.persistedAt) || null;
    events = Array.isArray(parsed?.events) ? parsed.events.slice(0, MAX_EVENTS) : [];
    seen = Array.isArray(parsed?.seen) ? parsed.seen.slice(0, MAX_SEEN) : [];
    for (const row of Array.isArray(parsed?.quotes) ? parsed.quotes.slice(-MAX_QUOTES) : []) {
      const key = quoteKey(row?.provider, row?.outcomeId);
      if (key) quotes.set(key, row);
    }
  } catch {}
}
restore();

function matches(row, filters = {}) {
  if (filters.sport && text(row?.sport).toUpperCase() !== filters.sport) return false;
  if (filters.eventId && text(row?.eventId) !== filters.eventId) return false;
  if (filters.market && norm(row?.market) !== filters.market) return false;
  if (filters.player) {
    const haystack = `${norm(row?.playerId)} ${norm(row?.playerName)}`;
    if (!haystack.includes(filters.player)) return false;
  }
  return true;
}

function sendSse(res, event, data, id = null) {
  if (id !== null) res.write(`id: ${id}\n`);
  if (event) res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(row) {
  for (const client of [...clients]) {
    if (!matches(row, client.filters)) continue;
    try { sendSse(client.res, 'market', row, row.sequence); }
    catch { clients.delete(client); }
  }
}

export function publishMarketEnvelope(envelope = {}, { provider = 'unknown' } = {}) {
  const seenSet = new Set(seen);
  const accepted = [];
  for (const raw of envelopeItems(envelope, provider)) {
    if (!raw.idempotencyKey || seenSet.has(raw.idempotencyKey)) continue;
    cursor += 1;
    const row = { ...raw, sequence: cursor };
    seen.unshift(raw.idempotencyKey);
    seenSet.add(raw.idempotencyKey);
    events.unshift(row);
    latestAt = row.receivedAt;
    rememberQuote(row);
    accepted.push(row);
  }
  events = events.slice(0, MAX_EVENTS);
  seen = [...new Set(seen)].slice(0, MAX_SEEN);
  if (accepted.length) {
    persistSoon();
    for (const row of accepted) broadcast(row);
  }
  return { accepted: accepted.length, sequence: cursor };
}

function filtersFrom(url) {
  return {
    sport: text(url.searchParams.get('sport')).toUpperCase(),
    eventId: text(url.searchParams.get('eventId')),
    player: norm(url.searchParams.get('player')),
    market: norm(url.searchParams.get('market')),
  };
}

export function marketCoreSnapshot({ sport = '', eventId = '', player = '', market = '', limit = 100 } = {}) {
  const filters = {
    sport: text(sport).toUpperCase(),
    eventId: text(eventId),
    player: norm(player),
    market: norm(market),
  };
  const max = Math.max(1, Math.min(500, Number(limit) || 100));
  return {
    sequence: cursor,
    latestAt,
    quotes: [...quotes.values()].filter((row) => matches(row, filters)).slice(-max),
    events: events.filter((row) => matches(row, filters)).slice(0, max),
  };
}

export function marketCoreHealth() {
  return {
    active: true,
    sequence: cursor,
    latestAt,
    persistedAt,
    events: events.length,
    quotes: quotes.size,
    clients: clients.size,
    maxClients: MAX_CLIENTS,
  };
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

function openStream(req, res, url) {
  if (clients.size >= MAX_CLIENTS) {
    json(res, 503, { ok: false, code: 'STREAM_CAPACITY', message: 'Live market stream is at capacity. Retry shortly.' });
    return true;
  }
  const filters = filtersFrom(url);
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    'x-content-type-options': 'nosniff',
  });
  res.write('retry: 5000\n\n');

  const rawLast = req.headers?.['last-event-id'] || url.searchParams.get('after');
  const last = Number(rawLast);
  const oldest = events.length ? Number(events.at(-1)?.sequence || 0) : cursor;
  if (Number.isFinite(last) && last > 0) {
    if (oldest > last + 1) {
      sendSse(res, 'resync', { reason: 'cursor_too_old', sequence: cursor }, cursor);
    } else {
      const replay = events.filter((row) => row.sequence > last && matches(row, filters)).reverse();
      for (const row of replay) sendSse(res, 'market', row, row.sequence);
    }
  }
  sendSse(res, 'ready', { sequence: cursor, latestAt, quotes: quotes.size }, cursor);

  const client = { res, filters };
  clients.add(client);
  const heartbeat = setInterval(() => {
    try { res.write(`: heartbeat ${Date.now()}\n\n`); }
    catch { clients.delete(client); }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  const close = () => {
    clearInterval(heartbeat);
    clients.delete(client);
  };
  req.once('close', close);
  res.once('close', close);
  return true;
}

export function handleMarketCoreRequest(req, res, url = new URL(req.url || '/', 'http://localhost')) {
  if (req.method !== 'GET') {
    json(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'GET required.' });
    return true;
  }
  if (url.pathname === '/api/market/stream') return openStream(req, res, url);
  if (url.pathname === '/api/market/state') {
    return json(res, 200, { ok: true, ...marketCoreSnapshot({
      sport: url.searchParams.get('sport'),
      eventId: url.searchParams.get('eventId'),
      player: url.searchParams.get('player'),
      market: url.searchParams.get('market'),
      limit: url.searchParams.get('limit'),
    }) });
  }
  if (url.pathname === '/api/market/health') return json(res, 200, { ok: true, ...marketCoreHealth() });
  json(res, 404, { ok: false, code: 'NOT_FOUND', message: 'Unknown market-core route.' });
  return true;
}

export function __resetMarketCoreForTests() {
  cursor = 0;
  latestAt = null;
  persistedAt = null;
  events = [];
  seen = [];
  quotes.clear();
  for (const client of clients) {
    try { client.res.end(); } catch {}
  }
  clients.clear();
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
}
