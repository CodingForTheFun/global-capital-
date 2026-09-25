// Raw box-score archive, NOT historical grades against different posted lines.
// Contract: https://prop-line.com/docs#player-game-log (reviewed 2026-09-18).
// This module is on-demand only; it has no scheduler, backfill or database writes.
import { proplineConfigured, proplineGet } from './client.mjs';
import { SPORT_KEYS } from './markets.mjs';

const text = value => String(value ?? '').trim();
const nameKey = value => text(value).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
const key = value => text(value).toLowerCase().replace(/[^a-z0-9]/g, '');
const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value
  : typeof value === 'string' && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim()) ? Number(value) : null;
// Legacy sport aliases reuse the existing provider contract. The canonical
// workspace uses the provider's live catalog and does not depend on this map.
export const PROPLINE_GAME_SPORTS = Object.freeze({ ...SPORT_KEYS, PGA: 'golf', MMA: 'mma_ufc', CS2: 'esports' });
function schema(entries) {
  const output = Object.create(null);
  for (const [stat, aliases] of Object.entries(entries)) for (const alias of [stat, ...aliases]) output[key(alias)] = stat;
  return Object.freeze(output);
}
const basketball = schema({
  points: ['player_points'], rebounds: ['player_rebounds'], offensive_rebounds: ['player_offensive_rebounds', 'Offensive Rebounds'], defensive_rebounds: ['player_defensive_rebounds', 'Defensive Rebounds'], assists: ['player_assists'],
  field_goals_made: ['player_fg_made', 'player_field_goals_made', 'FG Made', 'Field Goals Made'], field_goals_attempted: ['player_fg_attempted', 'player_field_goals_attempted', 'FG Attempted', 'Field Goals Attempted'],
  free_throws_made: ['player_free_throws_made', 'player_ft_made', 'Free Throws Made'], free_throws_attempted: ['player_free_throws_attempted', 'player_ft_attempted', 'Free Throws Attempted'],
  threes: ['player_threes', '3-Pointers Made', 'Three Pointers Made'], three_pointers_attempted: ['player_three_pointers_attempted', '3-Pointers Attempted', 'Three Pointers Attempted'], personal_fouls: ['player_personal_fouls', 'Personal Fouls'], steals: ['player_steals'],
  blocks: ['player_blocks', 'Blocked Shots'], turnovers: ['player_turnovers'],
  points_rebounds: ['player_points_rebounds'], points_assists: ['player_points_assists'],
  rebounds_assists: ['player_rebounds_assists'], points_rebounds_assists: ['player_points_rebounds_assists', 'PRA'],
});
const football = schema({
  passing_yards: ['player_pass_yds', 'Pass Yards'], passing_tds: ['player_pass_tds', 'Passing Touchdowns'],
  passing_attempts: ['player_pass_attempts', 'Pass Attempts'], passing_completions: ['player_pass_completions', 'Pass Completions'],
  interceptions: ['player_pass_interceptions', 'Passing Interceptions'], longest_completion: ['player_longest_completion', 'player_pass_longest_completion', 'Longest Pass Completion'],
  rushing_yards: ['player_rush_yds', 'Rush Yards'], rushing_tds: ['player_rush_tds', 'Rushing Touchdowns'],
  rushing_attempts: ['player_rush_attempts', 'Rush Attempts'], longest_rush: ['player_rush_longest'],
  receiving_yards: ['player_reception_yds', 'Receiving Yards'], receiving_tds: ['player_reception_tds', 'Receiving Touchdowns'],
  receptions: ['player_receptions'], longest_reception: ['player_reception_longest'],
  pass_rush_yds: ['player_pass_rush_yds', 'Passing + Rushing Yards'], rush_reception_yds: ['player_rush_reception_yds', 'Rushing + Receiving Yards'],
  sacks: ['player_sacks'], fumbles_lost: ['player_fumbles_lost'],
  field_goals_made: ['player_field_goals_made'], extra_points_made: ['player_extra_points_made'], kicking_points: ['player_kicking_points'],
});
const baseball = schema({
  hits: ['batter_hits'], total_bases: ['batter_total_bases'], singles: ['batter_singles'], doubles: ['batter_doubles'],
  triples: ['batter_triples'], home_runs: ['batter_home_runs'], runs: ['batter_runs'], rbis: ['batter_rbis', 'Runs Batted In'],
  walks: ['batter_walks'], stolen_bases: ['batter_stolen_bases'], hits_runs_rbis: ['batter_hits_runs_rbis'],
  batter_strikeouts: ['Batter Strikeouts'], strikeouts: ['pitcher_strikeouts', 'Pitcher Strikeouts'],
  earned_runs: ['pitcher_earned_runs', 'Earned Runs Allowed'], hits_allowed: ['pitcher_hits_allowed'], outs: ['pitcher_outs', 'Pitching Outs'],
});
const hockey = schema({
  goals: ['player_goals'], points_nhl: ['player_points', 'Points'], shots_on_goal: ['player_shots_on_goal'],
  blocked_shots: ['player_blocked_shots'], power_play_points: ['player_power_play_points'], saves: ['player_saves', 'Goalie Saves'],
});
const soccer = schema({
  goals: ['player_goals'], assists: ['player_assists'], shots: ['player_shots'], shots_on_target: ['player_shots_on_target'],
  yellow_cards: ['player_yellow_cards'], red_cards: ['player_red_cards'], cards: ['player_cards'],
  fouls_committed: ['player_fouls_committed'], fouls_suffered: ['player_fouls_suffered'],
  offsides: ['player_offsides'], saves: ['player_saves', 'Goalkeeper Saves'], goals_conceded: ['player_goals_conceded'],
});
const tennis = schema({
  total_games: ['player_total_games', 'tennis_total_games', 'match_total_games'],
  sets_won: ['player_sets_won'], games_w: ['player_games_won', 'Games Won'],
  aces: ['player_aces'], dblfaults: ['player_double_faults', 'Double Faults'],
  breakpts_w: ['player_break_points_won', 'Break Points Won'], tiebreaks: ['Tie Breaks'],
  set_1_games: ['Set 1 Games'], set_2_games: ['Set 2 Games'], set_3_games: ['Set 3 Games'], set_4_games: ['Set 4 Games'], set_5_games: ['Set 5 Games'],
});
const golf = schema({ strokes: ['player_strokes'], birdies: ['player_birdies'], eagles: ['player_eagles'], pars: ['player_pars'], bogeys_ow: ['Bogeys Or Worse'], total_score: ['player_total_score'] });
// Completed rounds are not interchangeable with fractional total-round lines.
const mma = schema({ significant_strikes: ['player_significant_strikes'], takedowns: ['player_takedowns'], completed_rounds: ['fight_completed_rounds'] });
const esports = schema({ kills_map_1: [], kills_maps_1_2: [], kills_maps_1_2_3: [], headshots_map_1: [], headshots_maps_1_2: [], headshots_maps_1_2_3: [] });
const schemas = { NFL: football, NCAAF: football, NBA: basketball, WNBA: basketball, NCAAB: basketball, MLB: baseball, NHL: hockey, TENNIS: tennis, MLS: soccer, EPL: soccer, UCL: soccer, PGA: golf, MMA: mma, CS2: esports };

