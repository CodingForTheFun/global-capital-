import { toNumberOrNull } from '../props/model.mjs';
import { sportradarTrialGet, sportradarTrialProductAvailable } from '../data-sources/sportradar/trial-products.mjs';

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

const SPORTRADAR_SCORE_PRODUCTS = Object.freeze({
  NFL: Object.freeze({ product: 'nfl', label: 'NFL', kind: 'nfl-current-week' }),
  NBA: Object.freeze({ product: 'nba', label: 'NBA', kind: 'daily' }),
  MLB: Object.freeze({ product: 'mlb', label: 'MLB', kind: 'daily' }),
  NHL: Object.freeze({ product: 'nhl', label: 'NHL', kind: 'daily' }),
  SOCCER: Object.freeze({ product: 'soccer', label: 'EPL', kind: 'soccer-daily' }),
});

const SCOREBOARD_UI_SPORTS = Object.freeze(['NFL','NBA','SOCCER','NHL','MLB']);

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


function radarStatusState(value) {
  const raw = String(value || '').toLowerCase();
  if (/closed|complete|completed|final|ended|after_match/.test(raw)) return 'FINAL';
  if (/inprogress|in_progress|live|halftime|intermission|overtime|1st|2nd|3rd|4th|inning|period/.test(raw)) return 'LIVE';
  return 'SCHEDULED';
}

function radarTeam(row = {}) {
  return {
    id: text(row.id ?? row.sr_id),
    abbreviation: text(row.alias ?? row.abbreviation ?? row.short_name ?? row.name),
    name: text(row.name ?? row.market ?? row.alias ?? row.abbreviation),
    logo: text(row.logo ?? row.logo_url),
  };
}

function radarStatusDetail(game, status) {
  if (status === 'FINAL') return 'FT';
  const raw = text(game?.clock ?? game?.display_clock ?? game?.match_status ?? game?.status);
  if (raw) return raw;
  const period = toNumberOrNull(game?.period ?? game?.quarter ?? game?.inning);
  return status === 'LIVE' && period !== null ? 'P' + period : null;
}

function normalizeRadarGame(sport, label, game, fetchedAt) {
  if (!game || typeof game !== 'object') return null;
  const home = radarTeam(game.home || game.home_team || {});
  const away = radarTeam(game.away || game.away_team || {});
  if (!home.name && !away.name) return null;
  const status = radarStatusState(game.status ?? game.match_status);
  const homeScore = score(
    game.home_points ?? game.home_score ?? game.scoring?.home_points ?? game.home?.points ?? game.home?.runs
  );
  const awayScore = score(
    game.away_points ?? game.away_score ?? game.scoring?.away_points ?? game.away?.points ?? game.away?.runs
  );
  return {
    id: sport + ':sr:' + text(game.id ?? game.sr_id ?? game.reference ?? Math.random()),
    gameId: text(game.id ?? game.sr_id ?? game.reference),
    sport,
    league: label || sport,
    homeTeam: home.abbreviation || home.name,
    awayTeam: away.abbreviation || away.name,
    homeName: home.name || home.abbreviation,
    awayName: away.name || away.abbreviation,
    homeLogo: home.logo,
    awayLogo: away.logo,
    homeScore,
    awayScore,
    status,
    providerStatus: radarStatusDetail(game, status),
    startTime: text(game.scheduled ?? game.start_time ?? game.startTime),
    period: toNumberOrNull(game.period ?? game.quarter ?? game.inning),
    periodLabel: status === 'LIVE' ? radarStatusDetail(game, status) : null,
    clock: text(game.clock ?? game.display_clock),
    possession: null,
    inningHalf: sport === 'MLB' && status === 'LIVE' ? text(game.half ?? game.inning_half) : null,
    isOvertime: /ot|overtime/i.test(text(game.status ?? game.match_status) || ''),
    broadcast: text(game.broadcast?.network ?? game.broadcast?.name ?? game.network),
    venue: text(game.venue?.name ?? game.venue?.full_name ?? game.venue?.fullName),
    updatedAt: fetchedAt,
    source: 'sportradar',
  };
}

