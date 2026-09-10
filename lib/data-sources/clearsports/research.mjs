import { createClearSportsClient, endpointFor, isConfigured } from './client.mjs';
import { fieldsFor } from '../sportsdataio/markets.mjs';
import { normalizePlayerName, sameTeam } from '../contract.mjs';

const client = createClearSportsClient({ timeoutMs: 9000, maxEntries: 300 });
const PLAYER_STAT_SPORTS = new Set(['NFL', 'NCAAF', 'NCAAB', 'NBA', 'NHL']);
const MAX_GAMES = 40;

const FIELD_ALIASES = Object.freeze({
  Points: ['Points', 'points', 'pts'],
  Rebounds: ['Rebounds', 'rebounds', 'total_rebounds', 'totalRebounds', 'reb'],
  Assists: ['Assists', 'assists', 'ast'],
  Steals: ['Steals', 'steals', 'stl'],
  BlockedShots: ['BlockedShots', 'blocked_shots', 'blockedShots', 'blocks', 'blk'],
  Turnovers: ['Turnovers', 'turnovers', 'tov'],
  ThreePointersMade: ['ThreePointersMade', 'three_pointers_made', 'threePointersMade', 'threes_made', 'threePointFieldGoalsMade'],
  FantasyPoints: ['FantasyPoints', 'fantasy_points', 'fantasyPoints'],
  PassingYards: ['PassingYards', 'passing_yards', 'passingYards', 'pass_yards', 'passYards'],
  PassingTouchdowns: ['PassingTouchdowns', 'passing_touchdowns', 'passingTouchdowns', 'passing_tds', 'pass_tds'],
  PassingAttempts: ['PassingAttempts', 'passing_attempts', 'passingAttempts', 'pass_attempts'],
  PassingCompletions: ['PassingCompletions', 'passing_completions', 'passingCompletions', 'completions'],
  PassingInterceptions: ['PassingInterceptions', 'passing_interceptions', 'passingInterceptions', 'interceptions_thrown'],
  RushingYards: ['RushingYards', 'rushing_yards', 'rushingYards', 'rush_yards', 'rushYards'],
  RushingAttempts: ['RushingAttempts', 'rushing_attempts', 'rushingAttempts', 'rush_attempts', 'carries'],
  RushingTouchdowns: ['RushingTouchdowns', 'rushing_touchdowns', 'rushingTouchdowns', 'rushing_tds', 'rush_tds'],
  ReceivingYards: ['ReceivingYards', 'receiving_yards', 'receivingYards', 'rec_yards', 'recYards'],
  Receptions: ['Receptions', 'receptions', 'rec'],
  ReceivingTargets: ['ReceivingTargets', 'receiving_targets', 'receivingTargets', 'targets'],
  ReceivingTouchdowns: ['ReceivingTouchdowns', 'receiving_touchdowns', 'receivingTouchdowns', 'receiving_tds', 'rec_tds'],
  Hits: ['Hits', 'hits', 'h'],
  Runs: ['Runs', 'runs', 'r'],
  RunsBattedIn: ['RunsBattedIn', 'runs_batted_in', 'runsBattedIn', 'rbi', 'rbis'],
  TotalBases: ['TotalBases', 'total_bases', 'totalBases', 'tb'],
  Strikeouts: ['Strikeouts', 'strikeouts', 'so', 'ks'],
  Singles: ['Singles', 'singles', '1b'],
  Doubles: ['Doubles', 'doubles', '2b'],
  StolenBases: ['StolenBases', 'stolen_bases', 'stolenBases', 'sb'],
  Walks: ['Walks', 'walks', 'bb'],
  EarnedRuns: ['EarnedRuns', 'earned_runs', 'earnedRuns', 'er'],
  ShotsOnGoal: ['ShotsOnGoal', 'shots_on_goal', 'shotsOnGoal', 'sog', 'shots'],
  Goals: ['Goals', 'goals'],
  HitsNhl: ['Hits', 'hits'],
  Saves: ['Saves', 'saves'],
  PowerPlayPoints: ['PowerPlayPoints', 'power_play_points', 'powerPlayPoints', 'ppp'],
});

const text = (value) => String(value ?? '').trim();
const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

