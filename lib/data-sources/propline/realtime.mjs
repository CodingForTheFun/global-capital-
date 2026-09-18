import crypto from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import path from 'node:path';
import { WEBHOOK_PATH } from './webhook-route.mjs';
import { DEFAULT_PLAYER_PROP_MARKETS, SPORT_KEYS, sportFromProplineKey } from './markets.mjs';

const BASE = 'https://api.prop-line.com';
const text = (value) => String(value ?? '').trim();
const API_KEY = () => text(process.env.PROPLINE_API_KEY);
const MASTER_KEY = () => text(process.env.AUTOPROP_MASTER_KEY);
const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const STATE_PATH = path.join(DATA_DIR, 'propline-realtime.json');
const MAX_EVENTS = 1500;
const MAX_SEEN = 3000;
// The live feed keeps a larger working set in memory, but restart recovery does
// not need to duplicate that entire stream on the small Railway data volume.
// Persist only the recent tail plus the durable subscription/sequence metadata.
const PERSIST_EVENTS = 96;
const PERSIST_SEEN = 512;
const EMERGENCY_EVENTS = 16;
const EMERGENCY_SEEN = 64;
const SUBSCRIPTION_EVENTS = Object.freeze(['line_movement', 'resolution', 'market_suspended', 'steam']);

const sportsWithProps = Object.entries(DEFAULT_PLAYER_PROP_MARKETS)
  .filter(([, markets]) => Array.isArray(markets) && markets.length)
  .map(([sport]) => SPORT_KEYS[sport])
  .filter(Boolean);
const playerMarkets = [...new Set(Object.values(DEFAULT_PLAYER_PROP_MARKETS).flat())].filter(Boolean);

let state = {
  version: 2,
  subscription: { id: null, url: null, active: false, createdAt: null, checkedAt: null },
  secretCipher: null,
  lastSequence: 0,
  lastEventAt: null,
  lastReplayAt: null,
  lastResyncAt: null,
  lastError: null,
  events: [],
  seen: [],
};
let liveSecret = null;
let persistSuccessLogs = 0;

function secretKey() {
  const raw = MASTER_KEY();
  return raw ? crypto.createHash('sha256').update(raw).digest() : null;
}
function encryptSecret(secret) {
  const key = secretKey();
  if (!key || !secret) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64') };
}
function decryptSecret(record) {
  const key = secretKey();
  if (!key || !record?.iv || !record?.tag || !record?.data) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(record.data, 'base64')), decipher.final()]).toString('utf8');
  } catch { return null; }
}
function installSecret(secret) {
  liveSecret = text(secret) || null;
  if (liveSecret) process.env.PROPLINE_WEBHOOK_SECRET = liveSecret;
}

function restoreState() {
  try {
    const parsed = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return;
    state = {
      ...state,
      ...parsed,
      subscription: { ...state.subscription, ...(parsed.subscription || {}) },
      secretCipher: parsed.secretCipher || null,
      events: Array.isArray(parsed.events) ? parsed.events.slice(0, MAX_EVENTS) : [],
      seen: Array.isArray(parsed.seen) ? parsed.seen.slice(0, MAX_SEEN) : [],
    };
    installSecret(decryptSecret(state.secretCipher));
    console.log(`[PropLine realtime] restored sequence=${Number(state.lastSequence)||0} events=${state.events.length} seen=${state.seen.length} subscriptionActive=${state.subscription?.active===true}`);
  } catch {}
}
restoreState();

function persistedState({ emergency = false } = {}) {
  return {
    ...state,
    events: state.events.slice(0, emergency ? EMERGENCY_EVENTS : PERSIST_EVENTS),
    seen: state.seen.slice(0, emergency ? EMERGENCY_SEEN : PERSIST_SEEN),
  };
}

