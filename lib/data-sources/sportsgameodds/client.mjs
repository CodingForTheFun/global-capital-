// SportsGameOdds v2 client used only on the server.
//
// The user's paid SportsGameOdds key is never sent to the browser. The preferred
// environment variable follows the official SDK docs:
//   SPORTS_ODDS_API_KEY_HEADER
// Older/internal names remain accepted so deployments can migrate without an
// outage.
//
// This client is intentionally cache-first. The Rookie plan is billed by
// returned objects (events), not markets/books, so broad per-event coverage is
// efficient, but repeated duplicate event fetches are not.
const BASE = 'https://api.sportsgameodds.com/v2';

const text = (value) => String(value ?? '').trim();
const truthy = (value) => ['1','true','yes','on'].includes(text(value).toLowerCase());
const clamp = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
};

const cache = new Map();
const inflight = new Map();
const state = {
  requests: 0,
  cacheHits: 0,
  failures: 0,
  lastOkAt: null,
  lastFailAt: null,
  lastError: null,
  lastNotice: null,
  blockedUntil: 0,
  usage: null,
  usageAt: null,
};

export function sportsGameOddsApiKey() {
  return text(
    process.env.SPORTS_ODDS_API_KEY_HEADER
    || process.env.SPORTSGAMEODDS_API_KEY
    || process.env.SPORTS_GAME_ODDS_API_KEY
  );
}

export function sportsGameOddsConfigured() {
  return Boolean(sportsGameOddsApiKey());
}

function stableParams(params = {}) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : String(value)]);
}

function requestKey(path, params) {
  return path + '?' + stableParams(params).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
}

function timeoutSignal(external, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  timer.unref?.();
  const abort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', abort, { once: true });
  }
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timer);
      external?.removeEventListener?.('abort', abort);
    },
  };
}

function retryAfterMs(response) {
  const raw = text(response?.headers?.get?.('retry-after'));
  if (!raw) return 60_000;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(1_000, seconds * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(1_000, at - Date.now()) : 60_000;
}

function safeErrorCode(status) {
  if (status === 401) return 'SPORTSGAMEODDS_UNAUTHORIZED';
  if (status === 403) return 'SPORTSGAMEODDS_FORBIDDEN';
  if (status === 429) return 'SPORTSGAMEODDS_RATE_LIMITED';
  return 'SPORTSGAMEODDS_HTTP_' + status;
}

function trimCache(max = 160) {
  while (cache.size > max) cache.delete(cache.keys().next().value);
}

export async function sportsGameOddsGet(path, params = {}, {
  ttlSeconds = 180,
  bypassCache = false,
  timeoutMs = 12_000,
  signal = null,
} = {}) {
  if (!sportsGameOddsConfigured()) {
    throw Object.assign(new Error('SportsGameOdds is not configured.'), { code: 'SPORTSGAMEODDS_NOT_CONFIGURED' });
  }
  if (Date.now() < state.blockedUntil && path !== '/account/usage') {
    throw Object.assign(new Error('SportsGameOdds is temporarily rate limited.'), {
      code: 'SPORTSGAMEODDS_RATE_LIMITED',
      retryAt: new Date(state.blockedUntil).toISOString(),
    });
  }

  const key = requestKey(path, params);
  const hit = cache.get(key);
  if (!bypassCache && hit && hit.expiresAt > Date.now()) {
    state.cacheHits += 1;
    return hit.value;
  }
  if (inflight.has(key)) return inflight.get(key);

  const task = (async () => {
    const url = new URL(BASE + path);
    for (const [name, value] of stableParams(params)) url.searchParams.set(name, value);
    const timeout = timeoutSignal(signal, clamp(timeoutMs, 12_000, 2_000, 30_000));
    try {
      state.requests += 1;
      const response = await fetch(url, {
        headers: { accept: 'application/json', 'x-api-key': sportsGameOddsApiKey() },
        signal: timeout.signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) {
        const code = safeErrorCode(response.status);
        if (response.status === 429) state.blockedUntil = Date.now() + retryAfterMs(response);
        state.failures += 1;
        state.lastFailAt = new Date().toISOString();
        state.lastError = code;
        throw Object.assign(new Error('SportsGameOdds request failed.'), { code, status: response.status });
      }

      state.lastOkAt = new Date().toISOString();
      state.lastError = null;
      if (text(payload?.notice)) state.lastNotice = text(payload.notice).slice(0, 500);
      const value = payload || { success: true, data: [] };
      cache.set(key, { value, expiresAt: Date.now() + Math.max(15, Number(ttlSeconds) || 180) * 1000 });
      trimCache();
      return value;
    } catch (error) {
      if (error?.name === 'AbortError' && !error?.code) {
        state.failures += 1;
        state.lastFailAt = new Date().toISOString();
        state.lastError = 'SPORTSGAMEODDS_TIMEOUT';
        throw Object.assign(new Error('SportsGameOdds request timed out.'), { code: 'SPORTSGAMEODDS_TIMEOUT' });
      }
      throw error;
    } finally {
      timeout.clear();
    }
  })().finally(() => inflight.delete(key));

  inflight.set(key, task);
  return task;
}

function numericLimit(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function sportsGameOddsMonthlyUsage(usage = state.usage) {
  const monthly = usage?.rateLimits?.['per-month'] || usage?.rateLimits?.perMonth || {};
  const max = numericLimit(monthly['max-entities'] ?? monthly.maxEntitiesPerInterval ?? monthly.maxEntities);
  const used = numericLimit(monthly['current-entities'] ?? monthly.currentEntities ?? monthly.currentIntervalEntities);
  return {
    max,
    used,
    remaining: max !== null && used !== null ? Math.max(0, max - used) : null,
  };
}

export async function fetchSportsGameOddsUsage({ force = false } = {}) {
  if (!sportsGameOddsConfigured()) return null;
  if (!force && state.usage && Date.now() - Date.parse(state.usageAt || 0) < 15 * 60_000) return state.usage;
  const payload = await sportsGameOddsGet('/account/usage', {}, {
    ttlSeconds: 15 * 60,
    bypassCache: force,
    timeoutMs: 8_000,
  });
  state.usage = payload?.data || null;
  state.usageAt = new Date().toISOString();
  return state.usage;
}

export function sportsGameOddsHealth() {
  return {
    configured: sportsGameOddsConfigured(),
    provider: 'SportsGameOdds',
    apiVersion: 'v2',
    tier: state.usage?.tier || null,
    requests: state.requests,
    cacheHits: state.cacheHits,
    failures: state.failures,
    lastOkAt: state.lastOkAt,
    lastFailAt: state.lastFailAt,
    lastError: state.lastError,
    lastNotice: state.lastNotice,
    blockedUntil: state.blockedUntil > Date.now() ? new Date(state.blockedUntil).toISOString() : null,
    usageAt: state.usageAt,
    monthly: sportsGameOddsMonthlyUsage(),
    rateLimits: state.usage?.rateLimits || null,
    cacheEntries: cache.size,
  };
}

export function sportsGameOddsPaidFallbackEnabled() {
  return sportsGameOddsConfigured() && !truthy(process.env.SPORTSGAMEODDS_DISABLED);
}

export function __resetSportsGameOddsClient() {
  cache.clear();
  inflight.clear();
  Object.assign(state, {
    requests: 0,
    cacheHits: 0,
    failures: 0,
    lastOkAt: null,
    lastFailAt: null,
    lastError: null,
    lastNotice: null,
    blockedUntil: 0,
    usage: null,
    usageAt: null,
  });
}
