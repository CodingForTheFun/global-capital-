// PropLine HTTP client.
//
// PropLine bills by request against a daily allowance, not a monthly credit
// pool, and it tells you where you stand on every response. The whole point of
// this module is that the allowance is treated as a hard resource: requests are
// counted, cached, de-duplicated in flight, and stopped outright once the
// remaining count reaches zero. Running out at 2pm on a Sunday is worse than
// refreshing a little less often all day.
const text = (value) => String(value ?? '').trim();

export const PROPLINE_BASE = 'https://api.prop-line.com';
const API_KEY = () => text(process.env.PROPLINE_API_KEY);
export function proplineConfigured() { return Boolean(API_KEY()); }

// Mirrors the tier ladder so health can say which one the responses imply
// without the key ever being inspected or logged.
const TIER_BY_LIMIT = Object.freeze({ 1000: 'free', 5000: 'hobby', 25000: 'pro', 250000: 'streaming-lite', 1000000: 'streaming' });

let quota = { limit: null, used: null, remaining: null, resetAt: null, tier: null, at: null };
let lastError = null;
let requests = 0;
let servedFromCache = 0;

const cache = new Map();
const inflight = new Map();

const ttlMs = (seconds) => Math.max(1, Number(seconds) || 0) * 1000;
const clampInt = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
};

export function proplineQuota() { return { ...quota }; }
export function proplineHealth() {
  return {
    id: 'propline',
    configured: proplineConfigured(),
    base: PROPLINE_BASE,
    quota: { ...quota },
    requests,
    servedFromCache,
    lastError,
    cacheEntries: cache.size,
  };
}

// Exported so tests can start from a known state; nothing in the app calls it.
export function __resetProplineClient() {
  quota = { limit: null, used: null, remaining: null, resetAt: null, tier: null, at: null };
  lastError = null; requests = 0; servedFromCache = 0;
  cache.clear(); inflight.clear();
}

function readQuota(headers) {
  const number = (name) => {
    const raw = headers?.get?.(name);
    const n = Number(raw);
    return raw === null || raw === undefined || raw === '' || !Number.isFinite(n) ? null : n;
  };
  const limit = number('x-daily-limit');
  const reset = number('x-daily-reset');
  quota = {
    limit,
    used: number('x-daily-used'),
    remaining: number('x-daily-remaining'),
    // The header is unix seconds; an ISO string is what every other health
    // surface here reports, so convert once rather than at each reader.
    resetAt: reset === null ? null : new Date(reset * 1000).toISOString(),
    tier: limit === null ? null : TIER_BY_LIMIT[limit] || null,
    at: new Date().toISOString(),
  };
}

function cacheKey(path, params) {
  const entries = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '').sort();
  return `${path}?${entries.map(([k, v]) => `${k}=${v}`).join('&')}`;
}

/**
 * One GET against PropLine, with the daily allowance treated as real.
 *
 * `ttlSeconds` is the caller's promise about how stale an answer may be. Odds
 * move constantly but nobody reads them faster than a refresh cycle, and a
 * player's game log does not change at all until the game ends - so the caller
 * picks, and repeated asks inside that window cost nothing.
 */
export async function proplineGet(path, params = {}, { ttlSeconds = 30, timeoutMs = 15_000, fetcher = globalThis.fetch, now = Date.now } = {}) {
  if (!proplineConfigured()) throw Object.assign(new Error('PropLine API key is not configured.'), { code: 'PROPLINE_NOT_CONFIGURED' });

  const key = cacheKey(path, params);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now()) { servedFromCache += 1; return hit.value; }

  // Two callers wanting the same thing at the same moment is one request.
  const pending = inflight.get(key);
  if (pending) { servedFromCache += 1; return pending; }

  // A spent allowance is not an error to retry into - it is a wall. Serving a
  // stale answer beats burning the reset window on requests that all 429.
  if (quota.remaining === 0) {
    if (hit) { servedFromCache += 1; return hit.value; }
    throw Object.assign(new Error('PropLine daily request allowance is spent.'), { code: 'PROPLINE_DAILY_LIMIT', resetAt: quota.resetAt });
  }

  const url = new URL(PROPLINE_BASE + path);
  for (const [name, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(name, String(value));
  }

  const task = (async () => {
    requests += 1;
    let response;
    try {
      response = await fetcher(url, {
        // Header auth, never the query string: a key in a URL ends up in logs,
        // referrers and error messages.
        headers: { accept: 'application/json', 'x-api-key': API_KEY() },
        signal: AbortSignal.timeout(clampInt(timeoutMs, 15_000, 1_000, 60_000)),
      });
    } catch (error) {
      lastError = { code: error?.name === 'TimeoutError' ? 'PROPLINE_TIMEOUT' : 'PROPLINE_UNREACHABLE', at: new Date().toISOString() };
      throw Object.assign(new Error('PropLine request failed.'), lastError);
    }
    readQuota(response.headers);
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const upstreamCode = text(body?.detail?.error).toLowerCase();
      const retryAfter = Number(response.headers.get('retry-after'));
      const code = response.status === 429
        ? (upstreamCode === 'daily_limit_exceeded' || quota.remaining === 0 ? 'PROPLINE_DAILY_LIMIT' : 'PROPLINE_BURST_LIMIT')
        : response.status === 401 || response.status === 403 ? 'PROPLINE_UNAUTHORIZED'
        : `PROPLINE_HTTP_${response.status}`;
      lastError = { code, status: response.status, retryAfter: Number.isFinite(retryAfter) ? retryAfter : null, at: new Date().toISOString() };
      // The body carries upgrade URLs with the account email in them; only the
      // machine-readable error is kept.
      throw Object.assign(new Error('PropLine request failed.'), { code, status: response.status, retryAfter: lastError.retryAfter, detail: upstreamCode || null });
    }
    lastError = null;
    cache.set(key, { value: body, expiresAt: now() + ttlMs(ttlSeconds) });
    return body;
  })().finally(() => inflight.delete(key));

  inflight.set(key, task);
  return task;
}

// One authenticated readiness check per container start. This validates the
// Railway secret and captures the real tier/quota headers without promoting
// PropLine to the customer board or burning event/market requests.
if (proplineConfigured()) {
  const timer = setTimeout(() => {
    void proplineGet('/v1/sports', {}, { ttlSeconds: 600, timeoutMs: 10_000 })
      .then((body) => {
        const sportCount = Array.isArray(body) ? body.length : Array.isArray(body?.sports) ? body.sports.length : 0;
        const health = proplineHealth();
        console.log(`[PropLine verify] authenticated=true sports=${sportCount} tier=${health.quota.tier || 'unknown'} dailyLimit=${health.quota.limit ?? 'unknown'} remaining=${health.quota.remaining ?? 'unknown'}`);
      })
      .catch((error) => {
        console.error(`[PropLine verify] authenticated=false code=${String(error?.code || 'PROPLINE_VERIFY_FAILED')} status=${Number(error?.status) || 0}`);
      });
  }, 750);
  timer.unref?.();
}