function persistState() {
  const temp = `${STATE_PATH}.${process.pid}.tmp`;
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(temp, JSON.stringify(persistedState()), { encoding: 'utf8', mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, STATE_PATH);
    chmodSync(STATE_PATH, 0o600);
    persistSuccessLogs += 1;
    if (persistSuccessLogs <= 3) {
      console.log(`[PropLine realtime] state persist ok cycle=${persistSuccessLogs} sequence=${Number(state.lastSequence)||0} events=${Math.min(state.events.length,PERSIST_EVENTS)} seen=${Math.min(state.seen.length,PERSIST_SEEN)}`);
    }
  } catch (error) {
    const code = text(error?.code || 'WRITE_FAILED').slice(0, 60);
    try { rmSync(temp, { force: true }); } catch {}
    if (code === 'ENOSPC') {
      // Atomic replacement needs enough free space for both the old and new
      // file. When the volume is already full, truncate the same known state
      // file to a tiny recovery snapshot instead of deleting unrelated data.
      try {
        writeFileSync(STATE_PATH, JSON.stringify(persistedState({ emergency: true })), { encoding: 'utf8', mode: 0o600 });
        chmodSync(STATE_PATH, 0o600);
        console.log('[PropLine realtime] state compacted after ENOSPC');
        return;
      } catch (fallbackError) {
        console.log(`[PropLine realtime] state persist failed code=${text(fallbackError?.code || code).slice(0, 60)}`);
        return;
      }
    }
    console.log(`[PropLine realtime] state persist failed code=${code}`);
  }
}

function publicOrigin() {
  const raw = text(process.env.PUBLIC_SITE_ORIGIN || 'https://www.obligeprops.com');
  try { return new URL(raw).origin; } catch { return 'https://www.obligeprops.com'; }
}
function webhookUrl() { return new URL(WEBHOOK_PATH, publicOrigin()).href; }

async function api(pathname, { method = 'GET', body = null, timeoutMs = 15_000 } = {}) {
  if (!API_KEY()) throw Object.assign(new Error('PropLine API key is not configured.'), { code: 'PROPLINE_NOT_CONFIGURED' });
  const headers = { accept: 'application/json', 'x-api-key': API_KEY() };
  if (body !== null) headers['content-type'] = 'application/json';
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: body === null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const validationFields = Array.isArray(payload?.detail)
      ? [...new Set(payload.detail.map((item) => {
          const loc = Array.isArray(item?.loc) ? item.loc : [];
          return text(loc.at(-1));
        }).filter(Boolean))].slice(0, 8)
      : [];
    const providerDetail = [
      typeof payload?.detail === 'string' ? payload.detail : '',
      payload?.detail?.error,
      payload?.error,
      payload?.message,
      payload?.code,
      ...(Array.isArray(payload?.detail) ? payload.detail.slice(0, 8).map((item) => item?.msg || item?.type) : []),
    ].map(text).filter(Boolean).join(' | ').slice(0, 500);
    const capacity = /(?:webhook|subscription).{0,48}(?:limit|max|capacity)|(?:limit|max|capacity).{0,48}(?:webhook|subscription)/i.test(providerDetail);
    throw Object.assign(new Error('PropLine webhook management request failed.'), {
      code: `PROPLINE_WEBHOOK_HTTP_${response.status}`,
      status: response.status,
      retryAfter: response.headers.get('retry-after') || null,
      validationFields,
      capacity,
    });
  }
  return payload;
}

function listFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.webhooks)) return payload.webhooks;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function eventKey(type, data, deliveryId = null) {
  if (deliveryId !== null && deliveryId !== undefined && String(deliveryId) !== '') return `delivery:${deliveryId}`;
  const raw = [
    type, data?.outcome_id, data?.bookmaker_key || data?.book_key,
    data?.event?.id || data?.event_id, data?.player_id || data?.player_name,
    data?.market_key, data?.outcome_name, data?.timestamp || data?.resolved_at || data?.created_at,
    data?.current?.price_american, data?.current?.point, data?.resolution, data?.steam_score,
  ].map((v) => text(v)).join('|');
  return `hash:${crypto.createHash('sha1').update(raw).digest('hex')}`;
}

