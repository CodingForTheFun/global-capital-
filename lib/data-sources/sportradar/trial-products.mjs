import { sportradarApiKey } from './client.mjs';

const HOST = 'https://api.sportradar.com';
const text = (value) => String(value ?? '').trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const SPORTRADAR_TRIAL_PRODUCTS = Object.freeze({
  nba: Object.freeze({
    label: 'NBA API v8',
    base: '/nba/trial/v8/en',
    probe: '/league/hierarchy.json',
    capabilities: ['schedules','teams','rosters','player-profiles','game-stats','injuries','standings'],
  }),
  wnba: Object.freeze({
    label: 'WNBA API v8',
    base: '/wnba/trial/v8/en',
    probe: '/league/hierarchy.json',
    capabilities: ['schedules','teams','rosters','player-profiles','game-stats','standings'],
  }),
  nfl: Object.freeze({
    label: 'NFL API v7',
    base: '/nfl/official/trial/v7/en',
    probe: '/league/hierarchy.json',
    capabilities: ['schedules','teams','rosters','player-profiles','game-stats','injuries','depth-charts','standings'],
  }),
  mlb: Object.freeze({
    label: 'MLB API v8',
    base: '/mlb/trial/v8/en',
    probe: '/league/hierarchy.json',
    capabilities: ['schedules','teams','rosters','player-profiles','game-stats','injuries','standings'],
  }),
  nhl: Object.freeze({
    label: 'NHL API v7',
    base: '/nhl/trial/v7/en',
    probe: '/league/hierarchy.json',
    capabilities: ['schedules','teams','player-profiles','game-stats','injuries','depth-charts','standings'],
  }),
  ncaafb: Object.freeze({
    label: 'NCAAFB API v7',
    base: '/ncaafb/trial/v7/en',
    probe: '/league/hierarchy.json',
    capabilities: ['schedules','teams','rosters','player-profiles','game-stats','rankings'],
  }),
  ncaamh: Object.freeze({
    label: 'NCAAMH API v3',
    base: '/ncaamh/trial/v3/en',
    probe: '/league/hierarchy.json',
    capabilities: ['schedules','teams','rosters','player-profiles','game-stats','rankings'],
  }),
  soccer: Object.freeze({
    label: 'Soccer API v4',
    base: '/soccer/trial/v4/en',
    probe: '/competitions.json',
    capabilities: ['competitions','schedules','lineups','player-profiles','summaries','timelines'],
  }),
  soccerExtended: Object.freeze({
    label: 'Soccer Extended API v4',
    base: '/soccer-extended/trial/v4/en',
    probe: '/competitions.json',
    capabilities: ['competitions','extended-summaries','extended-timelines','lineups'],
  }),
  tennis: Object.freeze({
    label: 'Tennis API v3',
    base: '/tennis/trial/v3/en',
    probe: '/competitions.json',
    capabilities: ['competitions','schedules','player-profiles','summaries','rankings'],
  }),
  tableTennis: Object.freeze({
    label: 'Table Tennis API v2',
    base: '/tabletennis/trial/v2/en',
    probe: '/competitions.json',
    capabilities: ['competitions','schedules','player-profiles','summaries'],
  }),
  globalIceHockey: Object.freeze({
    label: 'Global Ice Hockey API v2',
    base: '/icehockey/trial/v2/en',
    probe: '/competitions.json',
    capabilities: ['competitions','schedules','player-profiles','summaries','probabilities'],
  }),
  australianRules: Object.freeze({
    label: 'Australian Rules Football API v3',
    base: '/australianrules/trial/v3/en',
    probe: '/competitions.json',
    capabilities: ['competitions','schedules','player-profiles','summaries'],
  }),
  golf: Object.freeze({
    label: 'Golf API v3',
    base: '/golf/trial/v3/en',
    probe: '/seasons.json',
    capabilities: ['seasons','tournaments','players','leaderboards','statistics'],
  }),
  darts: Object.freeze({
    label: 'Darts API v2',
    base: '/darts/trial/v2/en',
    probe: '/competitions.json',
    capabilities: ['competitions','schedules','player-profiles','summaries','rankings'],
  }),
  badminton: Object.freeze({
    label: 'Badminton API v2',
    base: '/badminton/trial/v2/en',
    probe: '/competitions.json',
    capabilities: ['competitions','schedules','player-profiles','summaries'],
  }),
  synergyNbaBase: Object.freeze({
    label: 'Synergy NBA Base',
    base: '/synergy/basketball/nba',
    probe: '/teams',
    probeParams: { take: 1 },
    capabilities: ['teams','players','games','play-by-play','possession-events','play-types','shot-coordinates'],
  }),
  synergyNbaAdvanced: Object.freeze({
    label: 'Synergy NBA Advanced',
    base: '/synergy/advanced/basketball/nba',
    probe: '/statcomparisongroups',
    probeParams: { take: 1 },
    capabilities: ['player-projections','player-roles','advanced-events','comparison-groups'],
  }),
  synergyWnbaBase: Object.freeze({
    label: 'Synergy WNBA Base',
    base: '/synergy/basketball/wnba',
    probe: '/teams',
    probeParams: { take: 1 },
    capabilities: ['teams','players','games','play-by-play','possession-events','play-types','shot-coordinates'],
  }),
  synergyWnbaAdvanced: Object.freeze({
    label: 'Synergy WNBA Advanced',
    base: '/synergy/advanced/basketball/wnba',
    probe: '/statcomparisongroups',
    probeParams: { take: 1 },
    capabilities: ['player-projections','player-roles','advanced-events','comparison-groups'],
  }),
});

