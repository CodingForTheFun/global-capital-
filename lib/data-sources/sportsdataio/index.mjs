// SportsDataIO adapter — Scout Pro's sports intelligence provider.
//
// Fetches every feed the subscription allows, in parallel, per league. A feed
// that fails contributes nothing and the rest still apply; the provider is only
// reported unavailable when NO league produced anything. That is what keeps a
// SportsDataIO outage from degrading Scout Pro beyond "un-enriched props".

import { createClient, isConfigured, resolveKey, redact } from './client.mjs';
import { BASE, FEEDS, TIMEFRAME, leagueFor, formatDate, SUPPORTED_LEAGUES, PROJECTION_LEAGUES, UNCOVERED_LEAGUES, MAPPABLE_LEAGUES } from './endpoints.mjs';
import { indexByTeam, indexDepthChart, indexLineups, buildEnrichment, buildIndex, gameLogValues } from './normalize.mjs';
import { createEntitlements, capabilityRows } from './entitlements.mjs';
import { summarizeSportsbookCoverage, prizePicksOffers } from './odds.mjs';
import { rollingAnalytics } from '../../analytics/rolling.mjs';
import { enrichmentKey } from '../contract.mjs';

export { SUPPORTED_LEAGUES, PROJECTION_LEAGUES, UNCOVERED_LEAGUES, MAPPABLE_LEAGUES, formatDate, isConfigured };

/** Feeds pulled for every prop scan, in priority order. */
const SCAN_FEEDS = ['projections', 'injuries', 'games', 'playerGameStats', 'playerSeasonStats', 'teamSeasonStats', 'depthCharts', 'startingLineups'];
const OPERATOR_COVERAGE_SPORTS = Object.freeze(['NBA', 'NFL', 'MLB', 'NHL', 'WNBA', 'NCAAB', 'NCAAF']);
const PLAYER_PROP_CONCURRENCY = 4;
const MAX_PROP_GAMES = 40;

function gameIdOf(row) {
  const value = row?.GameID;
  if (value === null || value === undefined || value === '') return null;
  return value;
}

function uniqueGames(payload) {
  if (!Array.isArray(payload)) return [];
  const seen = new Set();
  const out = [];
  for (const game of payload) {
    const gameId = gameIdOf(game);
    if (gameId === null) continue;
    const key = String(gameId);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(game);
    if (out.length >= MAX_PROP_GAMES) break;
  }
  return out;
}

async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