function lastPriceLeg(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    name: text(row.name || row.outcome_name) || null,
    price: Number.isFinite(Number(row.price_american ?? row.price)) ? Number(row.price_american ?? row.price) : null,
    point: Number.isFinite(Number(row.point)) ? Number(row.point) : null,
  };
}

function sanitizeEvent(type, data, { deliveryId = null, sequence = null, receivedAt = new Date().toISOString() } = {}) {
  const sportKey = text(data?.sport_key).toLowerCase();
  const event = data?.event && typeof data.event === 'object' ? data.event : {};
  const previous = data?.previous && typeof data.previous === 'object' ? data.previous : {};
  const current = data?.current && typeof data.current === 'object' ? data.current : {};
  const markets = Array.isArray(data?.markets) ? data.markets.slice(0, 50).map((row) => ({
    key: text(row?.key) || null,
    description: text(row?.description) || null,
    period: row?.period ?? null,
    lastSeen: row?.last_seen || null,
    lastPrice: Array.isArray(row?.last_price) ? row.last_price.slice(0, 8).map(lastPriceLeg).filter(Boolean) : [],
  })) : [];
  const books = Array.isArray(data?.books) ? data.books.slice(0, 30).map((row) => typeof row === 'string' ? row : text(row?.key || row?.title)).filter(Boolean) : [];
  return {
    id: eventKey(type, data, deliveryId),
    deliveryId: deliveryId == null ? null : String(deliveryId),
    sequence: Number.isFinite(Number(sequence)) ? Number(sequence) : null,
    type: text(type || data?.event_type),
    sport: sportFromProplineKey(sportKey) || sportKey.toUpperCase() || null,
    sportKey: sportKey || null,
    eventId: text(event?.id || data?.event_id) || null,
    homeTeam: text(event?.home_team || data?.home_team) || null,
    awayTeam: text(event?.away_team || data?.away_team) || null,
    bookmakerKey: text(data?.bookmaker_key || data?.book_key || data?.bookmaker?.key) || null,
    bookmakerTitle: text(data?.bookmaker_title || data?.bookmaker?.title) || null,
    playerName: text(data?.player_name || data?.subject) || null,
    playerId: text(data?.player_id) || null,
    marketKey: text(data?.market_key) || null,
    marketDescription: text(data?.market_description) || null,
    outcomeId: text(data?.outcome_id) || null,
    bookOutcomeId: text(data?.book_outcome_id) || null,
    outcomeName: text(data?.outcome_name) || null,
    dfsOddsType: text(data?.dfs_odds_type).toLowerCase() || null,
    payoutMultiplier: Number.isFinite(Number(data?.payout_multiplier)) ? Number(data.payout_multiplier) : null,
    previous: {
      price: Number.isFinite(Number(previous?.price_american ?? previous?.price)) ? Number(previous.price_american ?? previous.price) : null,
      point: Number.isFinite(Number(previous?.point)) ? Number(previous.point) : null,
    },
    current: {
      price: Number.isFinite(Number(current?.price_american ?? current?.price)) ? Number(current.price_american ?? current.price) : null,
      point: Number.isFinite(Number(current?.point)) ? Number(current.point) : null,
    },
    priceChangePct: Number.isFinite(Number(data?.price_change_pct)) ? Number(data.price_change_pct) : null,
    avgProbShift: Number.isFinite(Number(data?.avg_prob_shift)) ? Number(data.avg_prob_shift) : null,
    consensusPointShift: Number.isFinite(Number(data?.consensus_point_shift)) ? Number(data.consensus_point_shift) : null,
    resolution: text(data?.resolution).toLowerCase() || null,
    actualValue: Number.isFinite(Number(data?.actual_value)) ? Number(data.actual_value) : null,
    steamScore: Number.isFinite(Number(data?.steam_score)) ? Number(data.steam_score) : null,
    consensusDirection: text(data?.consensus_direction) || null,
    booksMoved: Number.isFinite(Number(data?.books_moved)) ? Number(data.books_moved) : null,
    booksQuoting: Number.isFinite(Number(data?.books_quoting)) ? Number(data.books_quoting) : null,
    booksAgreeing: Number.isFinite(Number(data?.books_agreeing)) ? Number(data.books_agreeing) : null,
    books,
    reason: text(data?.reason) || null,
    markets,
    occurredAt: data?.timestamp || data?.resolved_at || data?.created_at || receivedAt,
    receivedAt,
  };
}

