const text = (value) => String(value ?? '').trim();
const URL = () => text(process.env.AUTOSCOUT_SUPABASE_URL || process.env.SUPABASE_URL).replace(/\/$/, '');
const KEY = () => text(process.env.AUTOSCOUT_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY);
const TOKEN = () => text(process.env.AUTOSCOUT_SUPABASE_INGEST_TOKEN);

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

async function store(action, payload = {}) {
  if (!publicPersistenceConfigured()) throw Object.assign(new Error('PUBLIC_STORE_NOT_CONFIGURED'), { code: 'PUBLIC_STORE_NOT_CONFIGURED' });
  const response = await fetch(`${URL()}/rest/v1/rpc/autoscout_public_store`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      apikey: KEY(),
      authorization: `Bearer ${KEY()}`,
    },
    body: JSON.stringify({ p_token: TOKEN(), p_action: action, p_payload: payload }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error('PUBLIC_STORE_FAILED'), { code: safeStoreCode(body, response.status), status: response.status });
  return body && typeof body === 'object' ? body : {};
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
  const result = await store('read_props', { sport: text(sport).toUpperCase() });
  return Array.isArray(result?.rows) ? result.rows : [];
}
export async function persistGameLogs(rows) {
  if (!Array.isArray(rows) || !rows.length) return { written: 0 };
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const result = await store('history', { rows: rows.slice(i, i + 500) });
    written += Number(result?.written || 0);
  }
  return { written };
}
export async function historyCandidates() {
  const result = await store('history_candidates');
  return Array.isArray(result?.rows) ? result.rows : [];
}
export async function readGameLogs(playerId) {
  const result = await store('read_history', { player_id: text(playerId) });
  return Array.isArray(result?.rows) ? result.rows : [];
}
