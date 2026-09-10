import { createClient, isConfigured as sportsDataIoConfigured } from '../data-sources/sportsdataio/client.mjs';
import { BASE, FEEDS, TIMEFRAME, leagueFor, formatDate } from '../data-sources/sportsdataio/endpoints.mjs';
import { loadPlayerDirectory } from '../data-sources/sportsdataio/player-directory.mjs';
import { statFromRow, fieldsFor } from '../data-sources/sportsdataio/markets.mjs';
import { createSportsDataIoAdapter } from '../data-sources/sportsdataio/index.mjs';
import { rollingAnalytics } from '../analytics/rolling.mjs';
import { normalizePlayerName, sameTeam } from '../data-sources/contract.mjs';

const client = createClient({ timeoutMs: 9000, maxEntries: 1600 });
const adapter = createSportsDataIoAdapter({ client, timeoutMs: 9000, log: console });
const timeframeCache = new Map();
const directoryCache = new Map();
const MAX_GAMES = 40;
const text = (value) => String(value ?? '').trim();
const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

function cleanSport(value) {
  return text(value).toUpperCase();
}

function cleanSide(value) {
  return text(value).toUpperCase() === 'UNDER' ? 'UNDER' : 'OVER';
}

function normalizeTeam(value) {
  return text(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function gameDate(row) {
  return text(row?.DateTime ?? row?.DateTimeUTC ?? row?.Day ?? row?.Date) || null;
}

function homeFlag(row) {
  const hoa = text(row?.HomeOrAway).toUpperCase();
  if (hoa === 'HOME') return true;
  if (hoa === 'AWAY') return false;
  if (typeof row?.IsHome === 'boolean') return row.IsHome;
  return null;
}

function startedFlag(row) {
  if (typeof row?.Started === 'number') return row.Started > 0;
  if (typeof row?.Started === 'boolean') return row.Started;
  if (typeof row?.IsStarter === 'boolean') return row.IsStarter;
  return null;
}

function detailedGameLog(sport, market, rows = [], providerMarketKey = null) {
  if (!fieldsFor(sport, market, providerMarketKey)) return [];
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      gameId: text(row?.GameID ?? row?.GameId) || null,
      date: gameDate(row),
      opponent: text(row?.Opponent ?? row?.OpponentTeam) || null,
      team: text(row?.Team ?? row?.TeamKey) || null,
      isHome: homeFlag(row),
      started: startedFlag(row),
      minutes: num(row?.Minutes),
      value: statFromRow(sport, market, row, providerMarketKey),
      fantasyPoints: num(row?.FantasyPoints),
      points: num(row?.Points),
      rebounds: num(row?.Rebounds),
      assists: num(row?.Assists),
      threes: num(row?.ThreePointersMade),
      steals: num(row?.Steals),
      blocks: num(row?.BlockedShots),
      turnovers: num(row?.Turnovers),
      passingYards: num(row?.PassingYards),
      rushingYards: num(row?.RushingYards),
      receivingYards: num(row?.ReceivingYards),
      receptions: num(row?.Receptions),
      targets: num(row?.ReceivingTargets),
      hits: num(row?.Hits),
      totalBases: num(row?.TotalBases),
      strikeouts: num(row?.Strikeouts),
      shotsOnGoal: num(row?.ShotsOnGoal),
      saves: num(row?.Saves),
    }))
    .filter((row) => row.value !== null)
    .sort((a, b) => (Date.parse(b.date || 0) || 0) - (Date.parse(a.date || 0) || 0))
    .slice(0, MAX_GAMES);
}

function beats(value, line, side) {
  if (value === line) return null;
  return side === 'UNDER' ? value < line : value > line;
}

function decorateGameLog(rows, line, side) {
  const lineValue = num(line);
  return rows.map((row) => ({
    ...row,
    hit: lineValue === null ? null : beats(row.value, lineValue, side),
    push: lineValue === null ? null : row.value === lineValue,
  }));
}

function summary(rows, line, side) {
  if (!rows.length) return { games: 0, average: null, hitRate: null, hits: null, misses: null, pushes: null };
  const analytics = rollingAnalytics(rows, line, side);
  const s = analytics?.windows?.season || {};
  return {
    games: rows.length,
    average: s.average ?? null,
    hitRate: s.hitRate ?? null,
    hits: s.hits ?? null,
    misses: s.misses ?? null,
    pushes: s.pushes ?? null,
  };
}

