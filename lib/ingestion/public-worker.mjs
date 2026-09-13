import { publicFeeds } from './public-feeds.mjs';
import { normalizePrizePicks, normalizeUnderdog, normalizedFeedBoard } from './normalize.mjs';
import { normalizeDraftKings } from './draftkings.mjs';
import { fetchUnderdogV2Payload } from './underdog-v2.mjs';
import { browserJsonFetch, browserJsonDiscover } from './browser-json-fetch.mjs';
import { http2JsonFetch } from './http2-json-fetch.mjs';
import {
  claimPublicCycle,
  persistPublicSnapshot,
  publicPersistenceConfigured,
  recordPublicStatus,
  releasePublicCycle,
} from './public-persistence.mjs';

const text = (value) => String(value ?? '').trim();
const SUCCESS = new Set(['available', 'no_props']);
const DK_TTL_MS = 5 * 60_000;
const MAX_PUBLIC_BYTES = 20 * 1024 * 1024;
const PUBLIC_UA = process.env.AUTOSCOUT_PUBLIC_FEED_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const SUPABASE_URL = () => text(process.env.AUTOSCOUT_SUPABASE_URL || process.env.SUPABASE_URL).replace(/\/$/, '');
const INGEST_TOKEN = () => text(process.env.AUTOSCOUT_SUPABASE_INGEST_TOKEN);
const DFS_HTTP2 = Object.freeze({
  prizepicks: { urls: ['https://api.prizepicks.com/projections?per_page=100','https://partner-api.prizepicks.com/projections?per_page=100'] },
  underdog: { urls: ['https://api.underdogfantasy.com/beta/v5/over_under_lines','https://api.underdogfantasy.com/beta/v6/over_under_lines'] },
});
const DFS_BROWSER = Object.freeze({
  prizepicks: {
    landing: 'https://app.prizepicks.com/',
    matches: ['api.prizepicks.com/projections','partner-api.prizepicks.com/projections'],
    fallbackUrls: ['https://partner-api.prizepicks.com/projections?per_page=250','https://api.prizepicks.com/projections?per_page=250'],
    origin: 'https://app.prizepicks.com', referer: 'https://app.prizepicks.com/',
  },
  underdog: {
    landing: 'https://underdogfantasy.com/pick-em/higher-lower/all',
    matches: ['/over_under_lines'],
    fallbackUrls: ['https://api.underdogfantasy.com/beta/v6/over_under_lines','https://api.underdogfantasy.com/beta/v5/over_under_lines'],
    origin: 'https://underdogfantasy.com', referer: 'https://underdogfantasy.com/',
  },
});
const DRAFTKINGS_GROUPS = Object.freeze({
  NFL: text(process.env.AUTOSCOUT_DRAFTKINGS_NFL_GROUP || '88808'),
  NBA: text(process.env.AUTOSCOUT_DRAFTKINGS_NBA_GROUP || '42648'),
  MLB: text(process.env.AUTOSCOUT_DRAFTKINGS_MLB_GROUP || '84240'),
});

function enabled(name, fallback = true) {
  const value = text(process.env[name]).toLowerCase();
  if (!value) return fallback;
  return !['0', 'false', 'no', 'off'].includes(value);
}

export function publicWorkerConfigured() {
  return publicPersistenceConfigured() && enabled('AUTOSCOUT_PUBLIC_INGEST_ENABLED', true);
}

async function edgePublicFetch(source, sport = '') {
  if (!SUPABASE_URL() || !INGEST_TOKEN() || !enabled('AUTOSCOUT_PUBLIC_EDGE_FALLBACK', true)) throw Object.assign(new Error('PUBLIC_EDGE_NOT_CONFIGURED'), { code: 'PUBLIC_EDGE_NOT_CONFIGURED' });
  const url = new URL(`${SUPABASE_URL()}/functions/v1/autoscout-public-feed`);
  url.searchParams.set('source', source);
  if (sport) url.searchParams.set('sport', sport);
  const response = await fetch(url, { headers: { accept: 'application/json', 'x-autoscout-ingest-token': INGEST_TOKEN() }, signal: AbortSignal.timeout(25_000) });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok !== true || !body?.data) {
    const attempt = Array.isArray(body?.attempts) ? body.attempts.at(-1) : null;
    throw Object.assign(new Error(text(body?.code || 'PUBLIC_EDGE_FAILED')), { code: text(body?.code || 'PUBLIC_EDGE_FAILED'), status: Number(attempt?.status || response.status) || null });
  }
  return body;
}

