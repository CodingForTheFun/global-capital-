// SportsDataIO HTTP client: auth, caching, rate limiting and error states.
//
// Secret handling, enforced here so no caller can get it wrong:
//   - The key is read from process.env at call time and never stored on an
//     object, never passed through a URL, never logged, never returned.
//   - Errors carry a status code and a short reason, never a response body and
//     never anything derived from the key.
//
// Failure policy: this client does not throw for HTTP errors. It returns a
// result object, so one failing feed can never crash a scan or take down Scout
// Pro. Only the caller decides what a failure means.

const DEFAULT_TIMEOUT_MS = 8000;
// How long to remember that a feed is structurally unavailable.
const NEGATIVE_TTL_MS = 30 * 60_000;

/** Read the key for a league. Per-league keys win, then the global key. */
export function resolveKey(sport) {
  const scoped = sport ? process.env[`SPORTSDATAIO_KEY_${String(sport).toUpperCase()}`] : '';
  return scoped || process.env.SPORTSDATAIO_API_KEY || '';
}

export function isConfigured() {
  return Boolean(process.env.SPORTSDATAIO_API_KEY
    || Object.keys(process.env).some((key) => key.startsWith('SPORTSDATAIO_KEY_')));
}

/** Never let a key reach a log line, even if one is accidentally interpolated. */
export function redact(text) {
  const key = process.env.SPORTSDATAIO_API_KEY;
  let out = String(text ?? '');
  if (key && key.length >= 8) out = out.split(key).join('[redacted]');
  for (const name of Object.keys(process.env)) {
    if (!name.startsWith('SPORTSDATAIO_KEY_')) continue;
    const value = process.env[name];
    if (value && value.length >= 8) out = out.split(value).join('[redacted]');
  }
  return out;
}

function reasonFor(status) {
  if (status === 401) return 'key rejected';
  if (status === 403) return 'feed not included in this subscription';
  if (status === 404) return 'feed not available for this date or season';
  if (status === 429) return 'rate limited';
  if (status >= 500) return 'provider server error';
  return `unexpected status ${status}`;
}

export function createClient({
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = Date.now,
  maxEntries = 500,
} = {}) {
  const cache = new Map();      // path -> { at, expiresAt, data }
  const negative = new Map();   // path -> { expiresAt, status, reason }
  const inflight = new Map();   // path -> Promise, so concurrent callers share one request
  let rateLimitedUntil = 0;
  const stats = { hits: 0, misses: 0, errors: 0, requests: 0 };

  function readCache(path) {
    const row = cache.get(path);
    if (!row) return null;
    if (now() >= row.expiresAt) { cache.delete(path); return null; }
    return row;
  }

  function writeCache(path, data, ttlMs) {
    if (cache.size >= maxEntries) {
      // Drop the oldest entry rather than growing without bound.
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) cache.delete(oldest[0]);
    }
    cache.set(path, { at: now(), expiresAt: now() + Math.max(0, ttlMs), data });
  }

  /**
   * @returns {Promise<{ok: boolean, data: any, cached: boolean, status?: number, reason?: string}>}
   */
  async function get(url, path, { ttlMs = 0, sport = null, allowStale = true } = {}) {
    const cached = readCache(path);
    if (cached) { stats.hits++; return { ok: true, data: cached.data, cached: true }; }

    // A feed outside the subscription answers 403 on every call. Remember that
    // for a while so a whole scan's worth of props does not re-ask each time.
    const denied = negative.get(path);
    if (denied && now() < denied.expiresAt) {
      stats.hits++;
      return { ok: false, status: denied.status, reason: denied.reason, data: null, cached: true };
    }
    if (denied) negative.delete(path);

    // A 429 backs off every feed for this provider, not just the one that hit it.
    if (now() < rateLimitedUntil) {
      const stale = allowStale ? cache.get(path) : null;
      return stale
        ? { ok: true, data: stale.data, cached: true, stale: true }
        : { ok: false, status: 429, reason: 'rate limited', data: null, cached: false };
    }

    if (inflight.has(path)) return inflight.get(path);

    const apiKey = resolveKey(sport);
    if (!apiKey) return { ok: false, status: 0, reason: 'not configured', data: null, cached: false };

    const promise = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      stats.requests++;
      try {
        const response = await fetchImpl(url, {
          // Header auth: the key must never appear in a URL, where it could
          // reach a proxy log or an error message.
          headers: { 'Ocp-Apim-Subscription-Key': apiKey, accept: 'application/json' },
          signal: controller.signal,
        });

        if (response.status === 429) {
          const retryAfter = Number(response.headers?.get?.('retry-after')) || 60;
          rateLimitedUntil = now() + retryAfter * 1000;
        }

        if (!response.ok) {
          stats.errors++;
          const stale = allowStale ? cache.get(path) : null;
          if (stale) return { ok: true, data: stale.data, cached: true, stale: true };
          // 403/404 are structural (not in plan, or no such feed for this
          // date): remember them. 401/429/5xx are transient and are not.
          if (response.status === 403 || response.status === 404) {
            negative.set(path, { expiresAt: now() + NEGATIVE_TTL_MS, status: response.status, reason: reasonFor(response.status) });
          }
          return { ok: false, status: response.status, reason: reasonFor(response.status), data: null, cached: false };
        }

        const data = await response.json();
        stats.misses++;
        writeCache(path, data, ttlMs);
        return { ok: true, data, cached: false };
      } catch (error) {
        stats.errors++;
        const stale = allowStale ? cache.get(path) : null;
        if (stale) return { ok: true, data: stale.data, cached: true, stale: true };
        const timedOut = error?.name === 'AbortError' || error?.name === 'TimeoutError';
        return { ok: false, status: 0, reason: timedOut ? 'timed out' : 'network error', data: null, cached: false };
      } finally {
        clearTimeout(timer);
        inflight.delete(path);
      }
    })();

    inflight.set(path, promise);
    return promise;
  }

  return {
    get,
    stats: () => ({ ...stats, cacheEntries: cache.size, deniedFeeds: negative.size, rateLimited: now() < rateLimitedUntil }),
    clearCache: () => { cache.clear(); negative.clear(); inflight.clear(); rateLimitedUntil = 0; },
  };
}