function getPath(obj, path) {
  let value = obj;
  for (const key of String(path).split('.')) {
    if (value === null || value === undefined || typeof value !== 'object') return undefined;
    value = value[key];
  }
  return value;
}

function pick(row, aliases) {
  const containers = [row, row?.stats, row?.statistics, row?.player_stats, row?.playerStats, row?.totals, row?.data].filter(Boolean);
  for (const container of containers) {
    for (const alias of aliases) {
      const value = alias.includes('.') ? getPath(container, alias) : container?.[alias];
      if (value !== undefined && value !== null && value !== '') return value;
    }
  }
  return null;
}

function unwrapRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const candidates = ['data', 'results', 'player_stats', 'playerStats', 'stats', 'players', 'items'];
  for (const key of candidates) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      for (const inner of candidates) if (Array.isArray(value[inner])) return value[inner];
    }
  }
  return [];
}

function identity(row) {
  const playerObj = row?.player && typeof row.player === 'object' ? row.player : {};
  const teamObj = row?.team && typeof row.team === 'object' ? row.team : {};
  return {
    playerId: text(pick(row, ['player_id', 'playerId', 'athlete_id', 'athleteId']) ?? playerObj.id ?? playerObj.player_id) || null,
    playerName: text(pick(row, ['player_name', 'playerName', 'full_name', 'fullName', 'name']) ?? playerObj.name ?? playerObj.full_name) || null,
    team: text(pick(row, ['team_id', 'teamId', 'team_abbreviation', 'teamAbbreviation', 'team_name', 'teamName']) ?? teamObj.abbreviation ?? teamObj.id ?? teamObj.name) || null,
  };
}

function rowGameId(row) {
  const game = row?.game && typeof row.game === 'object' ? row.game : {};
  return text(pick(row, ['game_id', 'gameId', 'game_key', 'gameKey', 'event_id', 'eventId']) ?? game.id ?? game.game_id ?? game.game_key) || null;
}

function rowDate(row) {
  const game = row?.game && typeof row.game === 'object' ? row.game : {};
  return text(pick(row, ['game_date', 'gameDate', 'date', 'scheduled_at', 'scheduledAt', 'start_time', 'startTime', 'event_date', 'eventDate']) ?? game.date ?? game.scheduled_at ?? game.start_time) || null;
}

function teamName(value) {
  if (!value) return null;
  if (typeof value === 'string' || typeof value === 'number') return text(value) || null;
  return text(value.abbreviation ?? value.id ?? value.name ?? value.team_id ?? value.teamId) || null;
}

function normalizeGame(row) {
  const home = teamName(row?.home_team ?? row?.homeTeam ?? row?.home);
  const away = teamName(row?.away_team ?? row?.awayTeam ?? row?.away);
  return {
    id: text(row?.game_id ?? row?.gameId ?? row?.game_key ?? row?.gameKey ?? row?.id ?? row?.event_id ?? row?.eventId) || null,
    date: text(row?.scheduled_at ?? row?.scheduledAt ?? row?.game_date ?? row?.gameDate ?? row?.date ?? row?.start_time ?? row?.startTime) || null,
    home,
    away,
  };
}

function gameIndex(rows) {
  const map = new Map();
  for (const row of rows) {
    const game = normalizeGame(row);
    if (game.id) map.set(game.id, game);
  }
  return map;
}

function statValue(sport, market, row) {
  const fields = fieldsFor(sport, market);
  if (!fields) return null;
  let total = 0;
  for (const field of fields) {
    const aliases = FIELD_ALIASES[field] || [field, field.charAt(0).toLowerCase() + field.slice(1)];
    const value = num(pick(row, aliases));
    if (value === null) return null;
    total += value;
  }
  return Number(total.toFixed(2));
}

function inferGameContext(row, indexedGame, playerTeam) {
  const directOpponent = text(pick(row, ['opponent', 'opponent_team', 'opponentTeam', 'opponent_abbreviation', 'opponentAbbreviation'])) || null;
  const home = indexedGame?.home || teamName(row?.home_team ?? row?.homeTeam);
  const away = indexedGame?.away || teamName(row?.away_team ?? row?.awayTeam);
  let opponent = directOpponent;
  let isHome = null;
  if (playerTeam && home && sameTeam(playerTeam, home)) {
    isHome = true;
    opponent ||= away;
  } else if (playerTeam && away && sameTeam(playerTeam, away)) {
    isHome = false;
    opponent ||= home;
  }
  const directHome = pick(row, ['is_home', 'isHome']);
  if (typeof directHome === 'boolean') isHome = directHome;
  const hoa = text(pick(row, ['home_away', 'homeAway', 'home_or_away', 'homeOrAway'])).toUpperCase();
  if (hoa === 'HOME') isHome = true;
  if (hoa === 'AWAY') isHome = false;
  return { opponent, isHome };
}