export function rawStatFor(params = {}) {
  const sport = text(params.sport).toUpperCase(), mapping = schemas[sport];
  if (!mapping || !PROPLINE_GAME_SPORTS[sport]) return null;
  if (/\s+\+\s+/.test(text(params.playerName)) || /fantasy|\bcombo\b/i.test(text(params.market))) return null;
  const period = text(params.period).toLowerCase();
  if (period && !['full', 'full_game', 'game', 'match'].includes(period)) return null;
  if (/\b(?:q[1-4]|[1-4](?:st|nd|rd|th)\s+(?:quarter|period)|(?:first|second)\s+half|[12]h|innings?|round\s*\d+)\b/i.test(text(params.market))) return null;
  const raw = text(params.providerMarketKey || params.marketId || params.market);
  return mapping[key(raw)] || null;
}
const unavailable = (code, message, retryable = false) => ({ ok: true, available: false, lineOnly: true, code, message, retryable, gameLog: [] });

// PropLine documents home_score/away_score, is_home and a flat stats map
// (tennis adds sets_won/sets_w, matches_w and opp_* mirrors). Those are the
// primary sources below. The undocumented result, score_for, score_against and
// season_type are read only as cross-checks: any disagreement yields null.
const RESULT_CODES = Object.freeze({ W: 'W', L: 'L', T: 'T', D: 'T' });
const statedResult = value => RESULT_CODES[text(value).toUpperCase()] || null;
function seasonTypeOf(value) {
  const n = numeric(value);
  if (n === 2 || n === 3) return n;
  const label = text(value).toLowerCase().replace(/[\s_-]+/g, ' ');
  if (['regular', 'reg', 'regular season'].includes(label)) return 2;
  if (['post', 'postseason', 'playoff', 'playoffs'].includes(label)) return 3;
  return null;
}
/** The single value every present source agrees on; none present or a conflict is null. */
function agreed(...values) {
  const present = values.filter(value => value !== null && value !== undefined);
  if (!present.length || present.some(value => value !== present[0])) return null;
  return present[0];
}
const statsOf = row => (row?.stats && typeof row.stats === 'object' ? row.stats : {});

