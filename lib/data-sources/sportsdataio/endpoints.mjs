// Verified SportsDataIO v3 endpoint catalog.
//
// Every entry below was confirmed against the live API by probing for the
// authentication challenge (401 = the feed exists, 404 = it does not). Nothing
// here is inferred from documentation alone.
//
// `ttlMs` is the refresh interval for that feed: how long a cached response
// stays fresh. Live feeds refresh in seconds, reference data in hours.

export const BASE = 'https://azure-api.sportsdata.io/v3';

/** Leagues, and how their per-game feeds are addressed. */
export const LEAGUES = Object.freeze({
  NBA: { path: 'nba', by: 'date', projections: true },
  MLB: { path: 'mlb', by: 'date', projections: true },
  NHL: { path: 'nhl', by: 'date', projections: true },
  NFL: { path: 'nfl', by: 'week', projections: true },
  // Scores/stats exist but no projections feed is sold for these.
  WNBA: { path: 'wnba', by: 'date', projections: false },
  NCAAB: { path: 'cbb', by: 'date', projections: false },
  CBB: { path: 'cbb', by: 'date', projections: false },
  NCAAF: { path: 'cfb', by: 'week', projections: false },
  CFB: { path: 'cfb', by: 'week', projections: false },
});

export const SUPPORTED_LEAGUES = Object.freeze(Object.keys(LEAGUES));
export const PROJECTION_LEAGUES = Object.freeze(Object.entries(LEAGUES).filter(([, v]) => v.projections).map(([k]) => k));

/** Leagues Scout Pro scans for which SportsDataIO sells nothing at all. */
export const UNCOVERED_LEAGUES = Object.freeze(['TENNIS', 'VAL', 'DOTA2', 'COD']);

/** Projections exist but their markets differ from ball sports; not yet mapped. */
export const MAPPABLE_LEAGUES = Object.freeze(['CS2', 'LOL']);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Feed definitions. `build` returns a path relative to BASE, or null when the
 * feed cannot be addressed for that league (which is skipped, never guessed).
 */
export const FEEDS = Object.freeze({
  projections: {
    ttlMs: 10 * MINUTE,
    requires: 'projections',
    build: (league, { date, season, week }) => (league.by === 'week'
      ? (season && week ? `${league.path}/projections/json/PlayerGameProjectionStatsByWeek/${season}/${week}` : null)
      : `${league.path}/projections/json/PlayerGameProjectionStatsByDate/${date}`),
  },
  injuries: {
    ttlMs: 15 * MINUTE,
    requires: 'projections',
    build: (league) => `${league.path}/projections/json/InjuredPlayers`,
  },
  games: {
    // Live scores and game status. Short TTL because it changes in play.
    ttlMs: 30_000,
    build: (league, { date, season, week }) => (league.by === 'week'
      ? (season && week ? `${league.path}/scores/json/ScoresByWeek/${season}/${week}` : null)
      : `${league.path}/scores/json/GamesByDate/${date}`),
  },
  playerGameStats: {
    // Actual (and in-play) player statistics.
    ttlMs: MINUTE,
    build: (league, { date, season, week }) => (league.by === 'week'
      ? (season && week ? `${league.path}/stats/json/PlayerGameStatsByWeek/${season}/${week}` : null)
      : `${league.path}/stats/json/PlayerGameStatsByDate/${date}`),
  },
  playerSeasonStats: {
    ttlMs: 6 * HOUR,
    build: (league, { season }) => (season ? `${league.path}/stats/json/PlayerSeasonStats/${season}` : null),
  },
  teamSeasonStats: {
    // Opponent/team context for matchup strength.
    ttlMs: 6 * HOUR,
    build: (league, { season }) => (season ? `${league.path}/stats/json/TeamSeasonStats/${season}` : null),
  },
  depthCharts: {
    // Role and opportunity. NBA and NFL confirmed.
    ttlMs: 6 * HOUR,
    build: (league) => `${league.path}/scores/json/DepthCharts`,
  },
  startingLineups: {
    // Confirmed/projected lineups. MLB confirmed; other leagues return none and
    // are skipped rather than called.
    ttlMs: 5 * MINUTE,
    leagues: ['MLB'],
    build: (league, { date }) => `${league.path}/projections/json/StartingLineupsByDate/${date}`,
  },
  teams: { ttlMs: 24 * HOUR, build: (league) => `${league.path}/scores/json/teams` },
  standings: { ttlMs: 6 * HOUR, build: (league, { season }) => (season ? `${league.path}/scores/json/Standings/${season}` : null) },

  playerGameLog: {
    // Per-player game log. DETAIL VIEW ONLY: never called for a list of props,
    // because that would be one request per rendered prop.
    ttlMs: 10 * MINUTE,
    perPlayer: true,
    build: (league, { season, playerId, games = 20 }) => (season && playerId
      ? `${league.path}/stats/json/PlayerGameStatsBySeason/${season}/${playerId}/${games}`
      : null),
  },

  // Confirmed to exist and reserved for the odds/line-movement work. Not yet
  // normalized into the Prop model, so nothing consumes them today.
  playerProps: { ttlMs: 2 * MINUTE, build: (league, { date }) => `${league.path}/odds/json/PlayerPropsByDate/${date}` },
  gameOdds: { ttlMs: 2 * MINUTE, build: (league, { date }) => `${league.path}/odds/json/GameOddsByDate/${date}` },
});

/** NFL/CFB need a season and week; these resolve them from the scores feed. */
export const TIMEFRAME = Object.freeze({
  currentSeason: (league) => `${league.path}/scores/json/CurrentSeason`,
  currentWeek: (league) => `${league.path}/scores/json/CurrentWeek`,
});

export function leagueFor(sport) {
  return LEAGUES[String(sport || '').toUpperCase()] || null;
}

/** SportsDataIO date format, e.g. 2026-SEP-09. */
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export function formatDate(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}-${MONTHS[d.getUTCMonth()]}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
