const text = (value) => String(value ?? '').trim();
const URL = () => text(process.env.AUTOSCOUT_SUPABASE_URL || process.env.SUPABASE_URL).replace(/\/$/, '');
const KEY = () => text(process.env.AUTOSCOUT_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY);
const TOKEN = () => text(process.env.AUTOSCOUT_SUPABASE_INGEST_TOKEN);

export function publicPersistenceConfigured() {
  return Boolean(URL() && KEY() && TOKEN());
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
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error('PUBLIC_STORE_FAILED'), { code: 'PUBLIC_STORE_FAILED', status: response.status });
  return body && typeof body === 'object' ? body : {};
}

export async function claimPublicCycle() {
  return store('claim');
}
export async function releasePublicCycle(owner) {
  if (!owner) return {};
  return store('release', { owner });
}
export async function recordPublicStatus(source, state) {
  return store('status', { source, state });
}
export async function persistPublicSnapshot(source, rows, observedAt = new Date().toISOString()) {
  return store('props', { source, observed_at: observedAt, rows: Array.isArray(rows) ? rows : [] });
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
