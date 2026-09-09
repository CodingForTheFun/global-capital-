// Runtime entitlement discovery and safe provider diagnostics.
//
// The live API decides what a configured key can use. Scout Pro records only
// classifications and operational metadata (status/count/latency), never keys,
// URLs or provider response bodies.

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

export const PROBE_FEEDS = Object.freeze([
  'projections', 'injuries', 'games', 'playerGameStats',
  'playerSeasonStats', 'teamSeasonStats', 'depthCharts', 'startingLineups',
  'playerProps', 'gameOdds',
]);

function firstGameId(payload) {
  if (!Array.isArray(payload)) return null;
  for (const row of payload) {
    const value = row?.GameID;
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return null;
}

function recordCount(data) {
  if (Array.isArray(data)) return data.length;
  if (data && typeof data === 'object') {
    for (const key of ['BettingMarkets', 'BettingEvents', 'Games', 'Players', 'Results']) {
      if (Array.isArray(data[key])) return data[key].length;
    }
    return 1;
  }
  return data === null || data === undefined ? 0 : 1;
}

function errorType(grant, reason = null) {
  if (grant === GRANT.GRANTED) return 'OK';
  if (grant === GRANT.UNAUTHORIZED) return 'AUTH_REJECTED';
  if (grant === GRANT.NOT_IN_PLAN) return 'SCOPE_DENIED';
  if (grant === GRANT.NOT_OFFERED) return 'ROUTE_NOT_OFFERED';
  if (grant === GRANT.RATE_LIMITED) return 'RATE_LIMITED';
  if (grant === GRANT.UNREACHABLE) return reason === 'timed out' ? 'TIMEOUT' : 'UNREACHABLE';
  return 'UNKNOWN';
}

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
      if (!resolveKey(sport)) {
        leagues[sport] = { reachable: false, feeds: {}, details: {} };
        continue;
      }
      const { season, week } = await timeframeFor(sport, league);
      const feeds = {};
      const details = {};
      let gamesPayload = null;

      for (const name of PROBE_FEEDS) {
        const feed = FEEDS[name];
        if (feed.requires === 'projections' && !league.projections) {
          feeds[name] = GRANT.NOT_OFFERED;
          details[name] = { status: 404, recordCount: 0, latencyMs: 0, errorType: 'ROUTE_NOT_OFFERED' };
          continue;
        }
        if (Array.isArray(feed.leagues) && !feed.leagues.includes(sport)) {
          feeds[name] = GRANT.NOT_OFFERED;
          details[name] = { status: 404, recordCount: 0, latencyMs: 0, errorType: 'ROUTE_NOT_OFFERED' };
          continue;
        }

        let params = { date, season, week };
        if (name === 'playerProps') {
          const gameId = firstGameId(gamesPayload);
          if (gameId === null) {
            feeds[name] = GRANT.UNKNOWN;
            details[name] = { status: 0, recordCount: 0, latencyMs: 0, errorType: 'NO_CURRENT_GAME' };
            continue;
          }
          params = { ...params, gameId };
        }

        const path = feed.build(league, params);
        if (!path) {
          feeds[name] = GRANT.UNKNOWN;
          details[name] = { status: 0, recordCount: 0, latencyMs: 0, errorType: 'ROUTE_UNRESOLVED' };
          continue;
        }

        const started = Date.now();
        const result = await http.get(`${BASE}/${path}`, path, { ttlMs: feed.ttlMs, sport });
        const latencyMs = Date.now() - started;
        const grant = classify(result);
        feeds[name] = grant;
        details[name] = {
          status: result.ok ? 200 : (Number(result.status) || 0),
          recordCount: result.ok ? recordCount(result.data) : 0,
          latencyMs,
          errorType: errorType(grant, result.reason),
        };
        if (name === 'games' && result.ok && Array.isArray(result.data)) gamesPayload = result.data;
        if (grant === GRANT.GRANTED) sawGrant = true;
        if (grant === GRANT.UNAUTHORIZED) sawUnauthorized = true;
      }
      leagues[sport] = { reachable: Object.values(feeds).includes(GRANT.GRANTED), feeds, details };
    }

    return {
      discoveredAt: new Date().toISOString(),
      configured: isConfigured(),
      keyRejected: sawUnauthorized && !sawGrant,
      leagues,
    };
  }

  return {
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

    allows(sport, feed) {
      const row = matrix?.leagues?.[String(sport || '').toUpperCase()];
      if (!row) return true;
      const grant = row.feeds?.[feed];
      return grant !== GRANT.NOT_IN_PLAN && grant !== GRANT.NOT_OFFERED && grant !== GRANT.UNAUTHORIZED;
    },

    snapshot: () => matrix,
    reset: () => { matrix = null; discoveredAt = 0; inflight = null; },
  };
}

/** Flatten the matrix into safe capability rows for diagnostics. */
export function capabilityRows(matrix) {
  const rows = [];
  for (const [sport, league] of Object.entries(matrix?.leagues || {})) {
    for (const [feed, grant] of Object.entries(league.feeds || {})) {
      const detail = league.details?.[feed] || {};
      rows.push({
        sport,
        feed,
        grant,
        available: grant === GRANT.GRANTED,
        status: detail.status ?? null,
        recordCount: detail.recordCount ?? null,
        latencyMs: detail.latencyMs ?? null,
        errorType: detail.errorType ?? null,
      });
    }
  }
  return rows;
}
