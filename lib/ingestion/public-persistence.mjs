const text = (value) => String(value ?? '').trim();
const URL = () => text(process.env.AUTOSCOUT_SUPABASE_URL || process.env.SUPABASE_URL).replace(/\/$/, '');
const KEY = () => text(process.env.AUTOSCOUT_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY);
const TOKEN = () => text(process.env.AUTOSCOUT_SUPABASE_INGEST_TOKEN);
const TRANSIENT_DATA_API_STATUSES = new Set([500, 502, 503, 504]);

function publicIntervalSeconds(value = process.env.AUTOSCOUT_PUBLIC_INGEST_SECONDS) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(300, Math.max(30, Math.floor(n))) : 45;
}

export function publicPersistenceConfigured() {
  return Boolean(URL() && KEY() && TOKEN());
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

async function directStore(functionName, action, payload = {}) {
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
    signal: AbortSignal.timeout(25_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error('PUBLIC_DIRECT_STORE_FAILED'), { code: safeStoreCode(body, response.status), status: response.status });
  return body && typeof body === 'object' ? body : {};
}

async function rpcStore(functionName, action, payload = {}, { allowDirect = true, timeoutMs = 20_000 } = {}) {
  if (!publicPersistenceConfigured()) throw Object.assign(new Error('PUBLIC_STORE_NOT_CONFIGURED'), { code: 'PUBLIC_STORE_NOT_CONFIGURED' });
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
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (allowDirect) return directStore(functionName, action, payload);
    throw Object.assign(new Error('PUBLIC_STORE_FAST_READ_FAILED'), { code: 'PUBLIC_STORE_FAST_READ_FAILED', status: 504, cause: error });
  }
  const body = await response.json().catch(() => null);
  if (!response.ok && TRANSIENT_DATA_API_STATUSES.has(Number(response.status)) && allowDirect) return directStore(functionName, action, payload);
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
  return store('props', { source, observed_at: observedAt, rows: [...unique.values()] });
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
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const result = await historyStore('history', { rows: rows.slice(i, i + 500) });
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
