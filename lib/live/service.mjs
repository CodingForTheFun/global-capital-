import { createEspnLiveProvider, LIVE_SPORTS } from './espn-provider.mjs';
import { resolveKey } from '../data-sources/sportsdataio/client.mjs';
import { BASE, FEEDS, TIMEFRAME, formatDate, leagueFor } from '../data-sources/sportsdataio/endpoints.mjs';
import { liveStatus } from '../data-sources/sportsdataio/normalize.mjs';
import { toNumberOrNull } from '../props/model.mjs';

const DEFAULT_SPORTS = Object.freeze([...LIVE_SPORTS]);
const SNAPSHOT_CACHE_MS = 5_000;
const text = (value) => {
  const cleaned = String(value ?? '').trim();
  return cleaned || null;
};
const score = (value) => toNumberOrNull(value);

function normalizeLegacyGame(sport, game) {
  if (!game || typeof game !== 'object') return null;
  const gameId = game.GameID ?? game.ScoreID ?? game.GlobalGameID ?? null;
  const homeTeam = text(game.HomeTeam ?? game.HomeTeamKey ?? game.HomeTeamName);
  const awayTeam = text(game.AwayTeam ?? game.AwayTeamKey ?? game.AwayTeamName);
  if (gameId === null || (!homeTeam && !awayTeam)) return null;
  const status = liveStatus(game) || (game.Canceled === true ? 'CANCELED' : null);
  const providerStatus = text(game.Status);
  const startTime = text(game.DateTimeUTC ?? game.DateTime ?? game.Day ?? game.GameDate);
  const period = toNumberOrNull(game.Quarter ?? game.Period ?? game.CurrentPeriod ?? game.Inning ?? game.CurrentInning);
  const periodLabel = text(game.PeriodName ?? game.QuarterDescription ?? game.InningDescription)
    || (period !== null ? String(period) : null);
  const clock = text(game.TimeRemaining ?? game.Clock ?? game.TimeRemainingMinutes);
  return {
    id: `${sport}:${gameId}`,
    gameId: String(gameId),
    eventId: String(gameId),
    competitionId: String(gameId),
    sport,
    league: sport,
    providerLeague: sport.toLowerCase(),
    homeTeam,
    homeTeamName: homeTeam,
    awayTeam,
    awayTeamName: awayTeam,
    homeScore: score(game.HomeTeamScore ?? game.HomeScore ?? game.HomeTeamRuns),
    awayScore: score(game.AwayTeamScore ?? game.AwayScore ?? game.AwayTeamRuns),
    status,
    providerStatus,
    statusDetail: null,
    startTime,
    period,
    periodLabel,
    clock,
    possession: text(game.Possession ?? game.PossessionTeam),
    inningHalf: text(game.InningHalf ?? game.Half),
    isOvertime: game.IsOvertime === true || /OT/i.test(providerStatus || ''),
    updatedAt: text(game.Updated ?? game.LastUpdated ?? game.DateTimeUTC) || null,
    playByPlayAvailable: false,
    broadcasts: [],
  };
}

function createLegacyProvider(client, now) {
  const timeframeCache = new Map();

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

  async function scoreboard(sport) {
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
    const games = (Array.isArray(result.data) ? result.data : []).map((game) => normalizeLegacyGame(sport, game)).filter(Boolean);
    return { sport, status: 200, errorType: null, latencyMs, games, feedCount: 1, activeFeedCount: 1 };
  }

  return {
    scoreboard,
    detail: async () => ({ ok: false, status: 404, errorType: 'PLAY_BY_PLAY_UNAVAILABLE', detail: null }),
    supportedSports: () => ['NBA', 'NFL', 'MLB', 'NHL', 'WNBA', 'NCAAB'],
    stats: () => client.stats(),
    clear: () => timeframeCache.clear(),
  };
}

function sortedGames(games) {
  const order = { LIVE: 0, DELAYED: 1, SCHEDULED: 2, POSTPONED: 3, FINAL: 4, CANCELED: 5 };
  return [...games].sort((a, b) => {
    const state = (order[a.status] ?? 9) - (order[b.status] ?? 9);
    if (state) return state;
    const left = Date.parse(a.startTime || '') || 0;
    const right = Date.parse(b.startTime || '') || 0;
    return left - right;
  });
}

export function createLiveService({ provider = null, client = null, now = () => new Date() } = {}) {
  const source = provider || (client ? createLegacyProvider(client, now) : createEspnLiveProvider());
  const cache = new Map();

  async function snapshot({ sports = DEFAULT_SPORTS, force = false } = {}) {
    const supported = source.supportedSports?.() || DEFAULT_SPORTS;
    const selected = [...new Set((Array.isArray(sports) && sports.length ? sports : supported)
      .map((sport) => String(sport || '').toUpperCase()).filter((sport) => supported.includes(sport)))];
    const cacheKey = selected.slice().sort().join(',');
    const prior = cache.get(cacheKey);
    if (!force && prior && Date.now() - prior.at < SNAPSHOT_CACHE_MS) return prior.value;
    const started = Date.now();
    const results = await Promise.all(selected.map((sport) => source.scoreboard(sport, { force })));
    const games = sortedGames(results.flatMap((row) => row.games || []));
    const value = {
      fetchedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      provider: client ? 'SportsDataIO compatibility' : 'ESPN public scoreboards',
      zeroCredit: !client,
      supportedSports: supported,
      games,
      live: games.filter((game) => game.status === 'LIVE' || game.status === 'DELAYED'),
      upcoming: games.filter((game) => ['SCHEDULED', 'POSTPONED'].includes(game.status)),
      final: games.filter((game) => ['FINAL', 'CANCELED'].includes(game.status)),
      coverage: results.map(({ sport, status, errorType, latencyMs, games: sportGames = [], feedCount, activeFeedCount }) => ({
        sport,
        status,
        errorType,
        latencyMs: latencyMs ?? null,
        recordCount: sportGames.length,
        feedCount: feedCount ?? 1,
        activeFeedCount: activeFeedCount ?? (status === 200 ? 1 : 0),
      })),
      clientStats: source.stats?.() || {},
    };
    cache.set(cacheKey, { at: Date.now(), value });
    if (cache.size > 32) cache.delete(cache.keys().next().value);
    return value;
  }

  async function gameDetail({ sport, providerLeague, eventId, competitionId, force = false } = {}) {
    const key = String(sport || '').toUpperCase();
    if (!key || !eventId) return { ok: false, available: false, errorType: 'INVALID_GAME', detail: null };
    const result = await source.detail({ sport: key, providerLeague, eventId, competitionId, force });
    return {
      ok: result.ok === true,
      available: result.ok === true && result.detail?.available === true,
      fetchedAt: new Date().toISOString(),
      latencyMs: result.latencyMs ?? null,
      errorType: result.errorType || null,
      detail: result.detail || null,
    };
  }

  return {
    snapshot,
    gameDetail,
    stats: () => source.stats?.() || {},
    clear: () => { cache.clear(); source.clear?.(); },
  };
}

export const liveService = createLiveService();