function normalizeRadarSoccerSchedule(row, fetchedAt) {
  const event = row?.sport_event || row?.sportEvent || {};
  const statusRow = row?.sport_event_status || row?.sportEventStatus || {};
  const competitors = Array.isArray(event.competitors) ? event.competitors : [];
  const homeRaw = competitors.find((item) => String(item?.qualifier || '').toLowerCase() === 'home') || competitors[0] || {};
  const awayRaw = competitors.find((item) => String(item?.qualifier || '').toLowerCase() === 'away') || competitors[1] || {};
  const home = radarTeam(homeRaw), away = radarTeam(awayRaw);
  if (!home.name && !away.name) return null;
  const status = radarStatusState(statusRow.status ?? statusRow.match_status);
  const competition = event?.sport_event_context?.competition || {};
  return {
    id: 'SOCCER:sr:' + text(event.id ?? row.id),
    gameId: text(event.id ?? row.id),
    sport: 'SOCCER',
    league: text(competition.name ?? competition.alternative_name) || 'Soccer',
    homeTeam: home.abbreviation || home.name,
    awayTeam: away.abbreviation || away.name,
    homeName: home.name || home.abbreviation,
    awayName: away.name || away.abbreviation,
    homeLogo: home.logo,
    awayLogo: away.logo,
    homeScore: score(statusRow.home_score),
    awayScore: score(statusRow.away_score),
    status,
    providerStatus: status === 'FINAL' ? 'FT' : text(statusRow.match_status ?? statusRow.status),
    startTime: text(event.start_time ?? event.startTime),
    period: null,
    periodLabel: status === 'LIVE' ? text(statusRow.match_status) : null,
    clock: null,
    possession: null,
    inningHalf: null,
    isOvertime: false,
    broadcast: null,
    venue: text(event.venue?.name),
    updatedAt: fetchedAt,
    source: 'sportradar',
  };
}

