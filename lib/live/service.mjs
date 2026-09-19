import { toNumberOrNull } from '../props/model.mjs';

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const CACHE_MS = 25_000;
const REQUEST_TIMEOUT_MS = 8_000;

const SCORE_FEEDS = Object.freeze({
  NFL: [{ path: 'football/nfl', label: 'NFL' }],
  NBA: [{ path: 'basketball/nba', label: 'NBA' }],
  MLB: [{ path: 'baseball/mlb', label: 'MLB' }],
  NHL: [{ path: 'hockey/nhl', label: 'NHL' }],
  WNBA: [{ path: 'basketball/wnba', label: 'WNBA' }],
  NCAAF: [{ path: 'football/college-football', label: 'NCAAF' }],
  NCAAB: [{ path: 'basketball/mens-college-basketball', label: 'NCAAB' }],
  SOCCER: [
    { path: 'soccer/usa.1', label: 'MLS' },
    { path: 'soccer/eng.1', label: 'EPL' },
    { path: 'soccer/uefa.champions', label: 'UCL' },
  ],
  TENNIS: [
    { path: 'tennis/atp', label: 'ATP' },
    { path: 'tennis/wta', label: 'WTA' },
  ],
});

const DEFAULT_SPORTS = Object.freeze(Object.keys(SCORE_FEEDS));

const text = (value) => {
  const cleaned = String(value ?? '').trim();
  return cleaned || null;
};

function dateToken(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
}

function score(value) {
  return toNumberOrNull(value);
}

function statusState(status) {
  const type = status?.type || status || {};
  const state = String(type.state || '').toLowerCase();
  if (state === 'in' || type.name === 'STATUS_IN_PROGRESS') return 'LIVE';
  if (state === 'post' || type.completed === true) return 'FINAL';
  if (state === 'pre') return 'SCHEDULED';
  const raw = String(type.name || type.description || type.detail || '').toLowerCase();
  if (/final|complete|postponed|canceled|cancelled/.test(raw)) return 'FINAL';
  if (/progress|halftime|intermission|delay/.test(raw)) return 'LIVE';
  return 'SCHEDULED';
}

function competitorIdentity(competitor = {}) {
  const team = competitor.team || {};
  const athlete = competitor.athlete || {};
  const abbreviation = text(team.abbreviation ?? team.shortDisplayName ?? athlete.shortName ?? athlete.abbreviation);
  const name = text(team.displayName ?? team.name ?? athlete.displayName ?? athlete.fullName ?? abbreviation);
  const logo = text(team.logo ?? team.logos?.[0]?.href ?? athlete.headshot?.href);
  return { abbreviation: abbreviation || name, name: name || abbreviation, logo };
}

function pickCompetitors(competition = {}) {
  const rows = Array.isArray(competition.competitors) ? competition.competitors : [];
  const home = rows.find((row) => row?.homeAway === 'home') || rows[1] || rows[0] || null;
  const away = rows.find((row) => row?.homeAway === 'away') || rows[0] || rows[1] || null;
  return { home, away };
}

function possessionName(competition, competitors) {
  const possession = text(competition?.situation?.possession);
  if (!possession) return null;
  const row = (Array.isArray(competition?.competitors) ? competition.competitors : [])
    .find((item) => String(item?.id ?? item?.team?.id ?? '') === possession);
  if (row) return competitorIdentity(row).abbreviation;
  if (String(competitors.home?.id ?? competitors.home?.team?.id ?? '') === possession) return competitorIdentity(competitors.home).abbreviation;
  if (String(competitors.away?.id ?? competitors.away?.team?.id ?? '') === possession) return competitorIdentity(competitors.away).abbreviation;
  return null;
}

function normalizeGame(sport, feed, event, fetchedAt) {
  if (!event || typeof event !== 'object') return null;
  const competition = Array.isArray(event.competitions) ? event.competitions[0] : null;
  if (!competition) return null;
  const gameId = event.id ?? competition.id ?? event.uid ?? null;
  if (gameId === null) return null;

  const competitors = pickCompetitors(competition);
  const home = competitorIdentity(competitors.home || {});
  const away = competitorIdentity(competitors.away || {});
  if (!home.abbreviation && !away.abbreviation) return null;

  const providerStatus = text(
    competition.status?.type?.shortDetail
      ?? event.status?.type?.shortDetail
      ?? competition.status?.type?.detail
      ?? event.status?.type?.detail
      ?? competition.status?.type?.description
      ?? event.status?.type?.description,
  );
  const statusObject = competition.status || event.status || {};
  const period = toNumberOrNull(statusObject.period);
  const clock = text(statusObject.displayClock);
  const status = statusState(statusObject);
  const league = text(feed?.label) || sport;
  const broadcasts = Array.isArray(competition.broadcasts) ? competition.broadcasts : [];
  const broadcast = text(broadcasts.flatMap((item) => Array.isArray(item?.names) ? item.names : []).filter(Boolean)[0]);
  const venue = text(competition.venue?.fullName);

  return {
    id: `${sport}:${gameId}`,
    gameId,
    sport,
    league,
    homeTeam: home.abbreviation,
    awayTeam: away.abbreviation,
    homeName: home.name,
    awayName: away.name,
    homeLogo: home.logo,
    awayLogo: away.logo,
    homeScore: score(competitors.home?.score),
    awayScore: score(competitors.away?.score),
    status,
    providerStatus,
    startTime: text(event.date ?? competition.date),
    period,
    periodLabel: status === 'LIVE' ? providerStatus : null,
    clock,
    possession: possessionName(competition, competitors),
    inningHalf: sport === 'MLB' && status === 'LIVE' ? providerStatus : null,
    isOvertime: /\bOT\b|overtime/i.test(providerStatus || ''),
    broadcast,
    venue,
    updatedAt: fetchedAt,
  };
}

