import {
  fetchDraftKingsSportsbookPublic as fetchDirectDraftKings,
  draftKingsSportsbookSupportedSports,
} from './draftkings-sportsbook-public.mjs';

const text = (value) => String(value ?? '').trim();
const SUPABASE_URL = text(process.env.AUTOSCOUT_SUPABASE_URL).replace(/\/$/, '');
const ANON_KEY = text(process.env.AUTOSCOUT_SUPABASE_ANON_KEY);
const PROXY_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/autoscout-public-feed-proxy` : '';

function leagueFromUrl(value) {
  const match = String(value || '').match(/\/eventgroups\/(\d+)/i);
  return match ? match[1] : '';
}

async function edgeFetcher(url, options = {}) {
  const leagueId = leagueFromUrl(url);
  if (!PROXY_URL || !ANON_KEY || !leagueId) {
    throw Object.assign(new Error('DRAFTKINGS_EDGE_NOT_CONFIGURED'), { code: 'DRAFTKINGS_EDGE_NOT_CONFIGURED' });
  }
  return globalThis.fetch(PROXY_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      apikey: ANON_KEY,
      authorization: `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify({ provider: 'draftkings-v5', leagueId }),
    signal: options.signal || AbortSignal.timeout(18_000),
  });
}

export { draftKingsSportsbookSupportedSports };

export async function fetchDraftKingsSportsbookPublic(sport, options = {}) {
  try {
    const direct = await fetchDirectDraftKings(sport, { ...options, force: true });
    if (direct?.records?.length) return direct;
    if (!PROXY_URL || !ANON_KEY) return direct;
  } catch (error) {
    if (!PROXY_URL || !ANON_KEY) throw error;
  }

  try {
    const proxied = await fetchDirectDraftKings(sport, {
      ...options,
      force: true,
      fetcher: edgeFetcher,
    });
    return {
      ...proxied,
      endpoint: 'autoscout-public-feed-proxy',
      transport: 'draftkings-supabase-edge-public',
    };
  } catch (proxyError) {
    proxyError.code = proxyError?.code || 'DRAFTKINGS_EDGE_FAILED';
    throw proxyError;
  }
}