function remember(row) {
  if (!row?.id) return false;
  const seen = new Set(state.seen);
  if (seen.has(row.id)) return false;
  state.events.unshift(row);
  state.events = state.events.slice(0, MAX_EVENTS);
  state.seen.unshift(row.id);
  state.seen = [...new Set(state.seen)].slice(0, MAX_SEEN);
  state.lastEventAt = row.receivedAt;
  return true;
}

export async function handleProplineRealtimeEvent({ type, payload, sequence, deliveryId = null } = {}) {
  const receivedAt = new Date().toISOString();
  let accepted = 0;
  if (payload?.batch === true && Array.isArray(payload?.events)) {
    for (const item of payload.events) {
      const row = sanitizeEvent(payload.event_type || type, item?.data || {}, {
        deliveryId: item?.delivery_id ?? null,
        sequence,
        receivedAt,
      });
      if (remember(row)) accepted += 1;
    }
  } else {
    const row = sanitizeEvent(type || payload?.event_type, payload || {}, { deliveryId, sequence, receivedAt });
    if (remember(row)) accepted += 1;
  }
  const seq = Number(sequence);
  if (Number.isFinite(seq)) state.lastSequence = Math.max(Number(state.lastSequence) || 0, seq);
  if (accepted || Number.isFinite(seq)) persistState();
  return { accepted };
}

async function replayMissing(subscriptionId) {
  let cursor = Number(state.lastSequence) || 0;
  if (!subscriptionId) return { replayed: 0, truncated: false, latestSequence: cursor };
  let replayed = 0;
  let truncated = false;
  let latestSequence = cursor;
  for (let pageNo = 0; pageNo < 10; pageNo += 1) {
    const page = await api(`/v1/webhooks/${encodeURIComponent(subscriptionId)}/replay?since_seq=${encodeURIComponent(cursor)}&limit=500`);
    truncated ||= page?.truncated === true;
    latestSequence = Number.isFinite(Number(page?.latest_seq)) ? Number(page.latest_seq) : latestSequence;
    for (const item of Array.isArray(page?.events) ? page.events : []) {
      const row = sanitizeEvent(item?.event_type, item?.data || {}, {
        deliveryId: item?.delivery_id ?? null,
        sequence: item?.seq,
        receivedAt: item?.created_at || new Date().toISOString(),
      });
      if (remember(row)) replayed += 1;
      if (Number.isFinite(Number(item?.seq))) state.lastSequence = Math.max(Number(state.lastSequence) || 0, Number(item.seq));
    }
    const next = Number(page?.next_seq);
    if (Number.isFinite(next)) cursor = next;
    if (!page?.has_more) break;
  }
  state.lastReplayAt = new Date().toISOString();
  if (truncated) {
    state.lastError = 'PROPLINE_REPLAY_TRUNCATED';
    state.lastResyncAt = new Date().toISOString();
  } else if (state.lastError === 'PROPLINE_REPLAY_TRUNCATED') {
    state.lastError = null;
  }
  persistState();
  return { replayed, truncated, latestSequence };
}

function createBody({ includeMarketFilter = true } = {}) {
  const body = {
    url: webhookUrl(),
    events: [...SUBSCRIPTION_EVENTS],
    filter_sport_key: sportsWithProps.join(','),
    min_price_change_pct: 0.5,
    min_steam_score: 50,
    min_books_agreeing: 2,
    format: 'json',
    batch_max: 100,
  };
  if (includeMarketFilter) body.filter_market_key = playerMarkets.join(',');
  return body;
}