async function fetchJson(fetcher, url) {
  const response = await fetcher(url, {
    headers: { accept: 'application/json,text/plain,*/*', 'user-agent': PUBLIC_UA, 'accept-language': 'en-US,en;q=0.9' },
    redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    if ([403, 426].includes(response.status) && enabled('AUTOSCOUT_PUBLIC_BROWSER_FALLBACK', true)) {
      return browserJsonFetch(url, { origin: 'https://sportsbook.draftkings.com', referer: 'https://sportsbook.draftkings.com/' });
    }
    throw Object.assign(new Error('PUBLIC_SPORTSBOOK_HTTP'), { code: 'PUBLIC_SPORTSBOOK_HTTP', status: response.status });
  }
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_PUBLIC_BYTES) throw Object.assign(new Error('PUBLIC_SPORTSBOOK_TOO_LARGE'), { code: 'PUBLIC_SPORTSBOOK_TOO_LARGE' });
  const reader = response.body?.getReader();
  if (!reader) return response.json();
  let total = 0; const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > MAX_PUBLIC_BYTES) throw Object.assign(new Error('PUBLIC_SPORTSBOOK_TOO_LARGE'), { code: 'PUBLIC_SPORTSBOOK_TOO_LARGE' });
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function draftKingsUrl(sport) {
  const group = DRAFTKINGS_GROUPS[sport];
  return group ? `https://sportsbook-nash.draftkings.com/sites/US-SB/api/v5/eventgroups/${encodeURIComponent(group)}?format=json` : null;
}
function validDraftKingsDocument(payload) {
  const group = payload?.eventGroup;
  return Boolean(group && Array.isArray(group.events) && Array.isArray(group.offerCategories));
}
function publicRows(records, observedAt) {
  return normalizedFeedBoard(Array.isArray(records) ? records : [], { props: [] }, observedAt).props;
}

async function http2PrizePicks(url) {
  const root = new URL(url);
  let current = root.href;
  let combined = null;
  const seen = new Set();
  for (let page = 0; page < 30; page++) {
    if (seen.has(current)) throw Object.assign(new Error('PRIZEPICKS_PAGINATION_LOOP'), { code: 'PRIZEPICKS_PAGINATION_LOOP' });
    seen.add(current);
    const data = await http2JsonFetch(current);
    if (!Array.isArray(data?.data) || !Array.isArray(data?.included)) throw Object.assign(new Error('INVALID_PRIZEPICKS_SCHEMA'), { code: 'INVALID_PRIZEPICKS_SCHEMA' });
    combined = combined ? {
      ...data,
      data: [...combined.data, ...data.data],
      included: [...new Map([...combined.included, ...data.included].map((row) => [`${row.type}:${row.id}`, row])).values()],
    } : data;
    const next = typeof data.links?.next === 'string' ? data.links.next : data.links?.next?.href;
    if (!next) return combined;
    const target = new URL(next, current);
    if (target.origin !== root.origin || target.pathname !== root.pathname) throw Object.assign(new Error('PRIZEPICKS_BAD_NEXT'), { code: 'PRIZEPICKS_BAD_NEXT' });
    current = target.href;
  }
  throw Object.assign(new Error('PRIZEPICKS_TOO_MANY_PAGES'), { code: 'PRIZEPICKS_TOO_MANY_PAGES' });
}

