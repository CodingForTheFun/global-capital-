import {
  fetchBetMgmPublic as fetchDirectBetMgm,
  betMgmSupportedSports,
} from './betmgm-public.mjs';

const text = (value) => String(value ?? '').trim();
const SUPABASE_URL = text(process.env.AUTOSCOUT_SUPABASE_URL).replace(/\/$/, '');
const ANON_KEY = text(process.env.AUTOSCOUT_SUPABASE_ANON_KEY);
const PROXY_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/autoscout-public-feed-proxy` : '';
const cache = new Map();

async function edgeFetcher(url) {
  if (!PROXY_URL || !ANON_KEY) throw Object.assign(new Error('BETMGM_EDGE_NOT_CONFIGURED'), { code: 'BETMGM_EDGE_NOT_CONFIGURED' });
  const target = String(url || '');
  const hit = cache.get(target);
  if (hit && hit.expires > Date.now()) return new Response(hit.body, { status: hit.status, headers: { 'content-type': hit.contentType } });
  const response = await globalThis.fetch(PROXY_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', apikey: ANON_KEY, authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify({ provider: 'betmgm-url', url: target }),
    signal: AbortSignal.timeout(14_000),
  });
  const body = await response.text();
  const contentType = response.headers.get('content-type') || 'application/json';
  cache.set(target, { body, status: response.status, contentType, expires: Date.now() + 30_000 });
  return new Response(body, { status: response.status, headers: { 'content-type': contentType } });
}

export { betMgmSupportedSports };
export async function fetchBetMgmPublic(sport, options = {}) {
  let direct = null;
  let directError = null;
  try {
    direct = await fetchDirectBetMgm(sport, { ...options, force: true });
    if (direct?.records?.length) return direct;
  } catch (error) { directError = error; }

  if (PROXY_URL && ANON_KEY) {
    try {
      const proxied = await fetchDirectBetMgm(sport, { ...options, force: true, fetcher: edgeFetcher });
      if (proxied?.records?.length) {
        return { ...proxied, endpoint: 'autoscout-public-feed-proxy', transport: 'betmgm-supabase-edge-public' };
      }
      if (!direct) direct = proxied;
    } catch (error) {
      if (!directError) directError = error;
    }
  }

  if (direct) return direct;
  throw directError || Object.assign(new Error('BETMGM_PUBLIC_FAILED'), { code: 'BETMGM_PUBLIC_FAILED' });
}
