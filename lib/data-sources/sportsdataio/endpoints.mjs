// Verified SportsDataIO v3 endpoint catalog.
// Runtime entitlement discovery decides what the configured key can actually
// use. Unsupported or unsubscribed feeds fail closed.

export const BASE = 'https://azure-api.sportsdata.io/v3';

export const LEAGUES = Object.freeze({
  NBA: { path: 'nba', by: 'date', projections: true },
  MLB: { path: 'mlb', by: 'date', projections: true },
  NHL: { path: 'nhl', by: 'date', projections: true },
  NFL: { path: 'nfl', by: 'week', projections: true },
  WNBA: { path: 'wnba', by: 'date', projections: false },
  NCAAB: { path: 'cbb', by: 'date', projections: false },
  CBB: { path: 'cbb', by: 'date', projections: false },
  NCAAF: { path: 'cfb', by: 'week', projections: false },
  CFB: { path: 'cfb', by: 'week', projections: false },
});

export const CANONICAL_LEAGUES = Object.freeze(['NBA', 'NFL', 'MLB', 'NHL', 'WNBA', 'NCAAB', 'NCAAF']);
export const SUPPORTED_LEAGUES = Object.freeze(Object.keys(LEAGUES));
export const PROJECTION_LEAGUES = Object.freeze(Object.entries(LEAGUES).filter(([key, value]) => value.projections && !['CBB', 'CFB'].includes(key)).map(([key]) => key));
export const UNCOVERED_LEAGUES = Object.freeze(['TENNIS', 'VAL', 'DOTA2', 'COD']);
export const MAPPABLE_LEAGUES = Object.freeze(['CS2', 'LOL']);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

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
    ttlMs: 30_000,
    build: (league, { date, season, week }) => (league.by === 'week'
      ? (season && week ? `${league.path}/scores/json/ScoresByWeek/${season}/${week}` : null)
      : `${league.path}/scores/json/GamesByDate/${date}`),
  },
  playerGameStats: {
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
    ttlMs: 6 * HOUR,
    build: (league, { season }) => (season ? `${league.path}/stats/json/TeamSeasonStats/${season}` : null),
  },
  depthCharts: {
    ttlMs: 6 * HOUR,
    build: (league) => `${league.path}/scores/json/DepthCharts`,
  },
  startingLineups: {
    ttlMs: 5 * MINUTE,
    leagues: ['MLB'],
    build: (league, { date }) => `${league.path}/projections/json/StartingLineupsByDate/${date}`,
  },
  teams: { ttlMs: 24 * HOUR, build: (league) => `${league.path}/scores/json/teams` },
  standings: { ttlMs: 6 * HOUR, build: (league, { season }) => (season ? `${league.path}/scores/json/Standings/${season}` : null) },
  playerGameLog: {
    ttlMs: 10 * MINUTE,
    perPlayer: true,
    build: (league, { season, playerId, games = 20 }) => (season && playerId
      ? `${league.path}/stats/json/PlayerGameStatsBySeason/${season}/${playerId}/${games}`
      : null),
  },
  playerProps: {
    ttlMs: 2 * MINUTE,
    perGame: true,
    build: (league, { gameId }) => (gameId
      ? `${league.path}/odds/json/BettingPlayerPropsByGameID/${gameId}?include=available`
      : null),
  },
  bettingMarket: {
    ttlMs: MINUTE,
    perMarket: true,
    build: (league, { bettingMarketId }) => (bettingMarketId
      ? `${league.path}/odds/json/BettingMarket/${bettingMarketId}`
      : null),
  },
  gameOdds: { ttlMs: 2 * MINUTE, build: (league, { date }) => `${league.path}/odds/json/GameOddsByDate/${date}` },
});

export const TIMEFRAME = Object.freeze({
  currentSeason: (league) => `${league.path}/scores/json/CurrentSeason`,
  currentWeek: (league) => `${league.path}/scores/json/CurrentWeek`,
});

export function leagueFor(sport) {
  return LEAGUES[String(sport || '').toUpperCase()] || null;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * SportsDataIO date format, e.g. 2026-SEP-09.
 * In production SCAN_TIME_ZONE defines the slate date so "today" does not roll
 * over just because UTC crossed midnight. Tests/dev without that variable keep
 * the previous deterministic UTC behaviour.
 */
export function formatDate(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const zone = String(process.env.SCAN_TIME_ZONE || '').trim();
  if (!zone) return `${d.getUTCFullYear()}-${MONTHS[d.getUTCMonth()]}-${String(d.getUTCDate()).padStart(2, '0')}`;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const part = (type) => parts.find((row) => row.type === type)?.value;
    const year = Number(part('year'));
    const month = Number(part('month'));
    const day = Number(part('day'));
    if (Number.isFinite(year) && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${MONTHS[month - 1]}-${String(day).padStart(2, '0')}`;
    }
  } catch {}
  return `${d.getUTCFullYear()}-${MONTHS[d.getUTCMonth()]}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
