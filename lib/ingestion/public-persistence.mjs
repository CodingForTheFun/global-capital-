const text = (value) => String(value ?? '').trim();
const URL = () => text(process.env.AUTOSCOUT_SUPABASE_URL || process.env.SUPABASE_URL).replace(/\/$/, '');
const KEY = () => text(process.env.AUTOSCOUT_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY);
const TOKEN = () => text(process.env.AUTOSCOUT_SUPABASE_INGEST_TOKEN);
const TRANSIENT_DATA_API_STATUSES = new Set([500, 502, 503, 504]);

const clampInt = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
};
const enabled = (value) => ['1', 'true', 'yes', 'on'].includes(text(value).toLowerCase());
const directPrimary = () => enabled(process.env.AUTOSCOUT_DIRECT_DB_PRIMARY);
const snapshotBatchSize = () => clampInt(process.env.AUTOSCOUT_PUBLIC_SNAPSHOT_BATCH_SIZE, 25, 10, 100);
const historyBatchSize = () => clampInt(process.env.AUTOSCOUT_PUBLIC_HISTORY_BATCH_SIZE, 100, 25, 500);
const storeTimeoutMs = () => clampInt(process.env.AUTOSCOUT_PUBLIC_STORE_TIMEOUT_MS, 35_000, 10_000, 60_000);
const fallbackDelayMs = () => clampInt(process.env.AUTOSCOUT_PUBLIC_FALLBACK_DELAY_MS, 750, 0, 5_000);
const sleep = (ms) => ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

function publicIntervalSeconds(value = process.env.AUTOSCOUT_PUBLIC_INGEST_SECONDS) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(300, Math.max(30, Math.floor(n))) : 45;
}

export function publicPersistenceConfigured() {
  return Boolean(URL() && KEY() && TOKEN());
}

export function __publicPersistenceTuning() {
  return {
    snapshotBatchSize: snapshotBatchSize(),
    historyBatchSize: historyBatchSize(),
    storeTimeoutMs: storeTimeoutMs(),
    fallbackDelayMs: fallbackDelayMs(),
    directPrimary: directPrimary(),
  };
}

function safeStoreCode(body, status) {
  const message = text(body?.message).toLowerCase();
  if (message.includes('payload too large')) return 'PUBLIC_STORE_PAYLOAD_TOO_LARGE';
  if (message.includes('affect row a second time') || message.includes('cardinality')) return 'PUBLIC_STORE_DUPLICATE';
  if (message.includes('duplicate key')) return 'PUBLIC_STORE_DUPLICATE';
  if (message.includes('invalid input syntax') || message.includes('out of range')) return 'PUBLIC_STORE_INVALID_ROW';
  if (message.includes('statement timeout') || message.includes('canceling statement')) return 'PUBLIC_STORE_TIMEOUT';
  if (message.includes('unauthorized ingestion')) return 'PUBLIC_STORE_UNAUTHORIZED';
  return `PUBLIC_STORE_FAILED_${Number(status) || 0}`;
}

async function directStore(functionName, action, payload = {}, { timeoutMs = storeTimeoutMs() } = {}) {
  const response = await fetch(`${URL()}/functions/v1/autoscout-db-direct`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-autoscout-ingest-token': TOKEN(),
    },
    body: JSON.stringify({
      name: functionName,
      args: { p_token: TOKEN(), p_action: action, p_payload: payload },
    }),
    signal: AbortSignal.timeout(clampInt(timeoutMs, storeTimeoutMs(), 1_000, 60_000)),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error('PUBLIC_DIRECT_STORE_FAILED'), { code: safeStoreCode(body, response.status), status: response.status });
  return body && typeof body === 'object' ? body : {};
}

async function directFallback(functionName, action, payload, timeoutMs) {
  // PostgREST can return or locally time out while PostgreSQL is still finishing
  // the original statement. A short pause plus one fallback prevents two heavy
  // writes from overlapping and multiplying database pressure.
  await sleep(fallbackDelayMs());
  return directStore(functionName, action, payload, { timeoutMs });
}

