// Runtime entitlement discovery.
//
// Which feeds a key can reach depends on the subscription, and only the live
// API knows. Rather than hard-coding an assumption, Scout Pro probes each feed
// once, classifies the response, and caches a capability matrix. Everything
// downstream — filters offered, score factors used, diagnostics shown — is
// driven by that matrix, so Scout Pro dynamically understands what it has.
//
// Classification:
//   200  granted      the feed works
//   401  unauthorized the key is wrong (a whole-account problem)
//   403  not_in_plan  the key is valid but this feed was not purchased
//   404  not_offered  SportsDataIO does not publish this feed for this league
//   429  rate_limited transient; retried later, never cached as a denial
//
// A single 403 means one feed is missing, never that the provider is broken.

import { createClient, isConfigured, resolveKey } from './client.mjs';
import { BASE, FEEDS, TIMEFRAME, LEAGUES, leagueFor, formatDate } from './endpoints.mjs';

export const GRANT = Object.freeze({
  GRANTED: 'granted',
  UNAUTHORIZED: 'unauthorized',
  NOT_IN_PLAN: 'not_in_plan',
  NOT_OFFERED: 'not_offered',
  RATE_LIMITED: 'rate_limited',
  UNREACHABLE: 'unreachable',
  UNKNOWN: 'unknown',
});

const DISCOVERY_TTL_MS = 6 * 60 * 60 * 1000;

export function classify({ ok, status }) {
  if (ok) return GRANT.GRANTED;
  switch (status) {
    case 401: return GRANT.UNAUTHORIZED;
    case 403: return GRANT.NOT_IN_PLAN;
    case 404: return GRANT.NOT_OFFERED;
    case 429: return GRANT.RATE_LIMITED;
    case 0: return GRANT.UNREACHABLE;
    default: return status >= 500 ? GRANT.UNREACHABLE : GRANT.UNKNOWN;
  }
}

/** Feeds probed for entitlement, in the order a scan would need them. */
export const PROBE_FEEDS = Object.freeze([
  'projections', 'injuries', 'games', 'playerGameStats',
  'playerSeasonStats', 'teamSeasonStats', 'depthCharts', 'startingLineups',
  'playerProps', 'gameOdds',
]);

export function createEntitlements({ client = null, fetchImpl = fetch, now = () => new Date(), ttlMs = DISCOVERY_TTL_MS } = {}) {
  const http = client || createClient({ fetchImpl });
  let matrix = null;
  let discoveredAt = 0;
  let inflight = null;

  async function timeframeFor(sport, league) {
    if (league.by !== 'week') return { season: now().getUTCFullYear(), week: null };
    const [season, week] = await Promise.all([
      http.get(`${BASE}/${TIMEFRAME.currentSeason(league)}`, TIMEFRAME.currentSeason(league), { ttlMs, sport }),
      http.get(`${BASE}/${TIMEFRAME.currentWeek(league)}`, TIMEFRAME.currentWeek(league), { ttlMs, sport }),
    ]);
    return season.ok && week.ok ? { season: season.data, week: week.data } : { season: null, week: null };
  }

  async function probe() {
    const date = formatDate(now());
    const leagues = {};
    let sawUnauthorized = false;
    let sawGrant = false;

    for (const sport of Object.keys(LEAGUES)) {
      const league = leagueFor(sport);
      if (!resolveKey(sport)) { leagues[sport] = { reachable: false, feeds: {} }; continue; }
      const { season, week } = await timeframeFor(sport, league);
      const feeds = {};

      for (const name of PROBE_FEEDS) {
        const feed = FEEDS[name];
        // A feed the catalog already knows is impossible here is not probed.
        if (feed.requires === 'projections' && !league.projections) { feeds[name] = GRANT.NOT_OFFERED; continue; }
        if (Array.isArray(feed.leagues) && !feed.leagues.includes(sport)) { feeds[name] = GRANT.NOT_OFFERED; continue; }
        const path = feed.build(league, { date, season, week });
        if (!path) { feeds[name] = GRANT.UNKNOWN; continue; }

        const result = await http.get(`${BASE}/${path}`, path, { ttlMs: feed.ttlMs, sport });
        const grant = classify(result);
        feeds[name] = grant;
        if (grant === GRANT.GRANTED) sawGrant = true;
        if (grant === GRANT.UNAUTHORIZED) sawUnauthorized = true;
      }
      leagues[sport] = { reachable: Object.values(feeds).includes(GRANT.GRANTED), feeds };
    }

    return {
      discoveredAt: new Date().toISOString(),
      configured: isConfigured(),
      // Only a key rejected everywhere is an account problem. One 403 is not.
      keyRejected: sawUnauthorized && !sawGrant,
      leagues,
    };
  }

  return {
    /** Cached matrix, discovering it on first use. Never throws. */
    async get({ force = false } = {}) {
      if (!isConfigured()) {
        return { discoveredAt: null, configured: false, keyRejected: false, leagues: {} };
      }
      if (!force && matrix && Date.now() - discoveredAt < ttlMs) return matrix;
      if (inflight) return inflight;
      inflight = (async () => {
        try {
          matrix = await probe();
          discoveredAt = Date.now();
          return matrix;
        } catch {
          return matrix || { discoveredAt: null, configured: true, keyRejected: false, leagues: {} };
        } finally {
          inflight = null;
        }
      })();
      return inflight;
    },

    /** Is this feed usable for this sport right now? */
    allows(sport, feed) {
      const row = matrix?.leagues?.[String(sport || '').toUpperCase()];
      if (!row) return true;             // undiscovered: attempt it, the call decides
      const grant = row.feeds?.[feed];
      // Only a settled denial blocks a call; rate limits and unknowns retry.
      return grant !== GRANT.NOT_IN_PLAN && grant !== GRANT.NOT_OFFERED && grant !== GRANT.UNAUTHORIZED;
    },

    snapshot: () => matrix,
    reset: () => { matrix = null; discoveredAt = 0; inflight = null; },
  };
}

/** Flatten the matrix into capability rows for diagnostics. Never has secrets. */
export function capabilityRows(matrix) {
  const rows = [];
  for (const [sport, league] of Object.entries(matrix?.leagues || {})) {
    for (const [feed, grant] of Object.entries(league.feeds || {})) {
      rows.push({ sport, feed, grant, available: grant === GRANT.GRANTED });
    }
  }
  return rows;
}