/**
 * A tennis row names both players as the event's home/away participants and
 * often leaves `opponent` empty. The opponent is the other participant only
 * when exactly one side is this player by exact name; anything else is null.
 * Tennis "home" is an arbitrary slot, so it is never turned into a venue.
 */
export function participantOpponent(row, playerName) {
  const home = text(row?.home_team), away = text(row?.away_team), me = nameKey(playerName);
  if (!home || !away || !me || nameKey(home) === nameKey(away)) return null;
  if (nameKey(home) === me) return away;
  if (nameKey(away) === me) return home;
  return null;
}

/** 'home' or 'away' when exactly one participant is this player by exact name. */
function participantSide(row, playerName) {
  const opponent = participantOpponent(row, playerName);
  if (!opponent) return null;
  return nameKey(opponent) === nameKey(row?.away_team) ? 'home' : 'away';
}

/**
 * The event score from this player's side, from home_score/away_score and the
 * side the player was on (`is_home`, or for tennis the named participant).
 */
function sideScore(row, side) {
  const home = numeric(row?.home_score), away = numeric(row?.away_score);
  if (!side || home === null || away === null) return null;
  return side === 'home' ? { for: home, against: away } : { for: away, against: home };
}

/**
 * Set score of a completed tennis match from the player's side. The player's
 * sets come from sets_won/sets_w; the opponent's from opp_sets_w, the event
 * score on the player's named side (only when it equals the player's sets, as
 * it may otherwise be games), or the number of per-set game rows. Every source
 * present must agree. The winner must have reached 2 (best of 3) or 3 (best of
 * 5) sets; retirements, conflicts and partial scores return null.
 */
export function tennisSetScore(row, playerName = row?.player_name) {
  const stats = statsOf(row);
  const setsWon = agreed(numeric(stats.sets_won), numeric(stats.sets_w));
  if (setsWon === null) return null;
  const setRows = [1, 2, 3, 4, 5].filter(n => numeric(stats[`set_${n}_games`]) !== null).length || null;
  const event = sideScore(row, participantSide(row, playerName));
  const legacyFor = numeric(row?.score_for), legacyAgainst = numeric(row?.score_against);
  const setsLost = agreed(
    numeric(stats.opp_sets_w),
    event && event.for === setsWon ? event.against : null,
    legacyFor !== null && legacyFor === setsWon ? legacyAgainst : null,
    setRows !== null && setRows >= setsWon ? setRows - setsWon : null,
  );
  if (setsLost === null || setsLost < 0 || setsLost === setsWon) return null;
  const setsPlayed = setsWon + setsLost;
  if (setRows !== null && setRows !== setsPlayed) return null;
  const winner = Math.max(setsWon, setsLost), loser = Math.min(setsWon, setsLost);
  const matchFormat = winner === 2 && loser <= 1 ? 'BO3' : winner === 3 && loser <= 2 ? 'BO5' : null;
  if (!matchFormat) return null;
  return { setsWon, setsLost, setsPlayed, matchFormat, result: setsWon > setsLost ? 'W' : 'L' };
}

