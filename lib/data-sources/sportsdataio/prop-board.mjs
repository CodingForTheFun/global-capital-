import { createClient, resolveKey } from './client.mjs';
import { BASE, FEEDS, TIMEFRAME, formatDate, leagueFor } from './endpoints.mjs';
import { normalizePlayerPropOffers, summarizePlayerPropShape } from './odds.mjs';
import { loadPlayerDirectory, resolveOfferPlayers } from './player-directory.mjs';

const DEFAULT_SPORTS = Object.freeze(['NBA', 'NFL', 'MLB', 'NHL', 'WNBA', 'NCAAB', 'NCAAF']);
const MAX_GAMES = 60;
const CONCURRENCY = 4;
const BOARD_CACHE_MS = 30_000;
const DATE_LOOKAHEAD_DAYS = 4; // today + next 3 slate dates for date-addressed leagues
const EMPTY_SHAPE = Object.freeze({
  marketNodes: 0,
  bettingOutcomes: 0,
  consensusOutcomes: 0,
  playerMarkets: 0,
  overUnderOutcomes: 0,
  numericLineOutcomes: 0,
  availableCoreOutcomes: 0,
  namedBookOutcomes: 0,
});

function gameIdOf(game) {
  const value = game?.GameID;
  return value === null || value === undefined || value === '' ? null : value;
}

function addDays(date, days) {
  return new Date(date.getTime() + Number(days || 0) * 86_400_000);
}

function uniqueGames(payload) {
  if (!Array.isArray(payload)) return [];
  const out = [];
  const seen = new Set();
  for (const game of payload) {
    const gameId = gameIdOf(game);
    if (gameId === null) continue;
    const key = String(gameId);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(game);
    if (out.length >= MAX_GAMES) break;
  }
  return out;
}

async function mapLimit(items, limit, fn) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), Math.max(1, items.length)) }, worker));
  return output;
}

function sumShapes(rows) {
  const total = { ...EMPTY_SHAPE };
  for (const row of rows) {
    for (const key of Object.keys(total)) total[key] += Number(row?.shape?.[key] || 0);
  }
  return total;
}