function dedupeGames(games) {
  const byId = new Map();
  for (const game of games) {
    if (!game?.id) continue;
    const prior = byId.get(game.id);
    if (!prior || (game.status === 'LIVE' && prior.status !== 'LIVE')) byId.set(game.id, game);
  }
  return [...byId.values()];
}

function gameOrder(a, b) {
  const rank = { LIVE: 0, SCHEDULED: 1, FINAL: 2 };
  const stateDiff = (rank[a.status] ?? 3) - (rank[b.status] ?? 3);
  if (stateDiff) return stateDiff;
  const aTime = Date.parse(a.startTime || '') || 0;
  const bTime = Date.parse(b.startTime || '') || 0;
  return a.status === 'FINAL' ? bTime - aTime : aTime - bTime;
}

export function createLiveService({ fetcher = globalThis.fetch, now = () => new Date() } = {}) {
  const cache = new Map();
  const requestStats = { provider: 'espn-public', requests: 0, failures: 0, timeouts: 0 };

  function requestedWindow() {
    const current = now();
    const start = new Date(current);
    const end = new Date(current);
    start.setUTCDate(start.getUTCDate() - 1);
    end.setUTCDate(end.getUTCDate() + 3);
    return `${dateToken(start)}-${dateToken(end)}`;
  }

  async function fetchFeed(sport, feed, window) {
    if (typeof fetcher !== 'function') {
      return { ok: false, status: 0, errorType: 'FETCH_UNAVAILABLE', games: [], latencyMs: null };
    }
    const started = Date.now();
    const fetchedAt = now().toISOString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const url = `${ESPN_BASE}/${feed.path}/scoreboard?dates=${encodeURIComponent(window)}&limit=200`;
    requestStats.requests += 1;
    try {
      const response = await fetcher(url, {
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 ObligeProps/1.0',
        },
      });
      const latencyMs = Date.now() - started;
      if (!response?.ok) {
        requestStats.failures += 1;
        return { ok: false, status: response?.status || 0, errorType: `HTTP_${response?.status || 0}`, games: [], latencyMs };
      }
      const payload = await response.json();
      const games = (Array.isArray(payload?.events) ? payload.events : [])
        .map((event) => normalizeGame(sport, feed, event, fetchedAt))
        .filter(Boolean);
      return { ok: true, status: 200, errorType: null, games, latencyMs };
    } catch (error) {
      requestStats.failures += 1;
      if (error?.name === 'AbortError') requestStats.timeouts += 1;
      return {
        ok: false,
        status: 0,
        errorType: error?.name === 'AbortError' ? 'TIMEOUT' : 'FETCH_ERROR',
        games: [],
        latencyMs: Date.now() - started,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function gamesForSport(sport, window) {
    const feeds = SCORE_FEEDS[sport];
    if (!feeds) return { sport, status: 404, errorType: 'UNSUPPORTED_SPORT', latencyMs: null, games: [] };
    const rows = await Promise.all(feeds.map((feed) => fetchFeed(sport, feed, window)));
    const successful = rows.filter((row) => row.ok);
    const games = dedupeGames(rows.flatMap((row) => row.games)).sort(gameOrder);
    return {
      sport,
      status: successful.length ? 200 : (rows[0]?.status || 0),
      errorType: successful.length ? null : (rows[0]?.errorType || 'FEED_UNAVAILABLE'),
      latencyMs: rows.reduce((max, row) => Math.max(max, Number(row.latencyMs) || 0), 0) || null,
      games,
    };
  }

  async function snapshot({ sports = DEFAULT_SPORTS, force = false } = {}) {
    const selected = [...new Set((Array.isArray(sports) && sports.length ? sports : DEFAULT_SPORTS)
      .map((sport) => String(sport || '').toUpperCase()).filter(Boolean))];
    const key = selected.slice().sort().join(',');
    const cached = cache.get(key);
    if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.value;

    const started = Date.now();
    const window = requestedWindow();
    const results = await Promise.all(selected.map((sport) => gamesForSport(sport, window)));
    const games = dedupeGames(results.flatMap((row) => row.games)).sort(gameOrder);
    const value = {
      fetchedAt: now().toISOString(),
      latencyMs: Date.now() - started,
      provider: 'espn-public',
      window,
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
      clientStats: { ...requestStats },
    };
    cache.set(key, { at: Date.now(), value });
    return value;
  }

  return {
    snapshot,
    stats: () => ({ ...requestStats }),
    clear: () => cache.clear(),
  };
}

export const liveService = createLiveService();