/** Team score from home/away_score and is_home, cross-checked with score_for/score_against. */
function teamScore(row) {
  const event = typeof row?.is_home === 'boolean' ? sideScore(row, row.is_home ? 'home' : 'away') : null;
  const legacyFor = numeric(row?.score_for), legacyAgainst = numeric(row?.score_against);
  const legacy = legacyFor !== null && legacyAgainst !== null ? { for: legacyFor, against: legacyAgainst } : null;
  if (event && legacy && (event.for !== legacy.for || event.against !== legacy.against)) return null;
  return event || legacy;
}

/** Result from every source present (matches_w, the score, a stated code); a conflict is unknown. */
function gameResultOf(row, sport, sets, score) {
  const matchesWon = numeric(statsOf(row).matches_w);
  const fromMatches = sport === 'TENNIS' && (matchesWon === 1 || matchesWon === 0) ? (matchesWon === 1 ? 'W' : 'L') : null;
  const fromScore = sport === 'TENNIS' ? sets?.result || null
    : score ? (score.for === score.against ? 'T' : score.for > score.against ? 'W' : 'L') : null;
  return agreed(fromMatches, fromScore, statedResult(row?.result));
}

/**
 * The same statistic for the other player in a tennis match, read only from
 * the opp_<stat> mirrors PropLine documents. Other stats have no mirror.
 */
const MIRRORED_TENNIS_STATS = new Set(['games_w', 'aces', 'dblfaults', 'breakpts_w', 'tiebreaks']);
function opponentValueOf(row, sport, stat) {
  if (sport !== 'TENNIS' || !MIRRORED_TENNIS_STATS.has(stat)) return null;
  return numeric(statsOf(row)[`opp_${stat}`]);
}

