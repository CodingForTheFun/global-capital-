const text = (value) => String(value ?? '').trim();
const URL = () => text(process.env.AUTOSCOUT_SUPABASE_URL || process.env.SUPABASE_URL).replace(/\/$/, '');
const KEY = () => text(process.env.AUTOSCOUT_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY);
const TOKEN = () => text(process.env.AUTOSCOUT_SUPABASE_INGEST_TOKEN);

export async function readPublicSchedulerState() {
  if (!URL() || !KEY() || !TOKEN()) return null;
  try {
    const response = await fetch(`${URL()}/rest/v1/rpc/autoscout_public_scheduler_state`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        apikey: KEY(),
        authorization: `Bearer ${KEY()}`,
      },
      body: JSON.stringify({ p_token: TOKEN() }),
      signal: AbortSignal.timeout(2_500),
    });
    if (!response.ok) return null;
    const body = await response.json().catch(() => null);
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  }
}