const state = new Map();
const cache = new Map();
const inflight = new Map();
const queues = new Map();
const lastRequestAt = new Map();
let probePromise = null;

async function scheduleProductRequest(productId, task) {
  const previous = queues.get(productId) || Promise.resolve();
  const run = previous.catch(() => {}).then(async () => {
    const elapsed = Date.now() - Number(lastRequestAt.get(productId) || 0);
    if (elapsed < 1100) await sleep(1100 - elapsed);
    lastRequestAt.set(productId, Date.now());
    return task();
  });
  queues.set(productId, run.finally(() => {
    if (queues.get(productId) === run) queues.delete(productId);
  }));
  return run;
}

function safeCode(status) {
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'UPSTREAM_ERROR';
  return 'HTTP_' + status;
}

function queryPairs(params = {}) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => a.localeCompare(b));
}

function urlFor(product, path, params = {}) {
  const url = new URL(HOST + product.base + path);
  for (const [key, value] of queryPairs(params)) url.searchParams.set(key, String(value));
  return url;
}

function cacheKey(productId, path, params) {
  return JSON.stringify([productId, path, queryPairs(params)]);
}

export function sportradarTrialConfigured() {
  return Boolean(sportradarApiKey());
}

export function sportradarTrialProductAvailable(productId) {
  return state.get(productId)?.available === true;
}

export function sportradarTrialProductState(productId) {
  const product = SPORTRADAR_TRIAL_PRODUCTS[productId];
  const row = state.get(productId);
  return {
    productId,
    label: product?.label || productId,
    available: row?.available === true,
    tested: Boolean(row),
    status: row?.status ?? null,
    code: row?.code ?? null,
    testedAt: row?.testedAt ?? null,
    latencyMs: row?.latencyMs ?? null,
    capabilities: [...(product?.capabilities || [])],
  };
}

export async function sportradarTrialGet(productId, path, params = {}, {
  ttlMs = 5 * 60_000,
  timeoutMs = 10_000,
  bypassCache = false,
} = {}) {
  const product = SPORTRADAR_TRIAL_PRODUCTS[productId];
  if (!product) throw Object.assign(new Error('Unknown Sportradar trial product.'), { code: 'SPORTRADAR_TRIAL_UNKNOWN_PRODUCT' });
  if (!sportradarTrialConfigured()) throw Object.assign(new Error('Sportradar trial key is not configured.'), { code: 'SPORTRADAR_TRIAL_NOT_CONFIGURED' });

  const key = cacheKey(productId, path, params);
  const hit = cache.get(key);
  if (!bypassCache && hit && hit.expiresAt > Date.now()) return { ...hit.value, cached: true };
  if (inflight.has(key)) return inflight.get(key);

  const task = scheduleProductRequest(productId, async () => {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 10_000));
    timer.unref?.();
    try {
      const response = await fetch(urlFor(product, path, params), {
        headers: { accept: 'application/json', 'x-api-key': sportradarApiKey() },
        signal: controller.signal,
      });
      const payload = response.ok ? await response.json().catch(() => null) : null;
      const value = {
        ok: response.ok,
        status: response.status,
        code: response.ok ? null : safeCode(response.status),
        payload,
        cached: false,
        latencyMs: Date.now() - started,
      };
      if (response.ok) {
        cache.set(key, { value, expiresAt: Date.now() + Math.max(60_000, Number(ttlMs) || 0) });
        while (cache.size > 300) cache.delete(cache.keys().next().value);
      }
      return value;
    } catch (error) {
      return {
        ok: false,
        status: 0,
        code: error?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR',
        payload: null,
        cached: false,
        latencyMs: Date.now() - started,
      };
    } finally {
      clearTimeout(timer);
    }
  }).finally(() => inflight.delete(key));

  inflight.set(key, task);
  return task;
}