export function normalizeGameArchive(payload, params = {}, now = Date.now()) {
  const sport = text(params.sport).toUpperCase(), sportKey = PROPLINE_GAME_SPORTS[sport], stat = rawStatFor(params);
  if (!stat) return unavailable('UNSUPPORTED_MARKET', 'Verified game history is not mapped for this exact sport and market. Current offers are still available.');
  if (!payload || payload.redacted === true || text(payload.sport_key) !== sportKey || nameKey(payload.player_name) !== nameKey(params.playerName) || !Array.isArray(payload.games)) {
    return unavailable('HISTORY_IDENTITY_UNVERIFIED', 'The returned historical player identity or sport could not be verified for this selection.');
  }
  if (payload.player_id && params.providerPlayerId && text(payload.player_id) !== text(params.providerPlayerId)) return unavailable('HISTORY_IDENTITY_UNVERIFIED', 'The historical player identifier does not match this selection.');
  const rows = new Map(), conflicts = new Set();
  const before = Number.isFinite(Date.parse(params.gameStartTime || '')) ? Math.min(now, Date.parse(params.gameStartTime)) : now;
  let excluded = 0;
  for (const row of payload.games.slice(0, 100)) {
    const eventId = text(row?.event_id), date = Date.parse(row?.commence_time || '');
    const value = numeric(row?.stats?.[stat]);
    const noPlay = row?.played === false || row?.did_not_play === true || row?.dnp === true || row?.retired === true || row?.walkover === true || (['NBA', 'WNBA', 'NCAAB'].includes(sport) && numeric(row?.stats?.minutes) === 0);
    if (!eventId || !Number.isFinite(date) || date >= before || text(row?.status).toLowerCase() !== 'final' || noPlay || row?.redacted === true || value === null || (row?.player_name && nameKey(row.player_name) !== nameKey(params.playerName)) || (params.eventId && eventId === text(params.eventId))) { excluded++; continue; }
    if (conflicts.has(eventId)) continue;
    const prior = rows.get(eventId);
    if (prior && (prior.value !== value || prior.date !== new Date(date).toISOString())) { conflicts.add(eventId); rows.delete(eventId); excluded++; continue; }
    const sets = sport === 'TENNIS' ? tennisSetScore(row, payload.player_name) : null;
    const score = sport === 'TENNIS' ? null : teamScore(row);
    const detail = {
      gameResult: gameResultOf(row, sport, sets, score),
      seasonType: seasonTypeOf(row.season_type),
      // Tennis scores may be sets or games, so only the verified set score is kept.
      ...(sport === 'TENNIS'
        ? {
            ...(sets ? { setsWon: sets.setsWon, setsLost: sets.setsLost, setsPlayed: sets.setsPlayed, matchFormat: sets.matchFormat } : {}),
            matchTotalGames: numeric(row.stats?.total_games),
            gamesWon: numeric(row.stats?.games_w),
            opponentValue: opponentValueOf(row, sport, stat),
          }
        : { scoreFor: score?.for ?? null, scoreAgainst: score?.against ?? null }),
    };
    rows.set(eventId, {
      gameId: eventId, date: new Date(date).toISOString(), value,
      opponent: text(row.opponent) || (sport === 'TENNIS' ? participantOpponent(row, payload.player_name) : null) || null,
      opponentId: text(row.opponent_id) || null,
      isHome: typeof row.is_home === 'boolean' ? row.is_home : null,
      team: text(row.player_team || row.team_abbr) || null,
      season: row.season ?? null, minutes: numeric(row.stats?.minutes),
      ...detail,
    });
  }
  const maxGames = Number(params.historyYears) > 1 ? 100 : 40;
  const gameLog = [...rows.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, Math.min(maxGames, Math.max(5, Number(params.games) || 20)));
  if (!gameLog.length) return unavailable('NO_GAME_LOG_DATA', 'No verified completed-game values were returned for this exact market. Current offers remain available.');
  return {
    ok: true, available: true, source: 'PropLine raw game archive', entityType: 'player', statKind: stat,
    player: { playerName: text(payload.player_name), providerPlayerId: text(payload.player_id) || null, team: text(params.team) || null },
    opponent: text(params.opponent) || (sport === 'TENNIS' ? participantOpponent({ home_team: params.homeTeam, away_team: params.awayTeam }, params.playerName) : null) || null,
    opponentId: text(params.opponentId) || null, isHome: null,
    gameLog, coverage: { source: 'raw-game-archive', complete: false, seasonComplete: false, returnedGames: gameLog.length, receivedGames: payload.games.length, excludedGames: excluded, stat, oldestGame: gameLog.at(-1).date, newestGame: gameLog[0].date },
  };
}

export async function fetchPropLineGameResearch(params = {}, { get = proplineGet, configured = proplineConfigured, now = Date.now } = {}) {
  const sport = text(params.sport).toUpperCase();
  if (!configured() || !PROPLINE_GAME_SPORTS[sport]) return null;
  if (!rawStatFor(params)) return unavailable('UNSUPPORTED_MARKET', 'Verified game history is not mapped for this exact sport and market. Current offers are still available.');
  try {
    // Preserve the existing 40-row normal fetch so board/research cache
    // behavior does not change. Only an explicit deep-history request widens
    // the single bounded archive call to PropLine's 100-row maximum.
    const limit = Number(params.historyYears) > 1 ? 100 : 40;
    const payload = await get(`/v1/sports/${PROPLINE_GAME_SPORTS[sport]}/players/${encodeURIComponent(text(params.playerName))}/games`, { limit }, { ttlSeconds: 900, timeoutMs: 8000 });
    return normalizeGameArchive(payload, params, now());
  } catch {
    return unavailable('HISTORY_TEMPORARILY_UNAVAILABLE', 'Historical game records could not be loaded. Current offers remain available; try the research page again shortly.', true);
  }
}