async function timeframeFor(sport, league) {
  const key = `${sport}|${league.path}`;
  const cached = timeframeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  if (league.by !== 'week') {
    const value = { season: new Date().getUTCFullYear(), week: null };
    timeframeCache.set(key, { value, expiresAt: Date.now() + 60 * 60_000 });
    return value;
  }

  const [seasonResult, weekResult] = await Promise.all([
    client.get(`${BASE}/${TIMEFRAME.currentSeason(league)}`, TIMEFRAME.currentSeason(league), { ttlMs: 60 * 60_000, sport }),
    client.get(`${BASE}/${TIMEFRAME.currentWeek(league)}`, TIMEFRAME.currentWeek(league), { ttlMs: 30 * 60_000, sport }),
  ]);
  if (!seasonResult.ok || !weekResult.ok || seasonResult.data == null || weekResult.data == null) return null;
  const value = { season: seasonResult.data, week: weekResult.data };
  timeframeCache.set(key, { value, expiresAt: Date.now() + 30 * 60_000 });
  return value;
}

async function playerDirectory(sport, league, params) {
  const key = `${sport}|${params.season}|${params.week ?? ''}|${formatDate(new Date())}`;
  const cached = directoryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.directory;
  const directory = await loadPlayerDirectory({ client, sport, league, params });
  directoryCache.set(key, { directory, expiresAt: Date.now() + 20 * 60_000 });
  return directory;
}

function resolveDirectoryPlayer(directory, playerName, team) {
  const wanted = normalizePlayerName(playerName);
  if (!wanted) return null;
  const candidates = [...directory.values()].filter((row) => normalizePlayerName(row?.playerName) === wanted);
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];
  const teamKey = normalizeTeam(team);
  if (teamKey) {
    const teamMatches = candidates.filter((row) => normalizeTeam(row?.team) === teamKey || sameTeam(row?.team, team));
    if (teamMatches.length === 1) return teamMatches[0];
  }
  return null;
}

function inferOpponent({ team, homeTeam, awayTeam, opponent }) {
  if (text(opponent)) return text(opponent);
  if (!text(team)) return null;
  if (sameTeam(team, homeTeam)) return text(awayTeam) || null;
  if (sameTeam(team, awayTeam)) return text(homeTeam) || null;
  return null;
}

async function contextualEnrichment({ sport, playerName, team, opponent, market }) {
  try {
    const synthetic = {
      sport,
      playerName,
      team: team || null,
      opponent: opponent || null,
      market,
      line: null,
      side: 'OVER',
      gameStartTime: null,
      source: 'Auto Scout Research',
    };
    const map = await adapter.fetchEnrichment({ props: [synthetic] });
    const row = [...map.values()][0] || null;
    if (!row || row?.__identity?.matched === false) return null;
    const safe = { ...row };
    delete safe.__identity;
    delete safe.__fetchedAt;
    delete safe.__opponent;
    return safe;
  } catch {
    return null;
  }
}

export function researchHealth() {
  return {
    configured: sportsDataIoConfigured(),
    provider: 'SportsDataIO',
    client: client.stats(),
  };
}


/**
 * Turn any provider's raw game log into the shape the research UI renders.
 *
 * Both the SportsDataIO path and the ClearSports path end here, so the hit-rate
 * windows, the chart and the H2H split cannot disagree depending on which
 * provider answered.
 */
export function finalizeResearch({
  gameLog = [], line, side = 'OVER', market, sport,
  player = null, context = null, source = 'Historical stats',
  homeTeam = null, awayTeam = null, opponent = null, team = null,
  season = null, cached = false, coverage = {},
} = {}) {
  const lineValue = num(line);
  const selectedSide = String(side || 'OVER').toUpperCase() === 'UNDER' ? 'UNDER' : 'OVER';
  const rows = (Array.isArray(gameLog) ? gameLog : []).filter((row) => num(row?.value) !== null);
  if (!rows.length) {
    return { ok: true, available: false, code: 'NO_GAME_LOG_DATA', message: 'No usable historical games were returned for this player and market.' };
  }

  const inferredOpponent = inferOpponent({ team: team || player?.team, homeTeam, awayTeam, opponent });
  const analytics = rollingAnalytics(rows, lineValue, selectedSide);
  const h2hGames = inferredOpponent ? rows.filter((row) => sameTeam(row.opponent, inferredOpponent)) : [];
  const decorated = decorateGameLog(rows, lineValue, selectedSide);

  return {
    ok: true,
    available: true,
    source,
    fetchedAt: new Date().toISOString(),
    cached: Boolean(cached),
    player,
    matchup: { opponent: inferredOpponent, homeTeam: text(homeTeam) || null, awayTeam: text(awayTeam) || null },
    market,
    line: lineValue,
    side: selectedSide,
    season,
    windows: analytics.windows,
    trend: analytics.trend,
    splits: analytics.splits,
    h2h: summary(h2hGames, lineValue, selectedSide),
    context: context || null,
    gameLog: decorated,
    coverage: { gamesReturned: decorated.length, h2hGames: h2hGames.length, ...coverage },
  };
}

