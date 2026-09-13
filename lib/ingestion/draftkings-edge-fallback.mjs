import {
  fetchDraftKingsSportsbookPublic as fetchDirectDraftKings,
  draftKingsSportsbookSupportedSports,
} from './draftkings-sportsbook-public.mjs';
import { browserJsonDiscover } from './browser-json-fetch.mjs';

const text = (value) => String(value ?? '').trim();
const SUPABASE_URL = text(process.env.AUTOSCOUT_SUPABASE_URL).replace(/\/$/, '');
const ANON_KEY = text(process.env.AUTOSCOUT_SUPABASE_ANON_KEY);
const PROXY_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/autoscout-public-feed-proxy` : '';
const EDGE_SPORTS = new Set(['NFL', 'NBA', 'MLB', 'NHL']);
const LANDING = Object.freeze({
  '88808': 'https://sportsbook.draftkings.com/leagues/football/nfl',
  '42648': 'https://sportsbook.draftkings.com/leagues/basketball/nba',
  '84240': 'https://sportsbook.draftkings.com/leagues/baseball/mlb',
  '42133': 'https://sportsbook.draftkings.com/leagues/hockey/nhl',
});
const browserCache = new Map();
const edgeCache = new Map();

function leagueFromUrl(value) {
  const match = String(value || '').match(/\/eventgroups\/(\d+)/i);
  return match ? match[1] : '';
}
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}
async function browserDiscoveryFetcher(url) {
  const leagueId = leagueFromUrl(url);
  const landing = LANDING[leagueId];
  if (!landing) throw Object.assign(new Error('DRAFTKINGS_BROWSER_UNSUPPORTED'), { code: 'DRAFTKINGS_BROWSER_UNSUPPORTED' });
  const hit = browserCache.get(leagueId);
  if (hit && hit.expires > Date.now()) return jsonResponse(hit.data);
  const captured = await browserJsonDiscover(landing, { urlIncludes: [`eventgroups/${leagueId}`], timeoutMs: 18_000 });
  browserCache.set(leagueId, { data: captured.data, expires: Date.now() + 3 * 60_000 });
  return jsonResponse(captured.data);
}
async function edgeFetcher(url) {
  const leagueId = leagueFromUrl(url);
  if (!PROXY_URL || !ANON_KEY || !leagueId) throw Object.assign(new Error('DRAFTKINGS_EDGE_NOT_CONFIGURED'), { code: 'DRAFTKINGS_EDGE_NOT_CONFIGURED' });
  const hit = edgeCache.get(leagueId);
  if (hit && hit.expires > Date.now()) return new Response(hit.body, { status: hit.status, headers: { 'content-type': hit.contentType } });
  const response = await globalThis.fetch(PROXY_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', apikey: ANON_KEY, authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify({ provider: 'draftkings-v5', leagueId }),
    signal: AbortSignal.timeout(12_000),
  });
  const body = await response.text();
  const contentType = response.headers.get('content-type') || 'application/json';
  edgeCache.set(leagueId, { body, status: response.status, contentType, expires: Date.now() + 30_000 });
  return new Response(body, { status: response.status, headers: { 'content-type': contentType } });
}

export { draftKingsSportsbookSupportedSports };
export async function fetchDraftKingsSportsbookPublic(sport, options = {}) {
  sport = text(sport).toUpperCase();
  if (!EDGE_SPORTS.has(sport)) return fetchDirectDraftKings(sport, { ...options, force: true });
  try {
    const discovered = await fetchDirectDraftKings(sport, { ...options, force: true, fetcher: browserDiscoveryFetcher });
    if (discovered?.records?.length) return { ...discovered, endpoint: 'sportsbook.draftkings.com', transport: 'draftkings-browser-discovery' };
  } catch {}
  if (PROXY_URL && ANON_KEY) {
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