export function createSportsDataIoPropBoard({ client = createClient(), now = () => new Date() } = {}) {
  const timeframeCache = new Map();
  const boardCache = new Map();

  async function timeframe(sport, league) {
    if (league.by !== 'week') return { season: now().getUTCFullYear(), week: null };
    const cached = timeframeCache.get(league.path);
    if (cached && Date.now() - cached.at < 30 * 60_000) return cached;
    const [season, week] = await Promise.all([
      client.get(`${BASE}/${TIMEFRAME.currentSeason(league)}`, TIMEFRAME.currentSeason(league), { ttlMs: 60 * 60_000, sport }),
      client.get(`${BASE}/${TIMEFRAME.currentWeek(league)}`, TIMEFRAME.currentWeek(league), { ttlMs: 30 * 60_000, sport }),
    ]);
    if (!season.ok || !week.ok || season.data == null || week.data == null) return null;
    const value = { season: season.data, week: week.data, at: Date.now() };
    timeframeCache.set(league.path, value);
    return value;
  }

  async function loadGames(sport, league, params) {
    const requests = [];

    if (league.by === 'week') {
      const weeks = [params.week];
      const numericWeek = Number(params.week);
      if (Number.isFinite(numericWeek) && numericWeek >= 0) weeks.push(numericWeek + 1);
      for (const week of [...new Set(weeks.filter((value) => value !== null && value !== undefined))]) {
        const weekParams = { ...params, week };
        const path = FEEDS.games.build(league, weekParams);
        if (path) requests.push({ path, params: weekParams, label: `week:${week}` });
      }
    } else {
      for (let offset = 0; offset < DATE_LOOKAHEAD_DAYS; offset++) {
        const date = formatDate(addDays(now(), offset));
        const dateParams = { ...params, date };
        const path = FEEDS.games.build(league, dateParams);
        if (path) requests.push({ path, params: dateParams, label: date });
      }
    }

    const results = await Promise.all(requests.map(async (request) => {
      const result = await client.get(`${BASE}/${request.path}`, request.path, { ttlMs: FEEDS.games.ttlMs, sport });
      return { ...request, result };
    }));

    const successful = results.filter((row) => row.result?.ok);
    const games = uniqueGames(successful.flatMap((row) => Array.isArray(row.result.data) ? row.result.data : []));
    const firstFailure = results.find((row) => row.result && !row.result.ok)?.result || null;
    return {
      games,
      windowsChecked: requests.map((row) => row.label),
      status: successful.length ? 200 : (firstFailure?.status || 0),
      errorType: successful.length ? null : (firstFailure?.reason || 'GAMES_UNAVAILABLE'),
    };
  }

  async function fetchSport(sport) {
    const league = leagueFor(sport);
    if (!league) return { sport, offers: [], gamesChecked: 0, windowsChecked: [], unresolvedPlayers: 0, status: 404, errorType: 'UNSUPPORTED_SPORT', shape: { ...EMPTY_SHAPE } };
    if (!resolveKey(sport)) return { sport, offers: [], gamesChecked: 0, windowsChecked: [], unresolvedPlayers: 0, status: 0, errorType: 'NOT_CONFIGURED', shape: { ...EMPTY_SHAPE } };

    const date = formatDate(now());
    let params = { date, season: now().getUTCFullYear(), week: null };
    if (league.by === 'week') {
      const resolved = await timeframe(sport, league);
      if (!resolved) return { sport, offers: [], gamesChecked: 0, windowsChecked: [], unresolvedPlayers: 0, status: 0, errorType: 'TIMEFRAME_UNAVAILABLE', shape: { ...EMPTY_SHAPE } };
      params = { date, season: resolved.season, week: resolved.week };
    }

    const gameWindow = await loadGames(sport, league, params);
    const games = gameWindow.games;
    if (!games.length) {
      return {
        sport,
        offers: [],
        gamesChecked: 0,
        windowsChecked: gameWindow.windowsChecked,
        unresolvedPlayers: 0,
        status: gameWindow.status || 200,
        errorType: gameWindow.errorType,
        shape: { ...EMPTY_SHAPE },
      };
    }

    const results = await mapLimit(games, CONCURRENCY, async (game) => {
      const gameId = gameIdOf(game);
      const propPath = FEEDS.playerProps.build(league, { ...params, gameId });
      if (!propPath) return { ok: false, status: 404, reason: 'route unavailable', offers: [], shape: { ...EMPTY_SHAPE } };
      const result = await client.get(`${BASE}/${propPath}`, propPath, { ttlMs: FEEDS.playerProps.ttlMs, sport });
      if (!result.ok) return { ok: false, status: result.status || 0, reason: result.reason || 'feed unavailable', offers: [], shape: { ...EMPTY_SHAPE } };

      const context = {
        GameID: gameId,
        GameStartTime: game?.DateTime ?? game?.DateTimeUTC ?? game?.Day ?? null,
        HomeTeam: game?.HomeTeam ?? null,
        AwayTeam: game?.AwayTeam ?? null,
      };
      const payload = Array.isArray(result.data)
        ? { ...context, BettingMarkets: result.data }
        : { ...context, ...(result.data || {}), GameID: result.data?.GameID ?? gameId };
      return {
        ok: true,
        status: 200,
        reason: null,
        offers: normalizePlayerPropOffers(payload, { sport }),
        shape: summarizePlayerPropShape(payload),
      };
    });

    let offers = results.flatMap((row) => row?.offers || []);
    let unresolvedPlayers = 0;
    if (offers.some((offer) => !offer.playerName && offer.playerId)) {
      const directory = await loadPlayerDirectory({ client, sport, league, params });
      const resolved = resolveOfferPlayers(offers, directory);
      offers = resolved.offers;
      unresolvedPlayers = resolved.unresolved;
    }

    const failed = results.filter((row) => row && !row.ok);
    const firstFailure = failed[0] || null;
    return {
      sport,
      offers,
      gamesChecked: games.length,
      windowsChecked: gameWindow.windowsChecked,
      unresolvedPlayers,
      status: offers.length ? 200 : (firstFailure?.status || gameWindow.status || 200),
      errorType: offers.length ? null : (firstFailure?.reason || gameWindow.errorType || null),
      shape: sumShapes(results),
    };
  }

  async function fetchBoard({ sports = DEFAULT_SPORTS, force = false } = {}) {
    const selected = [...new Set((Array.isArray(sports) && sports.length ? sports : DEFAULT_SPORTS)
      .map((sport) => String(sport || '').toUpperCase())
      .filter(Boolean))];
    const cacheKey = selected.slice().sort().join(',');
    const cached = boardCache.get(cacheKey);
    if (!force && cached && Date.now() - cached.at < BOARD_CACHE_MS) return cached.value;

    const started = Date.now();
    const rows = await Promise.all(selected.map(fetchSport));
    const value = {
      fetchedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      sports: selected,
      offers: rows.flatMap((row) => row.offers),
      coverage: rows.map(({ sport, gamesChecked, windowsChecked, unresolvedPlayers, status, errorType, offers, shape }) => ({
        sport,
        gamesChecked,
        windowsChecked,
        unresolvedPlayers,
        status,
        errorType,
        offerCount: offers.length,
        shape,
      })),
      clientStats: client.stats(),
    };
    boardCache.set(cacheKey, { at: Date.now(), value });
    return value;
  }

  return { fetchBoard, stats: () => client.stats(), clear: () => boardCache.clear() };
}

export const sportsDataIoPropBoard = createSportsDataIoPropBoard();