export async function researchPlayerProp({
  sport,
  playerName,
  providerPlayerId = null,
  team = null,
  homeTeam = null,
  awayTeam = null,
  opponent = null,
  market,
  // The odds provider's stable market key. Display labels drift, so this is
  // preferred when resolving which statistic a market refers to.
  providerMarketKey = null,
  line,
  side = 'OVER',
  games = 20,
} = {}) {
  const leagueKey = cleanSport(sport);
  const league = leagueFor(leagueKey);
  const selectedMarket = text(market);
  const selectedPlayer = text(playerName);
  const lineValue = num(line);
  const selectedSide = cleanSide(side);
  const take = Math.min(MAX_GAMES, Math.max(5, Number(games) || 20));

  if (!league || !selectedPlayer || !selectedMarket) {
    return { ok: false, available: false, code: 'INVALID_RESEARCH_REQUEST', message: 'Sport, player and market are required.' };
  }
  if (!fieldsFor(leagueKey, selectedMarket, providerMarketKey)) {
    return { ok: true, available: false, code: 'UNMAPPED_MARKET', message: 'Historical research is not mapped for this market yet.', sport: leagueKey, playerName: selectedPlayer, market: selectedMarket };
  }
  if (!sportsDataIoConfigured()) {
    return { ok: true, available: false, code: 'STATS_PROVIDER_NOT_CONFIGURED', message: 'Historical player data is not connected yet.' };
  }

  const tf = await timeframeFor(leagueKey, league);
  if (!tf?.season) {
    return { ok: true, available: false, code: 'SEASON_UNAVAILABLE', message: 'The current season could not be resolved.' };
  }
  const params = { date: formatDate(new Date()), season: tf.season, week: tf.week ?? null };

  let resolved = null;
  if (providerPlayerId) resolved = { playerId: String(providerPlayerId), playerName: selectedPlayer, team: text(team) || null };
  if (!resolved) {
    const directory = await playerDirectory(leagueKey, league, params);
    resolved = resolveDirectoryPlayer(directory, selectedPlayer, team);
  }
  if (!resolved?.playerId) {
    return {
      ok: true,
      available: false,
      code: 'PLAYER_NOT_MATCHED',
      message: 'This player could not be matched to the historical stats provider.',
      sport: leagueKey,
      playerName: selectedPlayer,
      market: selectedMarket,
    };
  }

  const inferredOpponent = inferOpponent({ team: resolved.team || team, homeTeam, awayTeam, opponent });
  const feed = FEEDS.playerGameLog;
  const path = feed.build(league, { season: tf.season, playerId: resolved.playerId, games: take });
  if (!path) {
    return { ok: true, available: false, code: 'GAME_LOG_UNAVAILABLE', message: 'Historical game logs are not available for this player.' };
  }

  const [logResult, context] = await Promise.all([
    client.get(`${BASE}/${path}`, path, { ttlMs: feed.ttlMs, sport: leagueKey }),
    contextualEnrichment({ sport: leagueKey, playerName: selectedPlayer, team: resolved.team || team, opponent: inferredOpponent, market: selectedMarket }),
  ]);

  if (!logResult.ok) {
    return {
      ok: true,
      available: false,
      code: logResult.status === 403 ? 'GAME_LOG_NOT_IN_PLAN' : 'GAME_LOG_PROVIDER_ERROR',
      message: logResult.status === 403 ? 'Historical game logs are not included in the current stats subscription.' : 'Historical game logs are temporarily unavailable.',
      providerStatus: logResult.status || null,
    };
  }

  const rawGames = detailedGameLog(leagueKey, selectedMarket, logResult.data, providerMarketKey).slice(0, take);
  if (!rawGames.length) {
    return { ok: true, available: false, code: 'NO_GAME_LOG_DATA', message: 'No usable historical games were returned for this player and market.' };
  }

  const analytics = rollingAnalytics(rawGames, lineValue, selectedSide);
  const h2hGames = inferredOpponent
    ? rawGames.filter((row) => sameTeam(row.opponent, inferredOpponent))
    : [];
  const decorated = decorateGameLog(rawGames, lineValue, selectedSide);

  return {
    ok: true,
    available: true,
    source: 'SportsDataIO',
    fetchedAt: new Date().toISOString(),
    cached: Boolean(logResult.cached),
    player: {
      playerName: selectedPlayer,
      providerPlayerId: String(resolved.playerId),
      team: text(resolved.team || team) || null,
    },
    matchup: {
      opponent: inferredOpponent,
      homeTeam: text(homeTeam) || null,
      awayTeam: text(awayTeam) || null,
    },
    market: selectedMarket,
    line: lineValue,
    side: selectedSide,
    season: tf.season,
    windows: analytics.windows,
    trend: analytics.trend,
    splits: analytics.splits,
    h2h: summary(h2hGames, lineValue, selectedSide),
    context: context || null,
    gameLog: decorated,
    coverage: {
      gamesReturned: decorated.length,
      h2hGames: h2hGames.length,
      mappedFields: fieldsFor(leagueKey, selectedMarket, providerMarketKey),
    },
  };
}
