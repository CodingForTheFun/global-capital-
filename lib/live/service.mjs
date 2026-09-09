import { createClient, resolveKey } from '../data-sources/sportsdataio/client.mjs';
import { BASE, FEEDS, TIMEFRAME, formatDate, leagueFor } from '../data-sources/sportsdataio/endpoints.mjs';
import { liveStatus } from '../data-sources/sportsdataio/normalize.mjs';
import { toNumberOrNull } from '../props/model.mjs';

const DEFAULT_SPORTS = Object.freeze(['NBA', 'NFL', 'MLB', 'NHL', 'WNBA', 'NCAAB']);
const CACHE_MS = 20_000;
const text = (value) => {
  const cleaned = String(value ?? '').trim();
  return cleaned || null;
};

function score(value) {
  return toNumberOrNull(value);
}

function normalizeGame(sport, game) {
  if (!game || typeof game !== 'object') return null;
  const gameId = game.GameID ?? game.ScoreID ?? game.GlobalGameID ?? null;
  const homeTeam = text(game.HomeTeam ?? game.HomeTeamKey ?? game.HomeTeamName);
  const awayTeam = text(game.AwayTeam ?? game.AwayTeamKey ?? game.AwayTeamName);
  if (gameId === null || (!homeTeam && !awayTeam)) return null;
  const status = liveStatus(game) || (game.Canceled === true ? 'FINAL' : null);
  const providerStatus = text(game.Status);
  const startTime = text(game.DateTimeUTC ?? game.DateTime ?? game.Day ?? game.GameDate);
  const period = toNumberOrNull(game.Quarter ?? game.Period ?? game.CurrentPeriod ?? game.Inning ?? game.CurrentInning);
  const periodLabel = text(game.PeriodName ?? game.QuarterDescription ?? game.InningDescription)
    || (period !== null ? String(period) : null);
  const clock = text(game.TimeRemaining ?? game.Clock ?? game.TimeRemainingMinutes);
  const homeScore = score(game.HomeTeamScore ?? game.HomeScore ?? game.HomeTeamRuns);
  const awayScore = score(game.AwayTeamScore ?? game.AwayScore ?? game.AwayTeamRuns);
  return {
    id: `${sport}:${gameId}`,
    gameId,
    sport,
    league: sport,
    homeTeam,
    awayTeam,
    homeScore,
    awayScore,
    status,
    providerStatus,
    startTime,
    period,
    periodLabel,
    clock,
    possession: text(game.Possession ?? game.PossessionTeam),
    inningHalf: text(game.InningHalf ?? game.Half),
    isOvertime: game.IsOvertime === true || /OT/i.test(providerStatus || ''),
    updatedAt: text(game.Updated ?? game.LastUpdated ?? game.DateTimeUTC) || null,
  };
}

export function createLiveService({ client = createClient(), now = () => new Date() } = {}) {
  const timeframeCache = new Map();
  let cache = null;
  let cacheAt = 0;

  async function timeframe(sport, league) {
    if (league.by !== 'week') return { season: now().getUTCFullYear(), week: null };
    const prior = timeframeCache.get(league.path);
    if (prior && Date.now() - prior.at < 30 * 60_000) return prior;
    const [season, week] = await Promise.all([
      client.get(`${BASE}/${TIMEFRAME.currentSeason(league)}`, TIMEFRAME.currentSeason(league), { ttlMs: 60 * 60_000, sport }),
      client.get(`${BASE}/${TIMEFRAME.currentWeek(league)}`, TIMEFRAME.currentWeek(league), { ttlMs: 30 * 60_000, sport }),
    ]);
    if (!season.ok || !week.ok || season.data == null || week.data == null) return null;
    const value = { season: season.data, week: week.data, at: Date.now() };
    timeframeCache.set(league.path, value);
    return value;
  }

  async function gamesForSport(sport) {
    const league = leagueFor(sport);
    if (!league) return { sport, status: 404, errorType: 'UNSUPPORTED_SPORT', games: [] };
    if (!resolveKey(sport)) return { sport, status: 0, errorType: 'NOT_CONFIGURED', games: [] };
    const date = formatDate(now());
    let params = { date, season: now().getUTCFullYear(), week: null };
    if (league.by === 'week') {
      const resolved = await timeframe(sport, league);
      if (!resolved) return { sport, status: 0, errorType: 'TIMEFRAME_UNAVAILABLE', games: [] };
      params = { date, season: resolved.season, week: resolved.week };
    }
    const path = FEEDS.games.build(league, params);
    if (!path) return { sport, status: 404, errorType: 'ROUTE_UNAVAILABLE', games: [] };
    const started = Date.now();
    const result = await client.get(`${BASE}/${path}`, path, { ttlMs: FEEDS.games.ttlMs, sport });
    const latencyMs = Date.now() - started;
    if (!result.ok) return { sport, status: result.status || 0, errorType: result.reason || 'PROVIDER_ERROR', latencyMs, games: [] };
    const games = (Array.isArray(result.data) ? result.data : []).map((game) => normalizeGame(sport, game)).filter(Boolean);
    return { sport, status: 200, errorType: null, latencyMs, games };
  }

  async function snapshot({ sports = DEFAULT_SPORTS, force = false } = {}) {
    if (!force && cache && Date.now() - cacheAt < CACHE_MS) return cache;
    const selected = [...new Set((Array.isArray(sports) && sports.length ? sports : DEFAULT_SPORTS)
      .map((sport) => String(sport || '').toUpperCase()).filter(Boolean))];
    const started = Date.now();
    const results = await Promise.all(selected.map(gamesForSport));
    const games = results.flatMap((row) => row.games);
    const value = {
      fetchedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      games,
      live: games.filter((game) => game.status === 'LIVE'),
      upcoming: games.filter((game) => game.status === 'SCHEDULED'),
      final: games.filter((game) => game.status === 'FINAL'),
      coverage: results.map(({ sport, status, errorType, latencyMs, games: sportGames }) => ({
        sport,
        status,
        errorType,
        latencyMs: latencyMs ?? null,
        recordCount: sportGames.length,
      })),
      clientStats: client.stats(),
    };
    cache = value;
    cacheAt = Date.now();
    return value;
  }

  return { snapshot, stats: () => client.stats(), clear: () => { cache = null; cacheAt = 0; } };
}

export const liveService = createLiveService();