async function rpcStore(functionName, action, payload = {}, { allowDirect = true, timeoutMs = storeTimeoutMs() } = {}) {
  if (!publicPersistenceConfigured()) throw Object.assign(new Error('PUBLIC_STORE_NOT_CONFIGURED'), { code: 'PUBLIC_STORE_NOT_CONFIGURED' });
  const requestTimeoutMs = clampInt(timeoutMs, storeTimeoutMs(), 900, 60_000);
  let directAttempted = false;

  // Background ingestion previously sent every write through PostgREST first.
  // At production volume that wrapper alone accumulated millions of temporary
  // blocks while the equivalent direct RPCs used none. When explicitly enabled,
  // prefer the token-guarded direct database edge function for background work;
  // customer-facing cache reads keep allowDirect=false and stay on PostgREST.
  // If that direct attempt fails, do not invoke it a second time after PostgREST;
  // one operation is capped at one direct attempt to avoid retry-amplifying a
  // degraded database into a connection storm.
  if (allowDirect && directPrimary()) {
    directAttempted = true;
    try {
      return await directStore(functionName, action, payload, { timeoutMs: requestTimeoutMs });
    } catch {
      // Fall through to PostgREST once. All supported writes are idempotent
      // upserts/lease operations, so this remains safe if direct connectivity
      // has a transient failure.
    }
  }

  let response;
  try {
    response = await fetch(`${URL()}/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        apikey: KEY(),
        authorization: `Bearer ${KEY()}`,
      },
      body: JSON.stringify({ p_token: TOKEN(), p_action: action, p_payload: payload }),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch (error) {
    if (allowDirect && !directAttempted) return directFallback(functionName, action, payload, requestTimeoutMs);
    if (!allowDirect) throw Object.assign(new Error('PUBLIC_STORE_FAST_READ_FAILED'), { code: 'PUBLIC_STORE_FAST_READ_FAILED', status: 504, cause: error });
    throw Object.assign(new Error('PUBLIC_STORE_FAILED'), { code: 'PUBLIC_STORE_TRANSPORT_FAILED', status: 504, cause: error });
  }
  const body = await response.json().catch(() => null);
  if (!response.ok && TRANSIENT_DATA_API_STATUSES.has(Number(response.status)) && allowDirect && !directAttempted) {
    return directFallback(functionName, action, payload, requestTimeoutMs);
  }
  if (!response.ok) throw Object.assign(new Error('PUBLIC_STORE_FAILED'), { code: safeStoreCode(body, response.status), status: response.status });
  return body && typeof body === 'object' ? body : {};
}

async function store(action, payload = {}, options = undefined) {
  return rpcStore('autoscout_public_store', action, payload, options);
}

async function historyStore(action, payload = {}, options = undefined) {
  // History has a narrower, additive RPC so verified ESPN sports can persist
  // without widening the higher-risk live-prop storage function.
  return rpcStore('autoscout_public_history_store', action, payload, options);
}

export async function claimPublicCycle(intervalSeconds = publicIntervalSeconds()) {
  return store('claim', { interval_seconds: publicIntervalSeconds(intervalSeconds) });
}
export async function releasePublicCycle(owner) {
  if (!owner) return {};
  return store('release', { owner });
}
export async function recordPublicStatus(source, state) {
  return store('status', { source, state });
}
export async function persistPublicSnapshot(source, rows, observedAt = new Date().toISOString()) {
  const unique = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = text(row?.id);
    if (id) unique.set(id, row);
  }
  const snapshotRows = [...unique.values()];
  const batchSize = snapshotBatchSize();
  let written = 0;
  // PrizePicks can expose tens of thousands of standard + special lines. Keep
  // each transaction deliberately small, then prune omitted rows only after
  // every chunk succeeds so a partial refresh never destroys last-good data.
  for (let i = 0; i < snapshotRows.length; i += batchSize) {
    const result = await store('props', {
      source,
      observed_at: observedAt,
      rows: snapshotRows.slice(i, i + batchSize),
      chunked: true,
      finalize: false,
    });
    written += Number(result?.written || 0);
  }
  await store('props', { source, observed_at: observedAt, rows: [], chunked: true, finalize: true });
  return { written };
}
export async function readPublicProps(sport) {
  // Customer prop-board reads must never inherit a database write outage. If
  // PostgREST is saturated, fail this optional persisted-cache read quickly and
  // let the caller serve the already-warm in-process/public-feed cache instead.
  // The direct DB fallback remains enabled for background writes, where waiting
  // is preferable to dropping fresh snapshots.
  const result = await store('read_props', { sport: text(sport).toUpperCase() }, { allowDirect: false, timeoutMs: 900 });
  return Array.isArray(result?.rows) ? result.rows : [];
}
export async function persistGameLogs(rows) {
  if (!Array.isArray(rows) || !rows.length) return { written: 0 };
  const batchSize = historyBatchSize();
  let written = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const result = await historyStore('history', { rows: rows.slice(i, i + batchSize) });
    written += Number(result?.written || 0);
  }
  return { written };
}
export async function historyCandidates() {
  const result = await historyStore('history_candidates');
  return Array.isArray(result?.rows) ? result.rows : [];
}
export async function readGameLogs(playerId) {
  const result = await historyStore('read_history', { player_id: text(playerId) });
  return Array.isArray(result?.rows) ? result.rows : [];
}