export function createPublicIngestionRunner({ now = Date.now, fetcher = globalThis.fetch, feeds = publicFeeds, claim = claimPublicCycle, release = releasePublicCycle, persistSnapshot = persistPublicSnapshot, recordStatus = recordPublicStatus } = {}) {
  const draftKingsNextAt = new Map();
  async function status(source, state) { try { await recordStatus(source, state); } catch {} }

  async function http2DfsSnapshot(source) {
    const config = DFS_HTTP2[source]; if (!config) return null;
    let lastError = null;
    if (source === 'underdog') {
      try {
        const payload = await fetchUnderdogV2Payload();
        const records = normalizeUnderdog(payload);
        const fetchedAt = new Date(now()).toISOString();
        return { status: records.length ? 'available' : 'no_props', records, fetchedAt, partial: false, httpStatus: 200, endpoint: 'api.underdogfantasy.com/v2', transport: 'http2-v2-public' };
      } catch (error) { lastError = error; }
    }
    for (const url of config.urls) {
      try {
        const payload = source === 'prizepicks' ? await http2PrizePicks(url) : await http2JsonFetch(url);
        const records = source === 'prizepicks' ? normalizePrizePicks(payload) : normalizeUnderdog(payload);
        const fetchedAt = new Date(now()).toISOString();
        return { status: records.length ? 'available' : 'no_props', records, fetchedAt, partial: false, httpStatus: 200, endpoint: new URL(url).host, transport: 'http2-public' };
      } catch (error) { lastError = error; }
    }
    throw lastError || Object.assign(new Error('PUBLIC_HTTP2_FAILED'), { code: 'PUBLIC_HTTP2_FAILED' });
  }

  async function browserDfsSnapshot(source) {
    if (!enabled('AUTOSCOUT_PUBLIC_BROWSER_FALLBACK', true)) return null;
    const config = DFS_BROWSER[source]; if (!config) return null;
    let payload = null, endpoint = null, transport = 'browser-network', lastError = null;
    try {
      const captured = await browserJsonDiscover(config.landing, { urlIncludes: config.matches, timeoutMs: 25_000 });
      payload = captured.data; endpoint = new URL(captured.url).host;
    } catch (error) { lastError = error; }
    if (!payload) {
      for (const url of config.fallbackUrls) {
        try {
          payload = await browserJsonFetch(url, { origin: config.origin, referer: config.referer, timeoutMs: 20_000 });
          endpoint = new URL(url).host; transport = 'browser-direct'; break;
        } catch (error) { lastError = error; }
      }
    }
    if (!payload) throw lastError || Object.assign(new Error('PUBLIC_BROWSER_FAILED'), { code: 'PUBLIC_BROWSER_FAILED' });
    const records = source === 'prizepicks' ? normalizePrizePicks(payload) : normalizeUnderdog(payload);
    const fetchedAt = new Date(now()).toISOString();
    return { status: records.length ? 'available' : 'no_props', records, fetchedAt, partial: false, httpStatus: 200, endpoint, transport };
  }

  async function edgeDfsSnapshot(source) {
    const result = await edgePublicFetch(source);
    const records = source === 'prizepicks' ? normalizePrizePicks(result.data) : normalizeUnderdog(result.data);
    const fetchedAt = new Date(now()).toISOString();
    return { status: records.length ? 'available' : 'no_props', records, fetchedAt, partial: false, httpStatus: 200, endpoint: result.endpoint || 'supabase-edge', transport: 'supabase-edge-public' };
  }

  async function ingestDfs(source) {
    try {
      let snapshot = await feeds.refreshFeed(source);
      const blocked = () => (!snapshot || !SUCCESS.has(snapshot.status) || snapshot.partial) && [0, 403, 426].includes(Number(snapshot?.httpStatus || 0));
      if (blocked()) {
        try { snapshot = await http2DfsSnapshot(source) || snapshot; }
        catch (error) { await status(source, { status: 'unavailable', retained: true, transport: 'http2-public', code: text(error?.code || 'PUBLIC_HTTP2_FAILED').slice(0,80), httpStatus: Number(error?.status) || null }); }
      }
      if (blocked()) {
        try { snapshot = await browserDfsSnapshot(source) || snapshot; }
        catch (error) { await status(source, { status: 'unavailable', retained: true, transport: 'browser-public', code: text(error?.code || 'PUBLIC_BROWSER_FAILED').slice(0,80), httpStatus: Number(error?.status) || null }); }
      }
      if (!snapshot || !SUCCESS.has(snapshot.status) || snapshot.partial) {
        try { snapshot = await edgeDfsSnapshot(source); }
        catch (error) { await status(source, { status: 'unavailable', retained: true, transport: 'supabase-edge-public', code: text(error?.code || 'PUBLIC_EDGE_FAILED').slice(0,80), httpStatus: Number(error?.status) || null }); }
      }
      if (!snapshot || !SUCCESS.has(snapshot.status) || snapshot.partial) {
        await status(source, { status: snapshot?.partial ? 'partial' : snapshot?.status || 'unavailable', retained: true, fetchedAt: snapshot?.fetchedAt || null, httpStatus: snapshot?.httpStatus ?? null, endpoint: snapshot?.endpoint || null });
        return { source, persisted: false, retained: true, httpStatus: snapshot?.httpStatus ?? null, endpoint: snapshot?.endpoint || null };
      }
      const observedAt = snapshot.fetchedAt, observedMs = Date.parse(observedAt || '');
      if (!Number.isFinite(observedMs) || now() - observedMs > 5 * 60_000) {
        await status(source, { status: 'stale', retained: true, fetchedAt: observedAt || null });
        return { source, persisted: false, retained: true };
      }
      const rows = publicRows(snapshot.records, observedAt).filter((row) => row.sportsbookKey === source && row.isAlternate === false);
      const result = await persistSnapshot(source, rows, observedAt);
      await status(source, { status: snapshot.status, rows: rows.length, fetchedAt: observedAt, written: Number(result?.written || 0), endpoint: snapshot.endpoint || null, transport: snapshot.transport || 'direct-public' });
      return { source, persisted: true, rows: rows.length, written: Number(result?.written || 0), endpoint: snapshot.endpoint || null, transport: snapshot.transport || 'direct-public' };
    } catch (error) {
      await status(source, { status: 'unavailable', retained: true, code: text(error?.code || 'PUBLIC_INGEST_FAILED').slice(0,80), httpStatus: Number(error?.status) || null });
      return { source, persisted: false, retained: true, code: text(error?.code || 'PUBLIC_INGEST_FAILED'), httpStatus: Number(error?.status) || null };
    }
  }

  async function draftKingsPayload(sport) {
    const url = draftKingsUrl(sport); if (!url) throw Object.assign(new Error('NO_DRAFTKINGS_URL'), { code: 'NO_DRAFTKINGS_URL' });
    try { return { data: await fetchJson(fetcher, url), transport: 'direct-public', endpoint: new URL(url).host }; }
    catch (directError) {
      try { const edge = await edgePublicFetch('draftkings', sport); return { data: edge.data, transport: 'supabase-edge-public', endpoint: edge.endpoint || 'supabase-edge' }; }
      catch (edgeError) { throw Object.assign(edgeError, { directCode: text(directError?.code || directError?.message) }); }
    }
  }

  async function ingestDraftKings(sport) {
    const source = `draftkings:${sport}`, nextAt = draftKingsNextAt.get(sport) || 0;
    if (nextAt > now()) return { source, skipped: true };
    draftKingsNextAt.set(sport, now() + DK_TTL_MS);
    try {
      const fetched = await draftKingsPayload(sport);
      if (!validDraftKingsDocument(fetched.data)) throw Object.assign(new Error('INVALID_DRAFTKINGS_SCHEMA'), { code: 'INVALID_DRAFTKINGS_SCHEMA' });
      const observedAt = new Date(now()).toISOString(), records = normalizeDraftKings(fetched.data, sport);
      const rows = publicRows(records, observedAt).filter((row) => row.sportsbookKey === 'draftkings' && row.isAlternate === false);
      const result = await persistSnapshot(source, rows, observedAt);
      await status(source, { status: rows.length ? 'available' : 'no_props', rows: rows.length, fetchedAt: observedAt, written: Number(result?.written || 0), transport: fetched.transport, endpoint: fetched.endpoint });
      return { source, persisted: true, rows: rows.length, written: Number(result?.written || 0), transport: fetched.transport, endpoint: fetched.endpoint };
    } catch (error) {
      await status(source, { status: 'unavailable', retained: true, code: text(error?.code || 'DRAFTKINGS_INGEST_FAILED').slice(0,80), httpStatus: Number(error?.status) || null });
      return { source, persisted: false, retained: true, code: text(error?.code || 'DRAFTKINGS_INGEST_FAILED'), httpStatus: Number(error?.status) || null };
    }
  }

  async function cycle() {
    const lease = await claim(); if (!lease?.claimed || !lease.owner) return { claimed: false, results: [] };
    const results = [];
    try {
      for (const source of ['prizepicks','underdog']) results.push(await ingestDfs(source));
      if (enabled('AUTOSCOUT_DRAFTKINGS_PUBLIC_ENABLED', true)) for (const sport of ['NFL','NBA','MLB']) results.push(await ingestDraftKings(sport));
      return { claimed: true, results };
    } finally { await release(lease.owner).catch(() => {}); }
  }
  return { cycle };
}

const runner = createPublicIngestionRunner();
export async function runPublicIngestionCycle() {
  if (!publicWorkerConfigured()) return { configured: false, claimed: false, results: [] };
  return runner.cycle();
}