async function writeSubscription(pathname, method, extra = null) {
  const merge = (base) => extra ? { ...base, ...extra } : base;
  try {
    return await api(pathname, { method, body: merge(createBody()) });
  } catch (error) {
    if (error?.status !== 422 || error?.capacity === true) throw error;
    const fields = Array.isArray(error?.validationFields) && error.validationFields.length
      ? error.validationFields.join(',')
      : 'unspecified';
    console.log(`[PropLine realtime] webhook validation fallback fields=${fields.slice(0, 120)}`);
    return api(pathname, { method, body: merge(createBody({ includeMarketFilter: false })) });
  }
}

function hasSecret() { return Boolean(liveSecret); }
function saveSecret(secret) {
  const encrypted = encryptSecret(secret);
  if (!encrypted) throw Object.assign(new Error('AUTOPROP_MASTER_KEY is required for secure webhook setup.'), { code: 'PROPLINE_WEBHOOK_SECRET_STORE_UNAVAILABLE' });
  state.secretCipher = encrypted;
  installSecret(secret);
}

export async function ensureProplineRealtimeSubscription() {
  if (!API_KEY()) return { configured: false, reason: 'PROPLINE_NOT_CONFIGURED' };
  if (!MASTER_KEY()) return { configured: false, reason: 'PROPLINE_MASTER_KEY_NOT_CONFIGURED' };
  const desiredUrl = webhookUrl();
  try {
    const list = listFrom(await api('/v1/webhooks'));
    let current = state.subscription?.id == null ? null : list.find((row) => String(row?.id) === String(state.subscription.id));

    if (!current && hasSecret()) current = list.find((row) => text(row?.url) === desiredUrl) || null;

    if (!current || !hasSecret()) {
      const stale = list.filter((row) => text(row?.url) === desiredUrl);
      for (const row of stale) {
        try { await api(`/v1/webhooks/${encodeURIComponent(row.id)}`, { method: 'DELETE' }); } catch {}
      }
      const created = await writeSubscription('/v1/webhooks', 'POST');
      const secret = text(created?.secret);
      if (!created?.id || !secret) throw Object.assign(new Error('PropLine did not return a webhook secret.'), { code: 'PROPLINE_WEBHOOK_SECRET_MISSING' });
      saveSecret(secret);
      state.subscription = {
        id: created.id,
        url: desiredUrl,
        active: created.active !== false,
        createdAt: new Date().toISOString(),
        checkedAt: new Date().toISOString(),
      };
      state.lastSequence = 0;
      state.lastError = null;
      persistState();
      current = created;
    } else {
      installSecret(liveSecret);
      const needsPatch = text(current?.url) !== desiredUrl || current?.active === false;
      if (needsPatch) {
        current = await writeSubscription(
          `/v1/webhooks/${encodeURIComponent(current.id)}`,
          'PATCH',
          { active: true },
        );
      }
      state.subscription = {
        ...state.subscription,
        id: current.id,
        url: desiredUrl,
        active: current.active !== false,
        checkedAt: new Date().toISOString(),
      };
      state.lastError = null;
      persistState();
    }

    const replay = await replayMissing(state.subscription.id).catch((error) => {
      state.lastError = text(error?.code || 'PROPLINE_REPLAY_FAILED');
      persistState();
      return { replayed: 0, truncated: false, latestSequence: state.lastSequence };
    });
    console.log(`[PropLine realtime] ready active=${Boolean(state.subscription.active)} replayed=${replay.replayed} truncated=${Boolean(replay.truncated)}`);
    return { configured: true, id: state.subscription.id, active: state.subscription.active, replay };
  } catch (error) {
    state.lastError = text(error?.code || error?.name || 'PROPLINE_WEBHOOK_SETUP_FAILED');
    state.subscription.checkedAt = new Date().toISOString();
    persistState();
    console.log(`[PropLine realtime] subscription setup failed code=${state.lastError.slice(0, 80)}`);
    return { configured: false, reason: state.lastError };
  }
}