function detailRow(sport, market, row, indexedGame) {
  const who = identity(row);
  const context = inferGameContext(row, indexedGame, who.team);
  return {
    gameId: rowGameId(row) || indexedGame?.id || null,
    date: rowDate(row) || indexedGame?.date || null,
    opponent: context.opponent,
    team: who.team,
    isHome: context.isHome,
    started: typeof pick(row, ['started', 'is_starter', 'isStarter']) === 'boolean' ? Boolean(pick(row, ['started', 'is_starter', 'isStarter'])) : null,
    minutes: num(pick(row, ['minutes', 'min', 'minutes_played', 'minutesPlayed'])),
    value: statValue(sport, market, row),
    fantasyPoints: num(pick(row, FIELD_ALIASES.FantasyPoints)),
    points: num(pick(row, FIELD_ALIASES.Points)),
    rebounds: num(pick(row, FIELD_ALIASES.Rebounds)),
    assists: num(pick(row, FIELD_ALIASES.Assists)),
    threes: num(pick(row, FIELD_ALIASES.ThreePointersMade)),
    steals: num(pick(row, FIELD_ALIASES.Steals)),
    blocks: num(pick(row, FIELD_ALIASES.BlockedShots)),
    turnovers: num(pick(row, FIELD_ALIASES.Turnovers)),
    passingYards: num(pick(row, FIELD_ALIASES.PassingYards)),
    rushingYards: num(pick(row, FIELD_ALIASES.RushingYards)),
    receivingYards: num(pick(row, FIELD_ALIASES.ReceivingYards)),
    receptions: num(pick(row, FIELD_ALIASES.Receptions)),
    targets: num(pick(row, FIELD_ALIASES.ReceivingTargets)),
    hits: num(pick(row, FIELD_ALIASES.Hits)),
    totalBases: num(pick(row, FIELD_ALIASES.TotalBases)),
    strikeouts: num(pick(row, FIELD_ALIASES.Strikeouts)),
    shotsOnGoal: num(pick(row, FIELD_ALIASES.ShotsOnGoal)),
    saves: num(pick(row, FIELD_ALIASES.Saves)),
  };
}

function matchesPlayer(row, wantedName, team) {
  const who = identity(row);
  if (!who.playerName || normalizePlayerName(who.playerName) !== normalizePlayerName(wantedName)) return false;
  if (team && who.team && !sameTeam(who.team, team)) return false;
  return true;
}

function injuryContext(rows, playerName, team) {
  const match = rows.find((row) => matchesPlayer(row, playerName, team));
  if (!match) return null;
  return {
    injury: text(pick(match, ['status', 'injury_status', 'injuryStatus', 'designation', 'injury', 'description'])) || null,
    injuryDetail: text(pick(match, ['description', 'detail', 'details', 'body_part', 'bodyPart'])) || null,
  };
}

export function clearSportsConfigured() {
  return isConfigured();
}

export function clearSportsCapabilities() {
  return {
    provider: 'ClearSports',
    playerStatsSports: [...PLAYER_STAT_SPORTS],
    note: 'MLB and WNBA player-game research are not advertised by the current ClearSports player-stats documentation.',
  };
}

export async function clearSportsHealth({ live = false } = {}) {
  const base = {
    configured: isConfigured(),
    provider: 'ClearSports',
    client: client.stats(),
    capabilities: clearSportsCapabilities(),
  };
  if (!live || !isConfigured()) return base;
  return { ...base, probe: await client.probe() };
}

