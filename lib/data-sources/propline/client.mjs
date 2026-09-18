// PropLine HTTP client.
//
// PropLine bills by request against a daily allowance, not a monthly credit
// pool, and it tells you where you stand on every response. The whole point of
// this module is that the allowance is treated as a hard resource: requests are
// counted, cached, de-duplicated in flight, and stopped before the protected
// daily reserve is spent. Running out at 2pm on a Sunday is worse than
// refreshing a little less often all day.
const text = (value) => String(value ?? '').trim();

export const PROPLINE_BASE = 'https://api.prop-line.com';
const API_KEY = () => text(process.env.PROPLINE_API_KEY);
export function proplineConfigured() { return Boolean(API_KEY()); }

// Mirrors the tier ladder so health can say which one the responses imply
// without the key ever being inspected or logged.
const TIER_BY_LIMIT = Object.freeze({ 1000: 'free', 5000: 'hobby', 25000: 'pro', 250000: 'streaming-lite', 1000000: 'streaming' });

let quota = { limit: null, used: null, remaining: null, resetAt: null, tier: null, at: null };
// Shared by every endpoint in this process; cache bypass is not rate-limit bypass.
let rateLimit = null;
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
export function proplineReserve() {
  const limit = Number(quota.limit);
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  const percent = clampInt(process.env.PROPLINE_RESERVE_PERCENT, 10, 0, 50);
  return percent <= 0 ? 0 : Math.max(1, Math.ceil(limit * percent / 100));
}
export function proplineHealth() {
  return {
    id: 'propline',
    configured: proplineConfigured(),
    base: PROPLINE_BASE,
    quota: { ...quota },
    reserve: proplineReserve(),
    requests,
    servedFromCache,
    lastError,
    cacheEntries: cache.size,
  };
}

// Exported so tests can start from a known state; nothing in the app calls it.
export function __resetProplineClient() {
  quota = { limit: null, used: null, remaining: null, resetAt: null, tier: null, at: null };
  rateLimit = null; lastError = null; requests = 0; servedFromCache = 0;
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

export function proplineNoteQuota(headers) {
  const names = ['x-daily-limit', 'x-daily-used', 'x-daily-remaining', 'x-daily-reset'];
  if (names.some((name) => headers?.get?.(name) !== null && headers?.get?.(name) !== undefined)) readQuota(headers);
  return proplineQuota();
}

function refreshQuotaWindow(now = Date.now) {
  const reset = Date.parse(quota.resetAt || '');
  if (!Number.isFinite(reset) || reset > now()) return;
  quota = { ...quota, used: null, remaining: null, resetAt: null, at: new Date(now()).toISOString() };
  if (lastError?.code === 'PROPLINE_DAILY_LIMIT' || lastError?.code === 'PROPLINE_QUOTA_RESERVE') lastError = null;
}

function cacheKey(path, params) {
  const entries = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '').sort();
  return `${path}?${entries.map(([k, v]) => `${k}=${v}`).join('&')}`;
}

function retryAfterMs(headers, now = Date.now) {
  const raw = text(headers?.get?.('retry-after'));
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - now()) : null;
}

function classifyError(response, body) {
  const detail = text(body?.detail?.error || body?.error || body?.code).toLowerCase();
  if (response.status === 429) {
    if (detail === 'daily_limit_exceeded' || quota.remaining === 0) return 'PROPLINE_DAILY_LIMIT';
    if (detail === 'burst_limit_exceeded') return 'PROPLINE_BURST_LIMIT';
    return 'PROPLINE_RATE_LIMITED';
  }
  if (response.status === 401 || response.status === 403) return 'PROPLINE_UNAUTHORIZED';
  return `PROPLINE_HTTP_${response.status}`;
}

function requestSignal(timeoutMs, signal) {
  const timeout = AbortSignal.timeout(clampInt(timeoutMs, 15_000, 1_000, 60_000));
  if (!signal) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout]);
  return timeout;
}

/**
 * One GET against PropLine, with the daily allowance treated as real.
 *
 * `ttlSeconds` is the caller's promise about how stale an answer may be. Odds
 * move constantly but nobody reads them faster than a refresh cycle, and a
 * player's game log does not change at all until the game ends - so the caller
 * picks, and repeated asks inside that window cost nothing.
 */