function dateParts(value) {
  const d = value instanceof Date ? value : new Date(value);
  return {
    yyyy: String(d.getUTCFullYear()),
    mm: String(d.getUTCMonth() + 1).padStart(2, '0'),
    dd: String(d.getUTCDate()).padStart(2, '0'),
    iso: d.toISOString().slice(0, 10),
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

export function createLiveService({ fetcher = globalThis.fetch, now = () => new Date(), radarGet = sportradarTrialGet, radarAvailable = sportradarTrialProductAvailable } = {}) {
  const cache = new Map();
  const requestStats = { provider: 'espn-public', requests: 0, failures: 0, timeouts: 0 };

  // ESPN's scoreboard answers single days but rejects date ranges (HTTP 400),
  // so the window is read one day at a time: yesterday through three days
  // ahead. Days after today change slowly and are held for five minutes;
  // yesterday and today follow the 25 second snapshot cache.
  const dayCache = new Map();
  const LATER_DAY_MS = 5 * 60_000;

  function requestedDays() {
    const current = now();
    return [-1, 0, 1, 2, 3].map((offset) => {
      const day = new Date(current);
      day.setUTCDate(day.getUTCDate() + offset);
      return { token: dateToken(day), later: offset > 0 };
    });
  }

  async function fetchDay(sport, feed, day) {
    const key = `${feed.path}|${day.token}`;
    const held = day.later ? dayCache.get(key) : null;
    if (held && Date.now() - held.at < LATER_DAY_MS) return held.value;
    const value = await fetchFeed(sport, feed, day.token);
    if (day.later && value.ok) dayCache.set(key, { at: Date.now(), value });
    if (dayCache.size > 400) dayCache.clear();
    return value;
  }

  async function fetchFeedDays(sport, feed, days) {
    const rows = await Promise.all(days.map((day) => fetchDay(sport, feed, day)));
    const ok = rows.filter((row) => row.ok);
    if (!ok.length) return rows[0];
    return {
      ok: true,
      status: 200,
      errorType: null,
      games: ok.flatMap((row) => row.games),
      latencyMs: rows.reduce((max, row) => Math.max(max, Number(row.latencyMs) || 0), 0) || null,
    };
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


  async function fetchSportradarFallback(sport) {
    const config = SPORTRADAR_SCORE_PRODUCTS[sport];
    if (!config || !radarAvailable(config.product)) {
      return { ok: false, status: 0, errorType: 'SPORTRADAR_NOT_AVAILABLE', games: [], latencyMs: null };
    }
    const started = Date.now();
    const fetchedAt = now().toISOString();
    try {
      let result;
      if (config.kind === 'nfl-current-week') {
        result = await radarGet(config.product, '/games/current_week/schedule.json', {}, { ttlMs: 5 * 60_000, timeoutMs: 8_000 });
      } else if (config.kind === 'soccer-daily') {
        const date = dateParts(now()).iso;
        result = await radarGet(config.product, '/schedules/' + date + '/schedules.json', {}, { ttlMs: 2 * 60_000, timeoutMs: 8_000 });
      } else {
        const date = dateParts(now());
        result = await radarGet(config.product, '/games/' + date.yyyy + '/' + date.mm + '/' + date.dd + '/schedule.json', {}, { ttlMs: 5 * 60_000, timeoutMs: 8_000 });
      }
      if (!result?.ok) {
        return { ok: false, status: Number(result?.status) || 0, errorType: result?.code || 'SPORTRADAR_FAILED', games: [], latencyMs: Date.now() - started };
      }
      let games = [];
      if (config.kind === 'soccer-daily') {
        games = (Array.isArray(result.payload?.schedules) ? result.payload.schedules : [])
          .map((row) => normalizeRadarSoccerSchedule(row, fetchedAt))
          .filter(Boolean);
      } else {
        const raw = config.kind === 'nfl-current-week'
          ? (result.payload?.week?.games || result.payload?.games || [])
          : (result.payload?.games || []);
        games = (Array.isArray(raw) ? raw : [])
          .map((row) => normalizeRadarGame(sport, config.label, row, fetchedAt))
          .filter(Boolean);
      }
      return { ok: true, status: 200, errorType: null, games: dedupeGames(games).sort(gameOrder), latencyMs: Date.now() - started, source: 'sportradar' };
    } catch (error) {
      return { ok: false, status: Number(error?.status) || 0, errorType: text(error?.code || error?.name) || 'SPORTRADAR_FAILED', games: [], latencyMs: Date.now() - started };
    }
  }

  async function gamesForSport(sport, window) {
    const feeds = SCORE_FEEDS[sport];
    if (!feeds) return { sport, status: 404, errorType: 'UNSUPPORTED_SPORT', latencyMs: null, games: [], source: null };
    const rows = await Promise.all(feeds.map((feed) => fetchFeedDays(sport, feed, window)));
    const successful = rows.filter((row) => row.ok);
    if (successful.length) {
      const games = dedupeGames(rows.flatMap((row) => row.games)).sort(gameOrder);
      return {
        sport,
        status: 200,
        errorType: null,
        latencyMs: rows.reduce((max, row) => Math.max(max, Number(row.latencyMs) || 0), 0) || null,
        games,
        source: 'espn-public',
      };
    }

    // ESPN is the high-frequency source. Sportradar is a verified entitlement
    // fallback so a public-feed outage does not empty the score board or burn
    // the 1,000-request trials during normal 30-second polling.
    const radar = await fetchSportradarFallback(sport);
    return {
      sport,
      status: radar.ok ? 200 : (rows[0]?.status || radar.status || 0),
      errorType: radar.ok ? null : (rows[0]?.errorType || radar.errorType || 'FEED_UNAVAILABLE'),
      latencyMs: Math.max(
        rows.reduce((max, row) => Math.max(max, Number(row.latencyMs) || 0), 0),
        Number(radar.latencyMs) || 0,
      ) || null,
      games: radar.games || [],
      source: radar.ok ? 'sportradar' : null,
    };
  }

  async function snapshot({ sports = DEFAULT_SPORTS, force = false } = {}) {
    const selected = [...new Set((Array.isArray(sports) && sports.length ? sports : DEFAULT_SPORTS)
      .map((sport) => String(sport || '').toUpperCase()).filter(Boolean))];
    const key = selected.slice().sort().join(',');
    const cached = cache.get(key);
    if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.value;

    const started = Date.now();
    const days = requestedDays();
    const window = `${days[0].token}-${days[days.length - 1].token}`;
    const results = await Promise.all(selected.map((sport) => gamesForSport(sport, days)));
    const games = dedupeGames(results.flatMap((row) => row.games)).sort(gameOrder);
    const value = {
      fetchedAt: now().toISOString(),
      latencyMs: Date.now() - started,
      provider: results.some((row) => row.source === 'sportradar') ? 'score-mesh' : 'espn-public',
      window,
      games,
      live: games.filter((game) => game.status === 'LIVE'),
      upcoming: games.filter((game) => game.status === 'SCHEDULED'),
      final: games.filter((game) => game.status === 'FINAL'),
      coverage: results.map(({ sport, status, errorType, latencyMs, games: sportGames, source }) => ({
        sport,
        status,
        errorType,
        source: source || null,
        latencyMs: latencyMs ?? null,
        recordCount: sportGames.length,
      })),
      clientStats: { ...requestStats },
      scoreboardSports: [...SCOREBOARD_UI_SPORTS],
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