export function startProplineRealtime() {
  const kick = () => { void ensureProplineRealtimeSubscription().catch(() => {}); };
  const first = setTimeout(kick, 1_500);
  first.unref?.();
  const timer = setInterval(kick, 15 * 60_000);
  timer.unref?.();
  return timer;
}

function includesText(value, needle) { return !needle || text(value).toLowerCase().includes(needle); }

export function proplineRealtimeSnapshot(filters = {}) {
  const sport = text(filters.sport).toUpperCase();
  const type = text(filters.type).toLowerCase();
  const player = text(filters.player).toLowerCase();
  const market = text(filters.market).toLowerCase();
  const eventId = text(filters.eventId);
  const limit = Math.min(300, Math.max(1, Number(filters.limit) || 120));
  const rows = state.events.filter((row) => {
    if (sport && text(row.sport).toUpperCase() !== sport) return false;
    if (type && text(row.type).toLowerCase() !== type) return false;
    if (player && !includesText(row.playerName, player)) return false;
    if (market && !includesText(`${row.marketKey || ''} ${row.marketDescription || ''}`, market)) return false;
    if (eventId && text(row.eventId) !== eventId) return false;
    return true;
  }).slice(0, limit);

  const cutoff = Date.now() - 15 * 60_000;
  const recent = state.events.filter((row) => (Date.parse(row.occurredAt || row.receivedAt || '') || 0) >= cutoff);
  const count = (kind) => recent.filter((row) => row.type === kind).length;
  const playerScores = new Map();
  for (const row of recent) {
    if (!row.playerName) continue;
    const key = `${row.sport}|${row.playerName}`;
    const weight = row.type === 'steam' ? 5 : row.type === 'market_suspended' ? 4 : row.type === 'line_movement' ? 2 : 1;
    const item = playerScores.get(key) || { sport: row.sport, playerName: row.playerName, signals: 0, score: 0, latestAt: row.occurredAt };
    item.signals += 1;
    item.score += weight + Math.max(0, Number(row.steamScore || 0) / 20);
    if ((Date.parse(row.occurredAt || '') || 0) > (Date.parse(item.latestAt || '') || 0)) item.latestAt = row.occurredAt;
    playerScores.set(key, item);
  }

  return {
    events: rows,
    summary: {
      windowMinutes: 15,
      lineMovements: count('line_movement'),
      steam: count('steam'),
      marketSuspensions: count('market_suspended'),
      resolutions: count('resolution'),
    },
    trendingPlayers: [...playerScores.values()].sort((a, b) => b.score - a.score || b.signals - a.signals).slice(0, 12),
    meta: {
      connected: Boolean(state.subscription?.active && hasSecret()),
      subscriptionId: state.subscription?.id || null,
      lastSequence: Number(state.lastSequence) || 0,
      lastEventAt: state.lastEventAt,
      lastReplayAt: state.lastReplayAt,
      lastResyncAt: state.lastResyncAt,
      retainedEvents: state.events.length,
      lastError: state.lastError,
    },
  };
}

export function proplineRealtimeHealth() {
  const snapshot = proplineRealtimeSnapshot({ limit: 1 });
  return {
    configured: Boolean(API_KEY() && MASTER_KEY()),
    connected: snapshot.meta.connected,
    subscriptionId: snapshot.meta.subscriptionId,
    lastSequence: snapshot.meta.lastSequence,
    lastEventAt: snapshot.meta.lastEventAt,
    retainedEvents: snapshot.meta.retainedEvents,
    lastError: snapshot.meta.lastError,
  };
}

export function __resetProplineRealtimeForTests() {
  state.subscription = { id: null, url: null, active: false, createdAt: null, checkedAt: null };
  state.secretCipher = null;
  state.events = [];
  state.seen = [];
  state.lastSequence = 0;
  state.lastEventAt = null;
  state.lastReplayAt = null;
  state.lastResyncAt = null;
  state.lastError = null;
  liveSecret = null;
}