export async function fetchClearSportsResearch({ sport, playerName, team = null, market, games = 20 } = {}) {
  const league = text(sport).toUpperCase();
  const selectedPlayer = text(playerName);
  const selectedMarket = text(market);
  const take = Math.min(MAX_GAMES, Math.max(5, Number(games) || 20));

  if (!isConfigured()) return { ok: true, available: false, code: 'CLEARSPORTS_NOT_CONFIGURED', message: 'ClearSports is not configured.' };
  if (!PLAYER_STAT_SPORTS.has(league)) {
    return { ok: true, available: false, code: 'CLEARSPORTS_SPORT_UNSUPPORTED', message: 'ClearSports does not currently advertise player-stat research for this sport.' };
  }
  if (!fieldsFor(league, selectedMarket)) {
    return { ok: true, available: false, code: 'UNMAPPED_MARKET', message: 'Historical research is not mapped for this market yet.' };
  }

  const statsPath = endpointFor(league, 'player-stats');
  const gamesPath = endpointFor(league, 'games');
  const injuriesPath = endpointFor(league, 'injury-stats');
  if (!statsPath || !gamesPath) return { ok: true, available: false, code: 'CLEARSPORTS_ROUTE_UNAVAILABLE', message: 'ClearSports route is unavailable for this sport.' };

  const [statsResult, gamesResult, injuriesResult] = await Promise.all([
    client.get(statsPath, { ttlMs: 3 * 60_000 }),
    client.get(gamesPath, { ttlMs: 5 * 60_000 }),
    injuriesPath ? client.get(injuriesPath, { ttlMs: 5 * 60_000 }) : Promise.resolve({ ok: false, data: null }),
  ]);

  if (!statsResult.ok) {
    return {
      ok: true,
      available: false,
      code: statsResult.status === 401 ? 'CLEARSPORTS_KEY_REJECTED' : statsResult.status === 403 ? 'CLEARSPORTS_ACCESS_DENIED' : 'CLEARSPORTS_PROVIDER_ERROR',
      message: statsResult.status === 401 ? 'The ClearSports API key was rejected.' : statsResult.status === 403 ? 'ClearSports access or credits are unavailable.' : 'ClearSports player stats are temporarily unavailable.',
      providerStatus: statsResult.status || null,
    };
  }

  const rows = unwrapRows(statsResult.data);
  const playerRows = rows.filter((row) => matchesPlayer(row, selectedPlayer, team));
  if (!playerRows.length) {
    return {
      ok: true,
      available: false,
      code: 'CLEARSPORTS_PLAYER_NOT_MATCHED',
      message: 'This player was not found in the ClearSports player stats feed.',
      providerStatus: statsResult.status || null,
      diagnostics: { rowsReturned: rows.length },
    };
  }

  const lookup = gameIndex(unwrapRows(gamesResult.data));
  const gameLog = playerRows
    .map((row) => detailRow(league, selectedMarket, row, lookup.get(rowGameId(row))))
    .filter((row) => row.value !== null && (row.gameId || row.date))
    .sort((a, b) => (Date.parse(b.date || 0) || 0) - (Date.parse(a.date || 0) || 0))
    .slice(0, take);

  if (!gameLog.length) {
    const aggregateValue = statValue(league, selectedMarket, playerRows[0]);
    return {
      ok: true,
      available: false,
      code: 'CLEARSPORTS_NO_GAME_LOG_DATA',
      message: 'ClearSports returned player stats, but not game-level rows that can safely power L5/L10/L15 research.',
      source: 'ClearSports',
      context: aggregateValue === null ? null : { seasonStat: aggregateValue },
      diagnostics: {
        playerRows: playerRows.length,
        gameRowsWithIdentity: playerRows.filter((row) => rowGameId(row) || rowDate(row)).length,
        sampleKeys: Object.keys(playerRows[0] || {}).slice(0, 30),
      },
    };
  }

  const who = identity(playerRows[0]);
  return {
    ok: true,
    available: true,
    source: 'ClearSports',
    fetchedAt: new Date().toISOString(),
    cached: Boolean(statsResult.cached),
    player: {
      playerName: selectedPlayer,
      providerPlayerId: who.playerId,
      team: who.team || team || null,
    },
    gameLog,
    context: injuryContext(unwrapRows(injuriesResult.data), selectedPlayer, team),
    diagnostics: {
      statsRows: rows.length,
      playerRows: playerRows.length,
      gamesIndexed: lookup.size,
      sampleKeys: Object.keys(playerRows[0] || {}).slice(0, 30),
    },
  };
}