export async function proplineGet(path, params = {}, {
  ttlSeconds = 30,
  timeoutMs = 15_000,
  fetcher = globalThis.fetch,
  now = Date.now,
  signal = null,
  bypassCache = false,
} = {}) {
  if (!proplineConfigured()) throw Object.assign(new Error('PropLine API key is not configured.'), { code: 'PROPLINE_NOT_CONFIGURED' });

  const key = cacheKey(path, params);
  const hit = cache.get(key);
  if (!bypassCache && hit && hit.expiresAt > now()) { servedFromCache += 1; return hit.value; }

  // Two callers wanting the same thing at the same moment is one request.
  const pending = inflight.get(key);
  if (pending) { servedFromCache += 1; return pending; }

  // Quota headers describe a reset window. Once that reset has passed, clear
  // the stale counters so one fresh request can establish the new allowance.
  refreshQuotaWindow(now);

  // Retry-After applies to the key, not just the endpoint that returned 429.
  // Do not sleep, retry recursively, or start another scheduler: the next
  // normal caller may try once this deadline passes. Already-running requests
  // can finish, but neither their success nor a shorter 429 clears this gate.
  if (rateLimit) {
    const retryMs = Math.ceil(rateLimit.until - now());
    if (retryMs > 0) {
      if (hit) { servedFromCache += 1; return hit.value; }
      throw Object.assign(new Error('PropLine requests are cooling down.'), {
        code: rateLimit.code, status: 429, retryMs, resetAt: quota.resetAt,
      });
    }
    rateLimit = null;
  }

  // A spent allowance is not an error to retry into - it is a wall. Serving a
  // stale answer beats burning the reset window on requests that all 429.
  if (quota.remaining === 0) {
    if (hit) { servedFromCache += 1; return hit.value; }
    throw Object.assign(new Error('PropLine daily request allowance is spent.'), { code: 'PROPLINE_DAILY_LIMIT', resetAt: quota.resetAt });
  }

  // Protect a percentage of the daily allowance at the shared client layer,
  // not merely inside one scheduler. Every caller using proplineGet() now
  // stops before the reserve is spent, even if traffic or another code path
  // grows unexpectedly.
  const remaining = quota.remaining === null || quota.remaining === undefined ? null : Number(quota.remaining);
  const reserve = proplineReserve();
  if (reserve > 0 && Number.isFinite(remaining) && remaining <= reserve) {
    if (hit) { servedFromCache += 1; return hit.value; }
    lastError = { code: 'PROPLINE_QUOTA_RESERVE', reserve, resetAt: quota.resetAt, at: new Date().toISOString() };
    throw Object.assign(new Error('PropLine daily reserve is protected.'), lastError);
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
        signal: requestSignal(timeoutMs, signal),
      });
    } catch (error) {
      const code = error?.name === 'TimeoutError' ? 'PROPLINE_TIMEOUT'
        : error?.name === 'AbortError' ? 'PROPLINE_ABORTED'
        : 'PROPLINE_UNREACHABLE';
      lastError = { code, at: new Date().toISOString() };
      throw Object.assign(new Error('PropLine request failed.'), lastError);
    }
    readQuota(response.headers);
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const code = classifyError(response, body);
      const retryMs = retryAfterMs(response.headers, now);
      lastError = { code, status: response.status, retryMs, at: new Date().toISOString() };
      if (response.status === 429) {
        // The documented header is authoritative, including zero. A malformed
        // or absent header gets a bounded fallback, not an immediate retry loop.
        const until = now() + (retryMs ?? 1000);
        if (!rateLimit || until > rateLimit.until) rateLimit = { until, code };
      }
      // For rate limiting, a previously good stale answer is safer than either
      // retrying immediately or blanking the customer board.
      if (response.status === 429 && hit) {
        servedFromCache += 1;
        return hit.value;
      }
      // The body may carry account-specific links. Keep only the stable error
      // identifier needed for diagnostics; never retain the API key or URL.
      throw Object.assign(new Error('PropLine request failed.'), {
        code,
        status: response.status,
        retryMs,
        resetAt: quota.resetAt,
        detail: text(body?.detail?.error || body?.error) || null,
      });
    }
    if (!rateLimit || rateLimit.until <= now()) lastError = null;
    cache.set(key, { value: body, expiresAt: now() + ttlMs(ttlSeconds) });
    // Bound an always-on process even if upstream adds unbounded event ids.
    while (cache.size > 2000) cache.delete(cache.keys().next().value);
    return body;
  })().finally(() => inflight.delete(key));

  inflight.set(key, task);
  return task;
}

// One authenticated readiness check per container start. This validates the
// Railway secret and captures the real tier/quota headers without promoting
// PropLine to the customer board or burning event/market requests. The cached
// /v1/sports response is also reused by the supplement's first quota probe.
if (proplineConfigured()) {
  const timer = setTimeout(() => {
    void proplineGet('/v1/sports', {}, { ttlSeconds: 3600, timeoutMs: 10_000 })
      .then((body) => {
        const sportCount = Array.isArray(body) ? body.length : Array.isArray(body?.sports) ? body.sports.length : 0;
        const health = proplineHealth();
        console.log(`[PropLine verify] authenticated=true sports=${sportCount} tier=${health.quota.tier || 'unknown'} dailyLimit=${health.quota.limit ?? 'unknown'} remaining=${health.quota.remaining ?? 'unknown'} reserve=${health.reserve ?? 'unknown'}`);
      })
      .catch((error) => {
        console.error(`[PropLine verify] authenticated=false code=${String(error?.code || 'PROPLINE_VERIFY_FAILED')} status=${Number(error?.status) || 0}`);
      });
  }, 750);
  timer.unref?.();
}
