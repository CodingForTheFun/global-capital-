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
const directFallbackEnabled = () => enabled(process.env.AUTOSCOUT_DIRECT_DB_FALLBACK);
const snapshotBatchSize = () => clampInt(process.env.AUTOSCOUT_PUBLIC_SNAPSHOT_BATCH_SIZE, 250, 50, 500);
const historyBatchSize = () => clampInt(process.env.AUTOSCOUT_PUBLIC_HISTORY_BATCH_SIZE, 100, 25, 500);
const storeTimeoutMs = () => clampInt(process.env.AUTOSCOUT_PUBLIC_STORE_TIMEOUT_MS, 35_000, 10_000, 60_000);
const fallbackDelayMs = () => clampInt(process.env.AUTOSCOUT_PUBLIC_FALLBACK_DELAY_MS, 750, 0, 5_000);
const sleep = (ms) => ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

function persistenceTargetHost() {
  try {
    return new globalThis.URL(URL()).host || 'unset';
  } catch {
    return URL() ? 'invalid' : 'unset';
  }
}

// The Supabase hostname/project ref is operational routing metadata, not a
// credential. Logging only the host lets production prove which database target
// it is using without ever exposing keys, tokens, paths, or query parameters.
console.log(`[AutoScout persistence target] host=${persistenceTargetHost()}`);

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
  if (message.includes('connection timeout') || message.includes('connection terminated')) return 'PUBLIC_STORE_CONNECTION_TIMEOUT';
  if (message.includes('too many clients') || message.includes('remaining connection slots')) return 'PUBLIC_STORE_CONNECTION_EXHAUSTED';
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
  if (!response.ok) {
    const secret = TOKEN();
    const rawMessage = text(body?.message);
    const safeMessage = (secret ? rawMessage.split(secret).join('[redacted]') : rawMessage).replace(/\s+/g, ' ').slice(0, 180);
    console.warn(`[AutoScout public store] direct failure function=${functionName} action=${action} status=${response.status} dbCode=${text(body?.code).slice(0, 32) || 'none'} error=${text(body?.error).slice(0, 64) || 'none'} message=${safeMessage || 'none'}`);
    throw Object.assign(new Error('PUBLIC_DIRECT_STORE_FAILED'), { code: safeStoreCode(body, response.status), status: response.status });
  }
  return body && typeof body === 'object' ? body : {};
}

async function directFallback(functionName, action, payload, timeoutMs) {
  await sleep(fallbackDelayMs());
  return directStore(functionName, action, payload, { timeoutMs });
}

async function rpcStore(functionName, action, payload = {}, { allowDirect = true, timeoutMs = storeTimeoutMs() } = {}) {
  if (!publicPersistenceConfigured()) throw Object.assign(new Error('PUBLIC_STORE_NOT_CONFIGURED'), { code: 'PUBLIC_STORE_NOT_CONFIGURED' });
  const requestTimeoutMs = clampInt(timeoutMs, storeTimeoutMs(), 900, 60_000);
  let directAttempted = false;

  if (allowDirect && directPrimary()) {
    directAttempted = true;
    return directStore(functionName, action, payload, { timeoutMs: requestTimeoutMs });
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
    if (allowDirect && !directAttempted && directFallbackEnabled()) return directFallback(functionName, action, payload, requestTimeoutMs);
    if (!allowDirect) { noteStoreFailure(functionName, action, 'PUBLIC_STORE_FAST_READ_FAILED', 504); throw Object.assign(new Error('PUBLIC_STORE_FAST_READ_FAILED'), { code: 'PUBLIC_STORE_FAST_READ_FAILED', status: 504, cause: error }); }
    noteStoreFailure(functionName, action, 'PUBLIC_STORE_TRANSPORT_FAILED', 504);
    throw Object.assign(new Error('PUBLIC_STORE_FAILED'), { code: 'PUBLIC_STORE_TRANSPORT_FAILED', status: 504, cause: error });
  }
  const body = await response.json().catch(() => null);
  if (!response.ok && TRANSIENT_DATA_API_STATUSES.has(Number(response.status)) && allowDirect && !directAttempted && directFallbackEnabled()) {
    return directFallback(functionName, action, payload, requestTimeoutMs);
  }
  if (!response.ok) {
    noteStoreFailure(functionName, action, safeStoreCode(body, response.status), response.status);
    throw Object.assign(new Error('PUBLIC_STORE_FAILED'), { code: safeStoreCode(body, response.status), status: response.status });
  }
  noteStoreSuccess();
  return body && typeof body === 'object' ? body : {};
}

// Every write to the public store is best-effort at the call site: a failed
// status write must not stop an ingestion cycle, so all four callers wrap these
// in `catch {}` or `.catch(() => {})`. That is the right control flow and the
// wrong amount of silence - on 2026-09-15 a null source produced 34 HTTP 500s
// in twenty minutes and not one of them appeared in a log, a health field or an
// alert. The only place they existed was the database's own error log.
//
// Counting them here, at the single point every call passes through, keeps the
// callers' behaviour exactly as it is while making the silence visible.
const storeFailures = new Map();
let storeSuccesses = 0;
let lastStoreSuccessAt = null;

function noteStoreFailure(functionName, action, code, status) {
  const key = `${functionName}:${action}`;
  const previous = storeFailures.get(key);
  storeFailures.set(key, {
    count: (previous?.count || 0) + 1,
    lastCode: String(code || 'UNKNOWN').slice(0, 60),
    lastStatus: Number(status) || null,
    lastAt: new Date().toISOString(),
  });
}

function noteStoreSuccess() {
  storeSuccesses += 1;
  lastStoreSuccessAt = new Date().toISOString();
}

/** Write outcomes for the public store, so swallowed failures still surface. */
export function publicStoreHealth() {
  const failures = [...storeFailures.entries()]
    .map(([call, row]) => ({ call, ...row }))
    .sort((a, b) => b.count - a.count);
  return {
    successes: storeSuccesses,
    lastSuccessAt: lastStoreSuccessAt,
    failureCalls: failures.length,
    totalFailures: failures.reduce((sum, row) => sum + row.count, 0),
    failures: failures.slice(0, 10),
  };
}

export function __resetPublicStoreHealth() {
  storeFailures.clear();
  storeSuccesses = 0;
  lastStoreSuccessAt = null;
}

async function store(action, payload = {}, options = undefined) {
  return rpcStore('autoscout_public_store', action, payload, options);
}

async function historyStore(action, payload = {}, options = undefined) {
  return rpcStore('autoscout_public_history_store', action, payload, options);
}

export async function claimPublicCycle(intervalSeconds = publicIntervalSeconds()) {
  // Lease claims are tiny coordination writes. Do not let a slow/degraded API
  // hold the bootstrap lock for the full heavy-write timeout or the scheduled
  // bootstrap retry is skipped. Keep the claim on the canonical pooled RPC and
  // fail it within ten seconds; snapshots keep their longer write timeout.
  return store('claim', { interval_seconds: publicIntervalSeconds(intervalSeconds) }, { allowDirect: false, timeoutMs: 10_000 });
}
export async function releasePublicCycle(owner) {
  if (!owner) return {};
  // Lease release is tiny and idempotent. Keep it on the canonical pooled RPC
  // path even when direct-primary ingestion is enabled so a direct DB problem
  // cannot strand the scheduler behind a long lease.
  return store('release', { owner }, { allowDirect: false, timeoutMs: 2_500 });
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
