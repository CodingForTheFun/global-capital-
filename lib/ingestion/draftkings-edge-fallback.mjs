import { ingestionSignal } from './operation-deadline.mjs';
import {
  fetchDraftKingsSportsbookPublic as fetchDirectDraftKings,
  draftKingsSportsbookSupportedSports,
} from './draftkings-sportsbook-public.mjs';
import { fetchDraftKingsSportsContentPublic } from './draftkings-sportscontent-public.mjs';
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
function sportsContentTarget(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.hostname !== 'sportsbook-nash.draftkings.com') return null;
    if (!/\/api\/sportscontent\/controldata\/league\/leagueSubcategory\/v1\/markets$/i.test(url.pathname)) return null;
    const [leagueId = '', subcategoryId = ''] = String(url.searchParams.get('templateVars') || '').split(',').map(text);
    if (!leagueId || !subcategoryId) return null;
    return { leagueId, subcategoryId };
  } catch { return null; }
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
async function proxyRequest(body, timeoutMs = 12_000) {
  if (!PROXY_URL || !ANON_KEY) throw Object.assign(new Error('DRAFTKINGS_EDGE_NOT_CONFIGURED'), { code: 'DRAFTKINGS_EDGE_NOT_CONFIGURED' });
  return globalThis.fetch(PROXY_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', apikey: ANON_KEY, authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify(body),
    signal: ingestionSignal(AbortSignal.timeout(timeoutMs)),
  });
}
async function sportsContentEdgeFetcher(url) {
  const target = sportsContentTarget(url);
  if (!target) throw Object.assign(new Error('DRAFTKINGS_EDGE_SPORTSCONTENT_UNSUPPORTED'), { code: 'DRAFTKINGS_EDGE_SPORTSCONTENT_UNSUPPORTED' });
  const key = `sportscontent:${target.leagueId}:${target.subcategoryId}`;
  const hit = edgeCache.get(key);
  if (hit && hit.expires > Date.now()) return new Response(hit.body, { status: hit.status, headers: { 'content-type': hit.contentType } });
  const response = await proxyRequest({ provider: 'draftkings-sportscontent', ...target }, 14_000);
  const body = await response.text();
  const contentType = response.headers.get('content-type') || 'application/json';
  edgeCache.set(key, { body, status: response.status, contentType, expires: Date.now() + 30_000 });
  return new Response(body, { status: response.status, headers: { 'content-type': contentType } });
}
async function edgeFetcher(url) {
  const leagueId = leagueFromUrl(url);
  if (!leagueId) throw Object.assign(new Error('DRAFTKINGS_EDGE_NOT_CONFIGURED'), { code: 'DRAFTKINGS_EDGE_NOT_CONFIGURED' });
  const key = `v5:${leagueId}`;
  const hit = edgeCache.get(key);
  if (hit && hit.expires > Date.now()) return new Response(hit.body, { status: hit.status, headers: { 'content-type': hit.contentType } });
  const response = await proxyRequest({ provider: 'draftkings-v5', leagueId });
  const body = await response.text();
  const contentType = response.headers.get('content-type') || 'application/json';
  edgeCache.set(key, { body, status: response.status, contentType, expires: Date.now() + 30_000 });
  return new Response(body, { status: response.status, headers: { 'content-type': contentType } });
}

export { draftKingsSportsbookSupportedSports };
export async function fetchDraftKingsSportsbookPublic(sport, options = {}) {
  sport = text(sport).toUpperCase();
  if (!EDGE_SPORTS.has(sport)) return fetchDirectDraftKings(sport, { ...options, force: true });

  // Railway egress is currently Akamai-blocked for DraftKings. When the
  // authenticated edge relay is configured, use it first so a known 403 path
  // cannot burn tens of seconds before every healthy public refresh.
  let modernError = null;
  if (PROXY_URL && ANON_KEY) {
    try {
      const modernEdge = await fetchDraftKingsSportsContentPublic(sport, { ...options, force: true, fetcher: sportsContentEdgeFetcher });
      if (modernEdge?.records?.length) return { ...modernEdge, endpoint: 'autoscout-public-feed-proxy', transport: 'draftkings-sportscontent-supabase-edge' };
    } catch (error) { modernError = error; }
  }
  try {
    const modern = await fetchDraftKingsSportsContentPublic(sport, { ...options, force: true });
    if (modern?.records?.length) return modern;
  } catch (error) { modernError = modernError || error; }
  try {
    const discovered = await fetchDirectDraftKings(sport, { ...options, force: true, fetcher: browserDiscoveryFetcher });
    if (discovered?.records?.length) return { ...discovered, endpoint: 'sportsbook.draftkings.com', transport: 'draftkings-browser-discovery' };
  } catch {}
  if (PROXY_URL && ANON_KEY) {
    try {
      const proxied = await fetchDirectDraftKings(sport, { ...options, force: true, fetcher: edgeFetcher });
      if (proxied?.records?.length) return { ...proxied, endpoint: 'autoscout-public-feed-proxy', transport: 'draftkings-supabase-edge-public' };
    } catch {}
  }
  try { return await fetchDirectDraftKings(sport, { ...options, force: true }); }
  catch (legacyError) { throw modernError || legacyError; }
}