export function createSportsDataIoAdapter({
  fetchImpl = fetch,
  timeoutMs = 8000,
  now = () => new Date(),
  client = null,
  log = console,
} = {}) {
  const http = client || createClient({ fetchImpl, timeoutMs });
  const entitlements = createEntitlements({ client: http, now });
  const timeframeCache = new Map(); // league path -> { season, week, at }

  /** Resolve season/week for week-addressed leagues, or null to skip them. */
  async function timeframe(sport, league) {
    const cached = timeframeCache.get(league.path);
    if (cached && Date.now() - cached.at < 60 * 60 * 1000) return cached;
    const [season, week] = await Promise.all([
      http.get(`${BASE}/${TIMEFRAME.currentSeason(league)}`, TIMEFRAME.currentSeason(league), { ttlMs: 60 * 60 * 1000, sport }),
      http.get(`${BASE}/${TIMEFRAME.currentWeek(league)}`, TIMEFRAME.currentWeek(league), { ttlMs: 30 * 60 * 1000, sport }),
    ]);
    if (!season.ok || !week.ok || season.data == null || week.data == null) return null;
    const resolved = { season: season.data, week: week.data, at: Date.now() };
    timeframeCache.set(league.path, resolved);
    return resolved;
  }

  async function loadFeed(name, sport, league, params) {
    const feed = FEEDS[name];
    if (!feed) return null;
    if (feed.requires === 'projections' && !league.projections) return null;
    if (Array.isArray(feed.leagues) && !feed.leagues.includes(String(sport).toUpperCase())) return null;
    if (!entitlements.allows(sport, name)) return null;
    const path = feed.build(league, params);
    if (!path) return null;
    const result = await http.get(`${BASE}/${path}`, path, { ttlMs: feed.ttlMs, sport });
    return result.ok ? result.data : null;
  }

  /**
   * SportsDataIO's current aggregated player-props feed is per GameID. We first
   * read the real games feed, then request each actual game with a small
   * concurrency cap. Game IDs are never guessed and every response remains
   * independently cached by the shared client.
   */
  async function loadPlayerPropsByGames(sport, league, params, gamesPayload = null) {
    if (!entitlements.allows(sport, 'playerProps')) return [];
    const games = uniqueGames(gamesPayload ?? await loadFeed('games', sport, league, params));
    if (!games.length) return [];
    const feed = FEEDS.playerProps;
    const payloads = await mapWithConcurrency(games, PLAYER_PROP_CONCURRENCY, async (game) => {
      const gameId = gameIdOf(game);
      const path = feed.build(league, { ...params, gameId });
      if (!path) return null;
      const result = await http.get(`${BASE}/${path}`, path, { ttlMs: feed.ttlMs, sport });
      if (!result.ok || !result.data) return null;

      const context = {
        GameID: gameId,
        GameStartTime: game?.DateTime ?? game?.DateTimeUTC ?? game?.Day ?? null,
        HomeTeam: game?.HomeTeam ?? null,
        AwayTeam: game?.AwayTeam ?? null,
      };
      if (Array.isArray(result.data)) return { ...context, BettingMarkets: result.data };
      if (typeof result.data === 'object') return { ...context, ...result.data, GameID: result.data.GameID ?? gameId };
      return null;
    });
    return payloads.filter(Boolean);
  }

  async function operatorCoverage({ sportsbook = 'PrizePicks', sports = OPERATOR_COVERAGE_SPORTS } = {}) {
    const date = formatDate(now());
    const snapshot = entitlements.snapshot();
    const rows = [];

    for (const requested of sports) {
      const sport = String(requested || '').toUpperCase();
      const league = leagueFor(sport);
      if (!league) {
        rows.push({ sport, feedAvailable: false, entitlement: 'not_offered', gamesChecked: 0, targetSeen: false, targetOffers: 0, totalCoreOffers: 0, operators: [] });
        continue;
      }
      if (!resolveKey(sport)) {
        rows.push({ sport, feedAvailable: false, entitlement: 'not_configured', gamesChecked: 0, targetSeen: false, targetOffers: 0, totalCoreOffers: 0, operators: [] });
        continue;
      }

      const grant = snapshot?.leagues?.[sport]?.feeds?.playerProps ?? null;
      if (['not_in_plan', 'not_offered', 'unauthorized'].includes(grant)) {
        rows.push({ sport, feedAvailable: false, entitlement: grant, gamesChecked: 0, targetSeen: false, targetOffers: 0, totalCoreOffers: 0, operators: [] });
        continue;
      }

      let params = { date, season: now().getUTCFullYear(), week: null };
      if (league.by === 'week') {
        const resolved = await timeframe(sport, league);
        if (!resolved) {
          rows.push({ sport, feedAvailable: false, entitlement: grant || 'unknown', gamesChecked: 0, targetSeen: false, targetOffers: 0, totalCoreOffers: 0, operators: [] });
          continue;
        }
        params = { date, season: resolved.season, week: resolved.week };
      }
      const gamesPayload = await loadFeed('games', sport, league, params);
      const gamesChecked = uniqueGames(gamesPayload).length;
      const raw = await loadPlayerPropsByGames(sport, league, params, gamesPayload);
      if (!raw.length) {
        rows.push({ sport, feedAvailable: grant === 'granted', entitlement: grant || 'unknown', gamesChecked, targetSeen: false, targetOffers: 0, totalCoreOffers: 0, operators: [] });
        continue;
      }

      const summary = summarizeSportsbookCoverage(raw, sportsbook, { sport });
      rows.push({ sport, feedAvailable: true, entitlement: grant || 'granted_or_unprobed', gamesChecked, ...summary });
    }

    return {
      checkedAt: new Date().toISOString(),
      sportsbook,
      rows,
      leaguesWithTarget: rows.filter((row) => row.targetSeen).map((row) => row.sport),
    };
  }

  /**
   * Return today's exact, available, NON-ALTERNATE PrizePicks player outcomes
   * from SportsDataIO. This is deliberately separate from enrichment: callers
   * can use it as a prop-universe source only after runtime entitlement/operator
   * coverage proves it is actually present for the league.
   */
  async function prizePicksBoard({ sports = OPERATOR_COVERAGE_SPORTS } = {}) {
    const date = formatDate(now());
    const snapshot = entitlements.snapshot();
    const offers = [];
    const coverage = [];

    for (const requested of sports) {
      const sport = String(requested || '').toUpperCase();
      const league = leagueFor(sport);
      if (!league || !resolveKey(sport)) continue;
      const grant = snapshot?.leagues?.[sport]?.feeds?.playerProps ?? null;
      if (['not_in_plan', 'not_offered', 'unauthorized'].includes(grant)) continue;

      let params = { date, season: now().getUTCFullYear(), week: null };
      if (league.by === 'week') {
        const resolved = await timeframe(sport, league);
        if (!resolved) continue;
        params = { date, season: resolved.season, week: resolved.week };
      }
      const gamesPayload = await loadFeed('games', sport, league, params);
      const raw = await loadPlayerPropsByGames(sport, league, params, gamesPayload);
      if (!raw.length) continue;
      const sportOffers = prizePicksOffers(raw, { sport });
      offers.push(...sportOffers);
      coverage.push({ sport, gamesChecked: uniqueGames(gamesPayload).length, offers: sportOffers.length });
    }

    return {
      fetchedAt: new Date().toISOString(),
      sportsbook: 'PrizePicks',
      offers,
      coverage,
    };
  }

  return {
    id: 'sportsdataio',
    name: 'SportsDataIO',
    capabilities: [
      'projection', 'projectionSource', 'team', 'gameStartTime', 'liveStatus',
      'injuryStatus', 'injuryDetail', 'isStarter', 'expectedMinutes', 'actualMinutes',
      'depthChartOrder', 'lineupStatus', 'opponentRank', 'opponentPositionRank',
      'opponentPointsAllowed', 'liveStat', 'seasonAverage',
      'providerPlayerId', 'providerTeamId', 'providerGameId', 'playerPosition',
      'venue', 'isHome', 'gamePeriod', 'gameClock', 'homeScore', 'awayScore',
      'projectionUpdatedAt', 'injuryNotes', 'injuryUpdatedAt',
    ],

    isConfigured,
    stats: () => http.stats(),

    async entitlements({ force = false } = {}) {
      const matrix = await entitlements.get({ force });
      return { ...matrix, capabilities: capabilityRows(matrix) };
    },

    operatorCoverage,
    prizePicksBoard,

    async playerGameLog({ sport, playerId, market, line, side, games = 20 } = {}) {
      const league = leagueFor(sport);
      if (!league || !playerId || !resolveKey(sport)) return null;
      const season = league.by === 'week'
        ? (await timeframe(sport, league))?.season
        : now().getUTCFullYear();
      if (!season) return null;
      const feed = FEEDS.playerGameLog;
      const path = feed.build(league, { season, playerId, games });
      if (!path) return null;
      const result = await http.get(`${BASE}/${path}`, path, { ttlMs: feed.ttlMs, sport });
      if (!result.ok) return null;
      const values = gameLogValues(sport, market, result.data);
      if (!values.length) return null;
      return {
        ...rollingAnalytics(values, line, side),
        source: 'SportsDataIO',
        fetchedAt: new Date().toISOString(),
        cached: Boolean(result.cached),
      };
    },

    unsupportedFor(props = []) {
      return [...new Set(props
        .map((prop) => String(prop.sport || '').toUpperCase())
        .filter((sport) => sport && !leagueFor(sport)))];
    },

    async fetchEnrichment({ props = [] } = {}) {
      const out = new Map();
      const bySport = new Map();
      for (const prop of props) {
        const sport = String(prop.sport || '').toUpperCase();
        if (!leagueFor(sport)) continue;
        if (!bySport.has(sport)) bySport.set(sport, []);
        bySport.get(sport).push(prop);
      }
      if (!bySport.size) return out;

      const date = formatDate(now());
      let anySucceeded = false;
      const failures = [];

      for (const [sport, sportProps] of bySport) {
        if (!resolveKey(sport)) continue;
        const league = leagueFor(sport);

        let params = { date, season: null, week: null };
        if (league.by === 'week') {
          const resolved = await timeframe(sport, league);
          if (!resolved) { failures.push({ sport, reason: 'timeframe unavailable' }); continue; }
          params = { date, season: resolved.season, week: resolved.week };
        } else {
          params.season = now().getUTCFullYear();
        }

        const loaded = await Promise.all(SCAN_FEEDS.map(async (name) => [name, await loadFeed(name, sport, league, params)]));
        const raw = Object.fromEntries(loaded);
        if (!raw.projections && !raw.playerGameStats && !raw.games) {
          failures.push({ sport, reason: 'no feed responded' });
          continue;
        }
        anySucceeded = true;

        const feeds = {
          projections: buildIndex(raw.projections || []),
          injuries: buildIndex(raw.injuries || [], { teamOf: (row) => row?.Team, opponentOf: () => null }),
          playerGameStats: buildIndex(raw.playerGameStats || []),
          playerSeasonStats: buildIndex(raw.playerSeasonStats || [], { opponentOf: () => null }),
          teamSeasonStats: indexByTeam(raw.teamSeasonStats || []),
          depthCharts: indexDepthChart(raw.depthCharts || []),
          lineups: indexLineups(raw.startingLineups || []),
          gamesByTeam: new Map(),
        };

        for (const game of Array.isArray(raw.games) ? raw.games : []) {
          for (const field of ['HomeTeam', 'AwayTeam']) {
            const key = String(game?.[field] ?? '').toUpperCase().trim();
            if (key && !feeds.gamesByTeam.has(key)) feeds.gamesByTeam.set(key, game);
          }
        }

        const fetchedAt = new Date().toISOString();
        for (const prop of sportProps) {
          const enrichment = buildEnrichment(prop, feeds, { fetchedAt });
          if (enrichment) out.set(enrichmentKey(prop), enrichment);
        }
      }

      if (!anySucceeded && failures.length) {
        log?.error?.('[AutoProp provider] sportsdataio: no league produced data', redact(JSON.stringify(failures)));
        throw Object.assign(new Error('SportsDataIO returned no usable feed'), { code: 'PROVIDER_UNAVAILABLE' });
      }
      return out;
    },
  };
}