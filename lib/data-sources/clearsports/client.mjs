const BASE_URL = 'https://api.clearsportsapi.com/api/v1';
const DEFAULT_TIMEOUT_MS = 9000;

export const CLEARSPORTS_SPORTS = Object.freeze(new Set(['NFL', 'NCAAF', 'NCAAB', 'NBA', 'NHL', 'MLB']));

export function isConfigured() {
  return Boolean(String(process.env.CLEARSPORTS_API_KEY || '').trim());
}

function safeSport(value) {
  const sport = String(value || '').trim().toUpperCase();
  return CLEARSPORTS_SPORTS.has(sport) ? sport : null;
}

function safeResource(value) {
  const resource = String(value || '').trim().toLowerCase();
  return /^[a-z0-9-]+$/.test(resource) ? resource : null;
}

function cacheKey(path, query) {
  const pairs = Object.entries(query || {})
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  return `${path}?${new URLSearchParams(pairs.map(([key, value]) => [key, String(value)])).toString()}`;
}

export function endpointFor(sport, resource) {
  const clean = safeSport(sport);
  const item = safeResource(resource);
  if (!clean || !item) return null;
  return `/${clean.toLowerCase()}/${item}`;
}

export function createClearSportsClient({ timeoutMs = DEFAULT_TIMEOUT_MS, maxEntries = 500 } = {}) {
  const cache = new Map();
  const metrics = {
    calls: 0,
    cacheHits: 0,
    failures: 0,
    lastStatus: null,
    lastLatencyMs: null,
    lastSuccessAt: null,
  };

  function prune() {
    const now = Date.now();
    for (const [key, row] of cache) {
      if (!row || row.expiresAt <= now) cache.delete(key);
    }
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
  }

  async function get(path, { query = {}, ttlMs = 120_000 } = {}) {
    const key = String(process.env.CLEARSPORTS_API_KEY || '').trim();
    if (!key) return { ok: false, status: 0, code: 'NOT_CONFIGURED', data: null, cached: false };

    const cleanPath = String(path || '').startsWith('/') ? String(path) : `/${String(path || '')}`;
    const id = cacheKey(cleanPath, query);
    const cached = cache.get(id);
    if (cached && cached.expiresAt > Date.now()) {
      metrics.cacheHits += 1;
      return { ok: true, status: 200, data: cached.data, cached: true, latencyMs: 0 };
    }

    const url = new URL(`${BASE_URL}${cleanPath}`);
    for (const [name, value] of Object.entries(query || {})) {
      if (value !== null && value !== undefined && value !== '') url.searchParams.set(name, String(value));
    }

    metrics.calls += 1;
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${key}`,
          'user-agent': 'AutoProp-Scout/1.0',
        },
        signal: controller.signal,
      });
      const latencyMs = Date.now() - startedAt;
      metrics.lastStatus = response.status;
      metrics.lastLatencyMs = latencyMs;
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      if (!response.ok) {
        metrics.failures += 1;
        return {
          ok: false,
          status: response.status,
          code: response.status === 401 ? 'KEY_REJECTED' : response.status === 403 ? 'ACCESS_DENIED' : response.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_ERROR',
          data: null,
          cached: false,
          latencyMs,
        };
      }
      metrics.lastSuccessAt = new Date().toISOString();
      cache.set(id, { data, expiresAt: Date.now() + Math.max(0, Number(ttlMs) || 0) });
      prune();
      return { ok: true, status: response.status, data, cached: false, latencyMs };
    } catch (error) {
      metrics.failures += 1;
      metrics.lastStatus = 0;
      metrics.lastLatencyMs = Date.now() - startedAt;
      return { ok: false, status: 0, code: error?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR', data: null, cached: false, latencyMs: metrics.lastLatencyMs };
    } finally {
      clearTimeout(timer);
    }
  }

  async function probe() {
    const result = await get('/api-keys/me', { ttlMs: 10 * 60_000 });
    const body = result.ok && result.data && typeof result.data === 'object' ? result.data : {};
    return {
      configured: isConfigured(),
      reachable: result.ok,
      status: result.status || null,
      active: result.ok ? body.is_active !== false : false,
      creditsRemaining: result.ok && Number.isFinite(Number(body.credits_remaining)) ? Number(body.credits_remaining) : null,
      creditsTotal: result.ok && Number.isFinite(Number(body.credits_total)) ? Number(body.credits_total) : null,
      code: result.ok ? null : result.code,
      cached: Boolean(result.cached),
      latencyMs: result.latencyMs ?? null,
    };
  }

  return {
    get,
    probe,
    stats: () => ({ ...metrics, cacheEntries: cache.size }),
  };
}
