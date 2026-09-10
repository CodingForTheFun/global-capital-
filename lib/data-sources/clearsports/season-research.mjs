import { createClearSportsClient, endpointFor, isConfigured } from './client.mjs';
import { marketKey } from '../sportsdataio/markets.mjs';
import { normalizePlayerName } from '../contract.mjs';

const client = createClearSportsClient({ timeoutMs: 9000, maxEntries: 40 });
const PLAYER_STAT_SPORTS = new Set(['NFL', 'NCAAF', 'NCAAB', 'NBA', 'NHL']);
const SITE_SPORTS = Object.freeze(['NFL', 'NCAAF', 'NCAAB', 'NBA', 'NHL', 'MLB', 'WNBA']);
const FALLBACK_ONLY = Object.freeze({
  MLB: 'ClearSports documents MLB team stats but does not expose an MLB player-stats endpoint.',
  WNBA: 'ClearSports does not currently document WNBA endpoints.',
});
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

const FOOTBALL_FIELDS = Object.freeze({
  'passing yards': ['PassingYards'], 'pass yards': ['PassingYards'],
  'passing tds': ['PassingTouchdowns'], 'passing touchdowns': ['PassingTouchdowns'],
  'pass attempts': ['PassingAttempts'], 'passing attempts': ['PassingAttempts'],
  'pass completions': ['PassingCompletions'], 'passing completions': ['PassingCompletions'],
  'interceptions': ['PassingInterceptions'], 'passing interceptions': ['PassingInterceptions'],
  'rushing yards': ['RushingYards'], 'rush yards': ['RushingYards'],
  'rush attempts': ['RushingAttempts'], 'rushing attempts': ['RushingAttempts'],
  'rushing tds': ['RushingTouchdowns'], 'rushing touchdowns': ['RushingTouchdowns'],
  'receiving yards': ['ReceivingYards'], 'rec yards': ['ReceivingYards'],
  'receptions': ['Receptions'], 'targets': ['ReceivingTargets'],
  'receiving tds': ['ReceivingTouchdowns'], 'receiving touchdowns': ['ReceivingTouchdowns'],
  'rush+rec yards': ['RushingYards', 'ReceivingYards'],
  'rushing+receiving yards': ['RushingYards', 'ReceivingYards'],
  'pass+rush yards': ['PassingYards', 'RushingYards'],
  'passing+rushing yards': ['PassingYards', 'RushingYards'],
  'fantasy score': ['FantasyPoints'],
});

const BASKETBALL_FIELDS = Object.freeze({
  'points': ['Points'], 'rebounds': ['Rebounds'], 'assists': ['Assists'],
  'steals': ['Steals'], 'blocks': ['BlockedShots'], 'blocked shots': ['BlockedShots'],
  'turnovers': ['Turnovers'], '3-pt made': ['ThreePointersMade'],
  'three pointers': ['ThreePointersMade'], 'threes': ['ThreePointersMade'],
  '3 pointers made': ['ThreePointersMade'],
  'pts+reb+ast': ['Points', 'Rebounds', 'Assists'],
  'points+rebounds+assists': ['Points', 'Rebounds', 'Assists'],
  'pra': ['Points', 'Rebounds', 'Assists'],
  'points+rebounds': ['Points', 'Rebounds'], 'pts+reb': ['Points', 'Rebounds'],
  'points+assists': ['Points', 'Assists'], 'pts+ast': ['Points', 'Assists'],
  'rebounds+assists': ['Rebounds', 'Assists'], 'reb+ast': ['Rebounds', 'Assists'],
  'steals+blocks': ['Steals', 'BlockedShots'], 'stl+blk': ['Steals', 'BlockedShots'],
  'fantasy score': ['FantasyPoints'],
});

const HOCKEY_FIELDS = Object.freeze({
  'shots on goal': ['ShotsOnGoal'], 'shots': ['ShotsOnGoal'], 'goals': ['Goals'],
  'assists': ['Assists'], 'points': ['Goals', 'Assists'], 'hits': ['Hits'],
  'saves': ['Saves'], 'blocked shots': ['BlockedShots'],
  'power play points': ['PowerPlayPoints'], 'fantasy score': ['FantasyPoints'],
});

