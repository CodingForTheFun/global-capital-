import {
  fetchDraftKingsSportsbookPublic as fetchDirectDraftKings,
  draftKingsSportsbookSupportedSports,
} from './draftkings-sportsbook-public.mjs';

const text = (value) => String(value ?? '').trim();
const SUPABASE_URL = text(process.env.AUTOSCOUT_SUPABASE_URL).replace(/\/$/, '');
const ANON_KEY = text(process.env.AUTOSCOUT_SUPABASE_ANON_KEY);
const PROXY_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/autoscout-public-feed-proxy` : '';
const EDGE_SPORTS = new Set(['NFL', 'NBA', 'MLB', 'NHL']);
const edgeCache = new Map();

function leagueFromUrl(value) {
  const match = String(value || '').match(/\/eventgroups\/(\d+)/i);
  return match ? match[1] : '';
}

async function edgeFetcher(url) {
  const leagueId = leagueFromUrl(url);
  if (!PROXY_URL || !ANON_KEY || !leagueId) {
    throw Object.assign(new Error('DRAFTKINGS_EDGE_NOT_CONFIGURED'), { code: 'DRAFTKINGS_EDGE_NOT_CONFIGURED' });
  }
  const hit = edgeCache.get(leagueId);
  if (hit && hit.expires > Date.now()) {
    return new Response(hit.body, { status: hit.status, headers: { 'content-type': hit.contentType } });
  }
  const response = await globalThis.fetch(PROXY_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      apikey: ANON_KEY,
      authorization: `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify({ provider: 'draftkings-v5', leagueId }),
    signal: AbortSignal.timeout(14_000),
  });
  const body = await response.text();
  const contentType = response.headers.get('content-type') || 'application/json';
  edgeCache.set(leagueId, { body, status: response.status, contentType, expires: Date.now() + 30_000 });
  return new Response(body, { status: response.status, headers: { 'content-type': contentType } });
}

export { draftKingsSportsbookSupportedSports };

export async function fetchDraftKingsSportsbookPublic(sport, options = {}) {
  sport = text(sport).toUpperCase();
  if (PROXY_URL && ANON_KEY && EDGE_SPORTS.has(sport)) {
    try {
      const proxied = await fetchDirectDraftKings(sport, { ...options, force: true, fetcher: edgeFetcher });
      return { ...proxied, endpoint: 'autoscout-public-feed-proxy', transport: 'draftkings-supabase-edge-public' };
    } catch (error) {
      error.code = error?.code || 'DRAFTKINGS_EDGE_FAILED';
      throw error;
    }
  }
  return fetchDirectDraftKings(sport, { ...options, force: true });
}
