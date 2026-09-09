// SportsDataIO adapter — Scout Pro's sports intelligence provider.
//
// Fetches every feed the subscription allows, in parallel, per league. A feed
// that fails contributes nothing and the rest still apply; the provider is only
// reported unavailable when NO league produced anything. That is what keeps a
// SportsDataIO outage from degrading Scout Pro beyond "un-enriched props".

import { createClient, isConfigured, resolveKey, redact } from './client.mjs';
import { BASE, FEEDS, TIMEFRAME, leagueFor, formatDate, SUPPORTED_LEAGUES, PROJECTION_LEAGUES, UNCOVERED_LEAGUES, MAPPABLE_LEAGUES } from './endpoints.mjs';
import { indexByPlayer, indexByTeam, indexDepthChart, indexLineups, buildEnrichment } from './normalize.mjs';
import { enrichmentKey } from '../contract.mjs';

export { SUPPORTED_LEAGUES, PROJECTION_LEAGUES, UNCOVERED_LEAGUES, MAPPABLE_LEAGUES, formatDate, isConfigured };

/** Feeds pulled for every prop scan, in priority order. */
const SCAN_FEEDS = ['projections', 'injuries', 'games', 'playerGameStats', 'playerSeasonStats', 'teamSeasonStats', 'depthCharts', 'startingLineups'];

export function createSportsDataIoAdapter({
  fetchImpl = fetch,
  timeoutMs = 8000,
  now = () => new Date(),
  client = null,
  log = console,
} = {}) {
  const http = client || createClient({ fetchImpl, timeoutMs });
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
    const path = feed.build(league, params);
    if (!path) return null;
    const result = await http.get(`${BASE}/${path}`, path, { ttlMs: feed.ttlMs, sport });
    return result.ok ? result.data : null;
  }

  return {
    id: 'sportsdataio',
    name: 'SportsDataIO',
    capabilities: [
      'projection', 'projectionSource', 'team', 'gameStartTime', 'liveStatus',
      'injuryStatus', 'injuryDetail', 'isStarter', 'expectedMinutes', 'actualMinutes',
      'depthChartOrder', 'lineupStatus', 'opponentRank', 'opponentPositionRank',
      'opponentPointsAllowed', 'liveStat', 'seasonAverage',
    ],

    isConfigured,

    /** Diagnostics only. Never includes key material. */
    stats: () => http.stats(),

    /** Leagues in this population that SportsDataIO cannot enrich at all. */
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
        if (!leagueFor(sport)) continue;   // uncovered league: left un-enriched
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
          // Skip rather than call a week-addressed feed with a guessed week.
          if (!resolved) { failures.push({ sport, reason: 'timeframe unavailable' }); continue; }
          params = { date, season: resolved.season, week: resolved.week };
        } else {
          // Season-addressed feeds still need a season for date-based leagues.
          params.season = new Date(date).getUTCFullYear() || now().getUTCFullYear();
        }

        // All feeds in parallel; each independently allowed to fail.
        const loaded = await Promise.all(SCAN_FEEDS.map(async (name) => [name, await loadFeed(name, sport, league, params)]));
        const raw = Object.fromEntries(loaded);
        if (!raw.projections && !raw.playerGameStats && !raw.games) {
          failures.push({ sport, reason: 'no feed responded' });
          continue;
        }
        anySucceeded = true;

        const feeds = {
          projections: indexByPlayer(raw.projections || []),
          injuries: indexByPlayer(raw.injuries || []),
          playerGameStats: indexByPlayer(raw.playerGameStats || []),
          playerSeasonStats: indexByPlayer(raw.playerSeasonStats || []),
          teamSeasonStats: indexByTeam(raw.teamSeasonStats || []),
          depthCharts: indexDepthChart(raw.depthCharts || []),
          lineups: indexLineups(raw.startingLineups || []),
          gamesByTeam: new Map(),
        };

        // A game row is indexed under both teams so either side resolves it.
        for (const game of Array.isArray(raw.games) ? raw.games : []) {
          for (const field of ['HomeTeam', 'AwayTeam']) {
            const key = String(game?.[field] ?? '').toUpperCase().trim();
            if (key && !feeds.gamesByTeam.has(key)) feeds.gamesByTeam.set(key, game);
          }
        }

        for (const prop of sportProps) {
          const enrichment = buildEnrichment(prop, feeds);
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