const MARKET_FIELDS = Object.freeze({
  NFL: FOOTBALL_FIELDS,
  NCAAF: FOOTBALL_FIELDS,
  NBA: BASKETBALL_FIELDS,
  NCAAB: BASKETBALL_FIELDS,
  NHL: HOCKEY_FIELDS,
});

const ALIASES = Object.freeze({
  Points: ['points', 'pts', 'points_total', 'points_scored'],
  Rebounds: ['rebounds', 'total_rebounds', 'totalRebounds', 'reb'],
  Assists: ['assists', 'ast'],
  Steals: ['steals', 'stl'],
  BlockedShots: ['blocked_shots', 'blockedShots', 'blocks', 'blk'],
  Turnovers: ['turnovers', 'tov'],
  ThreePointersMade: ['three_pointers_made', 'threePointersMade', 'three_point_field_goals_made', 'threePointFieldGoalsMade', 'threes_made'],
  FantasyPoints: ['fantasy_points', 'fantasyPoints'],
  PassingYards: ['passing_yards_yds', 'passing_yards', 'passingYards', 'pass_yards', 'passYards'],
  PassingTouchdowns: ['passing_yards_td', 'passing_touchdowns', 'passingTouchdowns', 'passing_tds', 'pass_tds'],
  PassingAttempts: ['passing_yards_att', 'passing_attempts', 'passingAttempts', 'pass_attempts'],
  PassingCompletions: ['passing_yards_cmp', 'passing_completions', 'passingCompletions', 'completions'],
  PassingInterceptions: ['passing_yards_int', 'passing_interceptions', 'passingInterceptions', 'interceptions_thrown'],
  RushingYards: ['rushing_yards_yds', 'rushing_yards', 'rushingYards', 'rush_yards', 'rushYards'],
  RushingAttempts: ['rushing_yards_att', 'rushing_attempts', 'rushingAttempts', 'rush_attempts', 'carries'],
  RushingTouchdowns: ['rushing_yards_td', 'rushing_touchdowns', 'rushingTouchdowns', 'rushing_tds', 'rush_tds'],
  ReceivingYards: ['receiving_yards_yds', 'receiving_yards', 'receivingYards', 'rec_yards', 'recYards'],
  Receptions: ['receiving_yards_rec', 'receptions', 'rec'],
  ReceivingTargets: ['receiving_yards_tgt', 'receiving_targets', 'receivingTargets', 'targets'],
  ReceivingTouchdowns: ['receiving_yards_td', 'receiving_touchdowns', 'receivingTouchdowns', 'receiving_tds', 'rec_tds'],
  Goals: ['goals'],
  ShotsOnGoal: ['shots_on_goal', 'shotsOnGoal', 'sog', 'shots'],
  Hits: ['hits'],
  Saves: ['saves'],
  PowerPlayPoints: ['power_play_points', 'powerPlayPoints', 'ppp'],
});

const text = (value) => String(value ?? '').trim();
const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

function unwrapRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const value of Object.values(payload)) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      for (const nested of Object.values(value)) if (Array.isArray(nested)) return nested;
    }
  }
  return [];
}

function playerName(row) {
  return text(row?.full_name ?? row?.fullName ?? row?.player_name ?? row?.playerName ?? row?.name);
}

function pickNumber(row, aliases) {
  for (const key of aliases || []) {
    const value = num(row?.[key]);
    if (value !== null) return value;
  }
  return null;
}

function fieldsForClearSports(sport, market) {
  const table = MARKET_FIELDS[String(sport || '').toUpperCase()];
  if (!table) return null;
  const key = marketKey(market).replace(/\s*\+\s*/g, '+');
  return table[key] || null;
}

function marketTotal(sport, market, row) {
  const fields = fieldsForClearSports(sport, market);
  if (!fields) return null;
  let total = 0;
  for (const field of fields) {
    const value = pickNumber(row, ALIASES[field] || [field, field.charAt(0).toLowerCase() + field.slice(1)]);
    if (value === null) return null;
    total += value;
  }
  return Number(total.toFixed(2));
}

function ttlMs() {
  const configured = Number(process.env.CLEARSPORTS_STATS_TTL_MS);
  return Number.isFinite(configured) && configured >= 60_000 ? configured : DEFAULT_TTL_MS;
}

