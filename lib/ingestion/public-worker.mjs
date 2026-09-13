import { publicFeeds } from './public-feeds.mjs';
import { normalizedFeedBoard } from './normalize.mjs';
import { normalizeDraftKings } from './draftkings.mjs';
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
const PUBLIC_UA = process.env.AUTOSCOUT_PUBLIC_FEED_USER_AGENT || 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1';
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
  if (!response.ok) throw Object.assign(new Error('PUBLIC_SPORTSBOOK_HTTP'), { code: 'PUBLIC_SPORTSBOOK_HTTP', status: response.status });
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

  async function ingestDfs(source) {
    try {
      const snapshot = await feeds.refreshFeed(source);
      if (!snapshot || !SUCCESS.has(snapshot.status) || snapshot.partial) {
        await status(source, { status: snapshot?.partial ? 'partial' : snapshot?.status || 'unavailable', retained: true, fetchedAt: snapshot?.fetchedAt || null });
        return { source, persisted: false, retained: true };
      }
      const observedAt = snapshot.fetchedAt;
      const observedMs = Date.parse(observedAt || '');
      if (!Number.isFinite(observedMs) || now() - observedMs > 5 * 60_000) {
        await status(source, { status: 'stale', retained: true, fetchedAt: observedAt || null });
        return { source, persisted: false, retained: true };
      }
      const rows = publicRows(snapshot.records, observedAt).filter((row) => row.sportsbookKey === source && row.isAlternate === false);
      const result = await persistSnapshot(source, rows, observedAt);
      await status(source, { status: snapshot.status, rows: rows.length, fetchedAt: observedAt, written: Number(result?.written || 0) });
      return { source, persisted: true, rows: rows.length, written: Number(result?.written || 0) };
    } catch (error) {
      await status(source, { status: 'unavailable', retained: true, code: text(error?.code || 'PUBLIC_INGEST_FAILED').slice(0, 80) });
      return { source, persisted: false, retained: true, code: text(error?.code || 'PUBLIC_INGEST_FAILED') };
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
      // Changed/failed unofficial documents never replace the last good snapshot.
      await status(source, { status: 'unavailable', retained: true, code: text(error?.code || 'DRAFTKINGS_INGEST_FAILED').slice(0, 80) });
      return { source, persisted: false, retained: true, code: text(error?.code || 'DRAFTKINGS_INGEST_FAILED') };
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
