import { publicFeeds } from './public-feeds.mjs';
import { normalizePrizePicks, normalizeUnderdog, normalizedFeedBoard } from './normalize.mjs';
import { normalizeDraftKings } from './draftkings.mjs';
import { browserJsonFetch } from './browser-json-fetch.mjs';
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
const UNDERDOG_CLIENT_VERSION = process.env.AUTOSCOUT_UNDERDOG_CLIENT_VERSION || '2026.09.01';
const PP_DEVICE_ID = process.env.AUTOSCOUT_PRIZEPICKS_DEVICE_ID || 'autoscout-public-web';
const DFS_HTTP2 = Object.freeze({
  prizepicks: { url: 'https://api.prizepicks.com/projections?per_page=250' },
  underdog: { url: 'https://api.underdogfantasy.com/beta/v6/over_under_lines' },
});
const DFS_BROWSER = Object.freeze({
  prizepicks: {
    url: 'https://partner-api.prizepicks.com/projections?per_page=250',
    origin: 'https://app.prizepicks.com',
    referer: 'https://app.prizepicks.com/',
    headers: {
      'x-device-id': PP_DEVICE_ID,
      'x-device-info': 'name=,os=windows,osVersion=Windows NT 10.0; Win64; x64,isSimulator=false,platform=web,appVersion=web',
    },
  },
  underdog: {
    url: 'https://api.underdogfantasy.com/beta/v6/over_under_lines',
    origin: 'https://underdogfantasy.com',
    referer: 'https://underdogfantasy.com/',
    headers: { 'client-type': 'web', 'client-version': UNDERDOG_CLIENT_VERSION },
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

async function fetchJson(fetcher, url) {
  const response = await fetcher(url, {
    headers: { accept: 'application/json,text/plain,*/*', 'user-agent': PUBLIC_UA, 'accept-language': 'en-US,en;q=0.9' },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    if ([403, 426].includes(response.status) && enabled('AUTOSCOUT_PUBLIC_BROWSER_FALLBACK', true)) {
      return browserJsonFetch(url, {
        origin: 'https://sportsbook.draftkings.com',
        referer: 'https://sportsbook.draftkings.com/',
      });
    }
    throw Object.assign(new Error('PUBLIC_SPORTSBOOK_HTTP'), { code: 'PUBLIC_SPORTSBOOK_HTTP', status: response.status });
  }
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_PUBLIC_BYTES) throw Object.assign(new Error('PUBLIC_SPORTSBOOK_TOO_LARGE'), { code: 'PUBLIC_SPORTSBOOK_TOO_LARGE' });
  const reader = response.body?.getReader();
  if (!reader) return response.json();
  let total = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PUBLIC_BYTES) throw Object.assign(new Error('PUBLIC_SPORTSBOOK_TOO_LARGE'), { code: 'PUBLIC_SPORTSBOOK_TOO_LARGE' });
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
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

export function createPublicIngestionRunner({
  now = Date.now,
  fetcher = globalThis.fetch,
  feeds = publicFeeds,
  claim = claimPublicCycle,
  release = releasePublicCycle,
  persistSnapshot = persistPublicSnapshot,
  recordStatus = recordPublicStatus,
} = {}) {
  const draftKingsNextAt = new Map();

  async function status(source, state) {
    try { await recordStatus(source, state); } catch {}
  }

  async function http2DfsSnapshot(source) {
    const config = DFS_HTTP2[source];
    if (!config) return null;
    const payload = await http2JsonFetch(config.url);
    const records = source === 'prizepicks' ? normalizePrizePicks(payload) : normalizeUnderdog(payload);
    const fetchedAt = new Date(now()).toISOString();
    return {
      status: records.length ? 'available' : 'no_props',
      records,
      fetchedAt,
      partial: false,
      httpStatus: 200,
      endpoint: new URL(config.url).host,
      transport: 'http2-public',
    };
  }

  async function browserDfsSnapshot(source) {
    if (!enabled('AUTOSCOUT_PUBLIC_BROWSER_FALLBACK', true)) return null;
    const config = DFS_BROWSER[source];
    if (!config) return null;
    const payload = await browserJsonFetch(config.url, { origin: config.origin, referer: config.referer, headers: config.headers || {} });
    const records = source === 'prizepicks' ? normalizePrizePicks(payload) : normalizeUnderdog(payload);
    const fetchedAt = new Date(now()).toISOString();
    return {
      status: records.length ? 'available' : 'no_props',
      records,
      fetchedAt,
      partial: false,
      httpStatus: 200,
      endpoint: new URL(config.url).host,
      transport: 'browser-public',
    };
  }

  async function ingestDfs(source) {
    try {
      let snapshot = await feeds.refreshFeed(source);
      const blocked = () => (!snapshot || !SUCCESS.has(snapshot.status) || snapshot.partial) && [0, 403, 426].includes(Number(snapshot?.httpStatus || 0));
      if (blocked()) {
        try {
          snapshot = await http2DfsSnapshot(source) || snapshot;
        } catch (error) {
          await status(source, { status: 'unavailable', retained: true, transport: 'http2-public', code: text(error?.code || 'PUBLIC_HTTP2_FAILED').slice(0, 80), httpStatus: Number(error?.status) || null });
        }
      }
      if (blocked()) {
        try {
          snapshot = await browserDfsSnapshot(source) || snapshot;
        } catch (error) {
          await status(source, { status: 'unavailable', retained: true, transport: 'browser-public', code: text(error?.code || 'PUBLIC_BROWSER_FAILED').slice(0, 80), httpStatus: Number(error?.status) || null });
        }
      }
      if (!snapshot || !SUCCESS.has(snapshot.status) || snapshot.partial) {
        await status(source, { status: snapshot?.partial ? 'partial' : snapshot?.status || 'unavailable', retained: true, fetchedAt: snapshot?.fetchedAt || null, httpStatus: snapshot?.httpStatus ?? null, endpoint: snapshot?.endpoint || null });
        return { source, persisted: false, retained: true, httpStatus: snapshot?.httpStatus ?? null, endpoint: snapshot?.endpoint || null };
      }
      const observedAt = snapshot.fetchedAt;
      const observedMs = Date.parse(observedAt || '');
      if (!Number.isFinite(observedMs) || now() - observedMs > 5 * 60_000) {
        await status(source, { status: 'stale', retained: true, fetchedAt: observedAt || null });
        return { source, persisted: false, retained: true };
      }
      const rows = publicRows(snapshot.records, observedAt).filter((row) => row.sportsbookKey === source && row.isAlternate === false);
      const result = await persistSnapshot(source, rows, observedAt);
      await status(source, { status: snapshot.status, rows: rows.length, fetchedAt: observedAt, written: Number(result?.written || 0), endpoint: snapshot.endpoint || null, transport: snapshot.transport || 'direct-public' });
      return { source, persisted: true, rows: rows.length, written: Number(result?.written || 0), endpoint: snapshot.endpoint || null, transport: snapshot.transport || 'direct-public' };
    } catch (error) {
      await status(source, { status: 'unavailable', retained: true, code: text(error?.code || 'PUBLIC_INGEST_FAILED').slice(0, 80), httpStatus: Number(error?.status) || null });
      return { source, persisted: false, retained: true, code: text(error?.code || 'PUBLIC_INGEST_FAILED'), httpStatus: Number(error?.status) || null };
    }
  }

  async function ingestDraftKings(sport) {
    const source = `draftkings:${sport}`;
    const nextAt = draftKingsNextAt.get(sport) || 0;
    if (nextAt > now()) return { source, skipped: true };
    draftKingsNextAt.set(sport, now() + DK_TTL_MS);
    const url = draftKingsUrl(sport);
    if (!url) return { source, skipped: true };
    try {
      const payload = await fetchJson(fetcher, url);
      if (!validDraftKingsDocument(payload)) throw Object.assign(new Error('INVALID_DRAFTKINGS_SCHEMA'), { code: 'INVALID_DRAFTKINGS_SCHEMA' });
      const observedAt = new Date(now()).toISOString();
      const records = normalizeDraftKings(payload, sport);
      const rows = publicRows(records, observedAt).filter((row) => row.sportsbookKey === 'draftkings' && row.isAlternate === false);
      const result = await persistSnapshot(source, rows, observedAt);
      await status(source, { status: rows.length ? 'available' : 'no_props', rows: rows.length, fetchedAt: observedAt, written: Number(result?.written || 0) });
      return { source, persisted: true, rows: rows.length, written: Number(result?.written || 0) };
    } catch (error) {
      await status(source, { status: 'unavailable', retained: true, code: text(error?.code || 'DRAFTKINGS_INGEST_FAILED').slice(0, 80), httpStatus: Number(error?.status) || null });
      return { source, persisted: false, retained: true, code: text(error?.code || 'DRAFTKINGS_INGEST_FAILED'), httpStatus: Number(error?.status) || null };
    }
  }

  async function cycle() {
    const lease = await claim();
    if (!lease?.claimed || !lease.owner) return { claimed: false, results: [] };
    const results = [];
    try {
      for (const source of ['prizepicks', 'underdog']) results.push(await ingestDfs(source));
      if (enabled('AUTOSCOUT_DRAFTKINGS_PUBLIC_ENABLED', true)) {
        for (const sport of ['NFL', 'NBA', 'MLB']) results.push(await ingestDraftKings(sport));
      }
      return { claimed: true, results };
    } finally {
      await release(lease.owner).catch(() => {});
    }
  }

  return { cycle };
}

const runner = createPublicIngestionRunner();
export async function runPublicIngestionCycle() {
  if (!publicWorkerConfigured()) return { configured: false, claimed: false, results: [] };
  return runner.cycle();
}
