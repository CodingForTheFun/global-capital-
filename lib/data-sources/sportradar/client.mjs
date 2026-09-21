const HOST = 'https://api.sportradar.com';
const PRODUCT = 'oddscomparison-player-props';

const text = (value) => String(value ?? '').trim();
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
  resolvedAccessLevel: null,
  lastOkAt: null,
  lastFailAt: null,
  lastError: null,
  lastStatus: null,
  rateLimit: { limit: null, remaining: null },
};

export function sportradarApiKey() {
  return text(process.env.SPORTRADAR_API_KEY || process.env.SPORTRADAR_ODDS_API_KEY);
}

export function sportradarConfigured() {
  return Boolean(sportradarApiKey());
}

function configuredAccessLevel() {
  const raw = text(process.env.SPORTRADAR_ACCESS_LEVEL).toLowerCase();
  return ['trial', 'production'].includes(raw) ? raw : null;
}

function candidateAccessLevels() {
  const configured = configuredAccessLevel();
  if (configured) return [configured];
  if (state.resolvedAccessLevel) return [state.resolvedAccessLevel];
  return ['production', 'trial'];
}

function baseUrl(accessLevel) {
  const language = text(process.env.SPORTRADAR_LANGUAGE || 'en').toLowerCase() || 'en';
  return `${HOST}/${PRODUCT}/${accessLevel}/v2/${language}`;
}

function stableParams(params = {}) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : String(value)]);
}

function keyFor(accessLevel, path, params) {
  return [accessLevel, path, ...stableParams(params).flat()].join('|');
}

function timeoutSignal(external, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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

function safeCode(status) {
  if (status === 401) return 'SPORTRADAR_UNAUTHORIZED';
  if (status === 403) return 'SPORTRADAR_FORBIDDEN';
  if (status === 429) return 'SPORTRADAR_RATE_LIMITED';
  return `SPORTRADAR_HTTP_${status}`;
}

function readRateLimit(headers) {
  const limit = Number(headers?.get?.('x-ratelimit-limit'));
  const remaining = Number(headers?.get?.('x-ratelimit-remaining'));
  if (Number.isFinite(limit)) state.rateLimit.limit = limit;
  if (Number.isFinite(remaining)) state.rateLimit.remaining = remaining;
}

async function oneRequest(accessLevel, path, params, options) {
  const url = new URL(baseUrl(accessLevel) + path);
  for (const [name, value] of stableParams(params)) url.searchParams.set(name, value);

  const timeout = timeoutSignal(options.signal || null, clamp(options.timeoutMs, 12_000, 2_000, 30_000));
  try {
    state.requests += 1;
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'x-api-key': sportradarApiKey(),
      },
      signal: timeout.signal,
    });
    readRateLimit(response.headers);
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = Object.assign(new Error('Sportradar request failed.'), {
        code: safeCode(response.status),
        status: response.status,
        accessLevel,
      });
      throw error;
    }
    state.resolvedAccessLevel = accessLevel;
    state.lastOkAt = new Date().toISOString();
    state.lastStatus = response.status;
    state.lastError = null;
    return {
      payload,
      headers: {
        maxResults: Number(response.headers.get('x-max-results')) || null,
      },
      accessLevel,
    };
  } finally {
    timeout.clear();
  }
}

export async function sportradarGet(path, params = {}, {
  ttlSeconds = 60,
  bypassCache = false,
  timeoutMs = 12_000,
  signal = null,
} = {}) {
  if (!sportradarConfigured()) {
    throw Object.assign(new Error('Sportradar is not configured.'), { code: 'SPORTRADAR_NOT_CONFIGURED' });
  }

  let lastError = null;
  for (const accessLevel of candidateAccessLevels()) {
    const key = keyFor(accessLevel, path, params);
    const hit = cache.get(key);
    if (!bypassCache && hit && hit.expiresAt > Date.now()) {
      state.cacheHits += 1;
      return hit.value;
    }
    if (inflight.has(key)) return inflight.get(key);

    const task = oneRequest(accessLevel, path, params, { timeoutMs, signal })
      .then((value) => {
        cache.set(key, {
          value,
          expiresAt: Date.now() + Math.max(15, Number(ttlSeconds) || 60) * 1000,
        });
        while (cache.size > 500) cache.delete(cache.keys().next().value);
        return value;
      })
      .finally(() => inflight.delete(key));

    inflight.set(key, task);
    try {
      return await task;
    } catch (error) {
      lastError = error;
      state.failures += 1;
      state.lastFailAt = new Date().toISOString();
      state.lastStatus = Number(error?.status) || null;
      state.lastError = text(error?.code || error?.name || 'SPORTRADAR_FAILED');
      // In auto access-level mode only, an auth response can mean the key
      // belongs to the other Sportradar access path. Try that path once.
      if (configuredAccessLevel() || ![401, 403].includes(Number(error?.status))) throw error;
    }
  }
  throw lastError || Object.assign(new Error('Sportradar request failed.'), { code: 'SPORTRADAR_FAILED' });
}

export function sportradarHealth() {
  return {
    configured: sportradarConfigured(),
    product: 'Odds Comparison Player Props v2',
    configuredAccessLevel: configuredAccessLevel() || 'auto',
    resolvedAccessLevel: state.resolvedAccessLevel,
    requests: state.requests,
    cacheHits: state.cacheHits,
    failures: state.failures,
    lastOkAt: state.lastOkAt,
    lastFailAt: state.lastFailAt,
    lastStatus: state.lastStatus,
    lastError: state.lastError,
    rateLimit: { ...state.rateLimit },
    cacheEntries: cache.size,
  };
}

export function __resetSportradarClient() {
  cache.clear();
  inflight.clear();
  Object.assign(state, {
    requests: 0,
    cacheHits: 0,
    failures: 0,
    resolvedAccessLevel: null,
    lastOkAt: null,
    lastFailAt: null,
    lastError: null,
    lastStatus: null,
    rateLimit: { limit: null, remaining: null },
  });
}