function safeCount(payload) {
  if (!payload || typeof payload !== 'object') return null;
  for (const key of ['data','competitions','seasons','teams','conferences','divisions','league']) {
    const value = payload[key];
    if (Array.isArray(value)) return value.length;
  }
  if (payload.meta?.pagination && Number.isFinite(Number(payload.meta.pagination.totalRecords))) {
    return Number(payload.meta.pagination.totalRecords);
  }
  return null;
}

export async function probeSportradarTrialProduct(productId) {
  const product = SPORTRADAR_TRIAL_PRODUCTS[productId];
  if (!product) return sportradarTrialProductState(productId);
  const result = await sportradarTrialGet(productId, product.probe, product.probeParams || {}, {
    ttlMs: 4 * 60 * 60_000,
    timeoutMs: 10_000,
    bypassCache: true,
  });
  const testedAt = new Date().toISOString();
  state.set(productId, {
    available: result.ok,
    status: result.status,
    code: result.code,
    testedAt,
    latencyMs: result.latencyMs,
    sampleCount: result.ok ? safeCount(result.payload) : null,
  });
  return { ...sportradarTrialProductState(productId), sampleCount: result.ok ? safeCount(result.payload) : null };
}

export async function probeAllSportradarTrials({ delayMs = 1100 } = {}) {
  if (probePromise) return probePromise;
  probePromise = (async () => {
    const rows = [];
    const ids = Object.keys(SPORTRADAR_TRIAL_PRODUCTS);
    for (let index = 0; index < ids.length; index += 1) {
      const productId = ids[index];
      rows.push(await probeSportradarTrialProduct(productId));
      if (index < ids.length - 1) await sleep(Math.max(1000, Number(delayMs) || 1100));
    }
    return rows;
  })().finally(() => { probePromise = null; });
  return probePromise;
}

export function sportradarTrialHealth() {
  const products = Object.keys(SPORTRADAR_TRIAL_PRODUCTS).map(sportradarTrialProductState);
  return {
    configured: sportradarTrialConfigured(),
    tested: products.filter((row) => row.tested).length,
    available: products.filter((row) => row.available).map((row) => row.productId),
    unavailable: products.filter((row) => row.tested && !row.available).map((row) => row.productId),
    products,
    cacheEntries: cache.size,
  };
}

export function startSportradarTrialProbe({ delayMs = 3500 } = {}) {
  if (!sportradarTrialConfigured()) return null;
  const timer = setTimeout(() => {
    void probeAllSportradarTrials().then((rows) => {
      console.log('[Sportradar trials]', JSON.stringify({
        tested: rows.length,
        available: rows.filter((row) => row.available).map((row) => row.productId),
        unavailable: rows.filter((row) => !row.available).map((row) => ({ id: row.productId, status: row.status, code: row.code })),
      }));
    }).catch((error) => {
      console.log('[Sportradar trials] failed code=' + text(error?.code || error?.name || 'PROBE_FAILED').slice(0, 80));
    });
  }, Math.max(1000, Number(delayMs) || 3500));
  timer.unref?.();
  return timer;
}

export function __resetSportradarTrialProducts() {
  state.clear();
  cache.clear();
  inflight.clear();
  queues.clear();
  lastRequestAt.clear();
  probePromise = null;
}