export function clearSportsSeasonConfigured() {
  return isConfigured();
}

export function clearSportsSeasonHealth() {
  return {
    configured: isConfigured(),
    provider: 'ClearSports',
    mode: 'season-context',
    siteSports: SITE_SPORTS,
    playerStatSports: [...PLAYER_STAT_SPORTS],
    fallbackOnlySports: FALLBACK_ONLY,
    ttlMs: ttlMs(),
    client: client.stats(),
  };
}

export async function fetchClearSportsSeasonResearch({ sport, playerName: wantedName, market } = {}) {
  const league = text(sport).toUpperCase();
  const wanted = text(wantedName);
  if (!isConfigured()) return { ok: true, available: false, code: 'CLEARSPORTS_NOT_CONFIGURED', message: 'ClearSports is not configured.' };
  if (!SITE_SPORTS.includes(league)) return { ok: true, available: false, code: 'SPORT_UNSUPPORTED', message: 'This sport is not enabled in Auto Scout.' };
  if (!PLAYER_STAT_SPORTS.has(league)) {
    return {
      ok: true,
      available: false,
      code: 'CLEARSPORTS_PLAYER_STATS_UNAVAILABLE',
      message: FALLBACK_ONLY[league] || 'ClearSports does not expose player-stat research for this sport.',
      context: { providerCoverage: 'fallback-only', provider: 'ClearSports' },
    };
  }
  if (!fieldsForClearSports(league, market)) return { ok: true, available: false, code: 'UNMAPPED_MARKET', message: 'ClearSports season stats are not mapped for this market yet.' };

  const path = endpointFor(league, 'player-stats');
  const result = await client.get(path, { ttlMs: ttlMs() });
  if (!result.ok) {
    return {
      ok: true,
      available: false,
      code: result.status === 401 ? 'CLEARSPORTS_KEY_REJECTED' : result.status === 403 ? 'CLEARSPORTS_ACCESS_DENIED' : result.status === 429 ? 'CLEARSPORTS_RATE_LIMITED' : 'CLEARSPORTS_PROVIDER_ERROR',
      providerStatus: result.status || null,
      message: result.status === 403 ? 'ClearSports access or credits are unavailable.' : 'ClearSports season stats are temporarily unavailable.',
    };
  }

  const rows = unwrapRows(result.data);
  const normalized = normalizePlayerName(wanted);
  const row = rows.find((item) => normalizePlayerName(playerName(item)) === normalized) || null;
  if (!row) {
    return {
      ok: true,
      available: false,
      code: 'CLEARSPORTS_PLAYER_NOT_MATCHED',
      message: 'Player not found in the ClearSports season-stat feed.',
      diagnostics: { rowsReturned: rows.length, cached: Boolean(result.cached) },
    };
  }

  const seasonStat = marketTotal(league, market, row);
  const team = text(row?.team_id ?? row?.teamId ?? row?.team_abbreviation ?? row?.team) || null;
  const context = {
    seasonStat,
    seasonStatKind: 'season-total',
    playerImage: text(row?.player_image ?? row?.playerImage) || null,
    position: text(row?.position_display ?? row?.positionDisplay ?? row?.position) || null,
    team,
    dataSource: text(row?.data_source ?? row?.dataSource) || 'ClearSports',
    updatedAt: text(row?.updated_date ?? row?.updatedDate) || null,
    providerCoverage: 'season-player-stats',
  };

  return {
    ok: true,
    available: false,
    source: 'ClearSports',
    code: seasonStat === null ? 'CLEARSPORTS_SEASON_FIELD_UNMAPPED' : 'CLEARSPORTS_SEASON_ONLY',
    message: seasonStat === null
      ? 'ClearSports has this player, but this market is not present in its season-stat row.'
      : `ClearSports season total: ${seasonStat}. Game-level history is not provided, so L5/L10/L15 are unavailable from ClearSports.`,
    player: {
      playerName: playerName(row) || wanted,
      providerPlayerId: text(row?.id) || null,
      team,
    },
    context,
    diagnostics: {
      rowsReturned: rows.length,
      cached: Boolean(result.cached),
      ttlMs: ttlMs(),
      client: client.stats(),
    },
  };
}
