import { createClient, resolveKey } from './client.mjs';
import { BASE, FEEDS, TIMEFRAME, formatDate, leagueFor } from './endpoints.mjs';
import { normalizePlayerPropOffers } from './odds.mjs';

const DEFAULT_SPORTS = Object.freeze(['NBA', 'NFL', 'MLB', 'NHL', 'WNBA', 'NCAAB', 'NCAAF']);
const MAX_GAMES = 40;
const CONCURRENCY = 4;
const BOARD_CACHE_MS = 30_000;

function gameIdOf(game) {
  const value = game?.GameID;
  return value === null || value === undefined || value === '' ? null : value;
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

  async function fetchSport(sport) {
    const league = leagueFor(sport);
    if (!league) return { sport, offers: [], gamesChecked: 0, status: 404, errorType: 'UNSUPPORTED_SPORT' };
    if (!resolveKey(sport)) return { sport, offers: [], gamesChecked: 0, status: 0, errorType: 'NOT_CONFIGURED' };

    const date = formatDate(now());
    let params = { date, season: now().getUTCFullYear(), week: null };
    if (league.by === 'week') {
      const resolved = await timeframe(sport, league);
      if (!resolved) return { sport, offers: [], gamesChecked: 0, status: 0, errorType: 'TIMEFRAME_UNAVAILABLE' };
      params = { date, season: resolved.season, week: resolved.week };
    }

    const gamePath = FEEDS.games.build(league, params);
    const gamesResult = await client.get(`${BASE}/${gamePath}`, gamePath, { ttlMs: FEEDS.games.ttlMs, sport });
    if (!gamesResult.ok) {
      return { sport, offers: [], gamesChecked: 0, status: gamesResult.status || 0, errorType: gamesResult.reason || 'GAMES_UNAVAILABLE' };
    }

    const games = uniqueGames(gamesResult.data);
    if (!games.length) return { sport, offers: [], gamesChecked: 0, status: 200, errorType: null };

    const results = await mapLimit(games, CONCURRENCY, async (game) => {
      const gameId = gameIdOf(game);
      const propPath = FEEDS.playerProps.build(league, { ...params, gameId });
      if (!propPath) return { ok: false, status: 404, reason: 'route unavailable', offers: [] };
      const result = await client.get(`${BASE}/${propPath}`, propPath, { ttlMs: FEEDS.playerProps.ttlMs, sport });
      if (!result.ok) return { ok: false, status: result.status || 0, reason: result.reason || 'feed unavailable', offers: [] };
      const context = {
        GameID: gameId,
        GameStartTime: game?.DateTime ?? game?.DateTimeUTC ?? game?.Day ?? null,
        HomeTeam: game?.HomeTeam ?? null,
        AwayTeam: game?.AwayTeam ?? null,
      };
      const payload = Array.isArray(result.data)
        ? { ...context, BettingMarkets: result.data }
        : { ...context, ...(result.data || {}), GameID: result.data?.GameID ?? gameId };
      return { ok: true, status: 200, reason: null, offers: normalizePlayerPropOffers(payload, { sport }) };
    });

    const offers = results.flatMap((row) => row?.offers || []);
    const failed = results.filter((row) => row && !row.ok);
    const firstFailure = failed[0] || null;
    return {
      sport,
      offers,
      gamesChecked: games.length,
      status: offers.length ? 200 : (firstFailure?.status || 200),
      errorType: offers.length ? null : (firstFailure?.reason || null),
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
      coverage: rows.map(({ sport, gamesChecked, status, errorType, offers }) => ({
        sport,
        gamesChecked,
        status,
        errorType,
        offerCount: offers.length,
      })),
      clientStats: client.stats(),
    };
    boardCache.set(cacheKey, { at: Date.now(), value });
    return value;
  }

  return { fetchBoard, stats: () => client.stats(), clear: () => boardCache.clear() };
}

export const sportsDataIoPropBoard = createSportsDataIoPropBoard();
