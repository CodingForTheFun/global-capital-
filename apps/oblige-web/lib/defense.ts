import type { DefensePositionResponse, DefensePositionRow, DefenseTier, PropGroup } from './types';
import { currentOpponentLabels, sameTeamLabel } from './opponent-options';

/**
 * Joins a prop to the server's defense-vs-position table. Every step requires
 * an exact answer -- a supported stat, one exact position, one matching team --
 * and returns null otherwise, so no rank is ever shown for a guessed pairing.
 */

export const DEFENSE_SPORTS = new Set(['NBA', 'WNBA', 'NCAAB', 'NFL', 'NCAAF', 'NHL', 'MLB', 'MLS', 'EPL', 'UCL']);

const key = (value: unknown) => String(value ?? '').toLowerCase().replace(/^(player|batter|pitcher)_/, '').replace(/[^a-z0-9]/g, '');
const rawKey = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const BASKETBALL: Record<string, string> = {
  points: 'points', rebounds: 'rebounds', assists: 'assists', steals: 'steals',
  blocks: 'blocks', blockedshots: 'blocks',
  threes: 'threes', threepointersmade: 'threes', '3pointersmade': 'threes', threepointers: 'threes',
};
const FOOTBALL: Record<string, string> = {
  passyds: 'passingYards', passingyards: 'passingYards', passyards: 'passingYards',
  passtds: 'passingTouchdowns', passingtouchdowns: 'passingTouchdowns', passingtds: 'passingTouchdowns',
  rushyds: 'rushingYards', rushingyards: 'rushingYards', rushyards: 'rushingYards',
  receptionyds: 'receivingYards', receivingyards: 'receivingYards', receptionyards: 'receivingYards', recyds: 'receivingYards',
  receptions: 'receptions',
};
const HOCKEY: Record<string, string> = {
  shotsongoal: 'shotsOnGoal', goals: 'goals', assists: 'assists', points: 'points',
  blockedshots: 'blockedShots', saves: 'saves', totalsaves: 'saves', goaliesaves: 'saves',
};
// Baseball keeps its batter_/pitcher_ prefix: a batter's strikeouts and a
// pitcher's strikeouts are different stats against different opponents.
const BASEBALL: Record<string, string> = {
  batter_hits: 'hits', batter_runs: 'runs', batter_rbis: 'rbis', batter_home_runs: 'homeRuns', batter_walks: 'walks', batter_strikeouts: 'strikeouts',
  pitcher_strikeouts: 'pitcherStrikeouts', pitcher_hits_allowed: 'hitsAllowed', pitcher_earned_runs: 'earnedRuns', pitcher_walks: 'walksAllowed', pitcher_outs: 'outs',
};
const SOCCER: Record<string, string> = { shots: 'shots', shotsontarget: 'shotsOnTarget' };
const PITCHING = new Set(['pitcherStrikeouts', 'hitsAllowed', 'earnedRuns', 'walksAllowed', 'outs']);

const TABLES: Record<string, Record<string, string>> = {
  NBA: BASKETBALL, WNBA: BASKETBALL, NCAAB: BASKETBALL, NFL: FOOTBALL, NCAAF: FOOTBALL,
  NHL: HOCKEY, MLB: BASEBALL, MLS: SOCCER, EPL: SOCCER, UCL: SOCCER,
};

const METRIC_LABELS: Record<string, string> = {
  points: 'points', rebounds: 'rebounds', assists: 'assists', threes: 'threes', steals: 'steals', blocks: 'blocks',
  passingYards: 'passing yards', passingTouchdowns: 'passing TDs', rushingYards: 'rushing yards',
  receivingYards: 'receiving yards', receptions: 'receptions',
  shotsOnGoal: 'shots on goal', goals: 'goals', blockedShots: 'blocked shots', saves: 'saves',
  hits: 'hits', runs: 'runs', rbis: 'RBIs', homeRuns: 'home runs', walks: 'walks', strikeouts: 'strikeouts',
  pitcherStrikeouts: 'strikeouts', hitsAllowed: 'hits', earnedRuns: 'earned runs', walksAllowed: 'walks', outs: 'outs',
  shots: 'shots', shotsOnTarget: 'shots on target',
};

const POSITION_LABELS: Record<string, string> = {
  QB: 'QBs', RB: 'RBs', WR: 'WRs', TE: 'TEs', G: 'guards', F: 'forwards', C: 'centers',
  D: 'defensemen', BAT: 'batters', PIT: 'pitchers', ALL: 'opponents',
};

export function defenseMetricFor(sport: string, ...markets: Array<string | null | undefined>): string | null {
  const table = TABLES[sport];
  if (!table) return null;
  for (const market of markets) {
    const found = sport === 'MLB' ? table[rawKey(market)] : table[key(market)];
    if (found) return found;
  }
  return null;
}

export function metricLabel(metric: string) {
  return METRIC_LABELS[metric] || metric;
}

/** "QBs", "guards", "batters": the group a rank is measured against. */
export function positionLabel(position: string | null | undefined) {
  return POSITION_LABELS[String(position || '')] || String(position || '');
}

/** A listed role reduced to the ranked role for the sport, or null. */
function roleFor(sport: string, value: unknown): string | null {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return null;
  if (sport === 'NBA' || sport === 'WNBA' || sport === 'NCAAB') {
    const first = raw.replace(/[^A-Z]/g, ' ').trim().split(/\s+/)[0];
    if (['PG', 'SG', 'G'].includes(first)) return 'G';
    if (['SF', 'PF', 'F'].includes(first)) return 'F';
    return first === 'C' ? 'C' : null;
  }
  if (sport === 'NFL' || sport === 'NCAAF') return raw === 'FB' ? 'RB' : (['QB', 'RB', 'WR', 'TE'].includes(raw) ? raw : null);
  if (sport === 'NHL') return ['C', 'LW', 'RW', 'F'].includes(raw) ? 'F' : raw === 'D' ? 'D' : raw === 'G' ? 'G' : null;
  return null;
}

/**
 * The role a prop's matchup is measured against. Baseball and soccer are
 * decided by the stat (a pitcher's strikeouts face a lineup; a shot faces the
 * club); the rest need the player's own listed role, and give up without one.
 */
export function matchupPosition(sport: string, metric: string | null, ...candidates: Array<string | null | undefined>): string | null {
  if (!metric) return null;
  if (sport === 'MLB') return PITCHING.has(metric) ? 'PIT' : 'BAT';
  if (sport === 'MLS' || sport === 'EPL' || sport === 'UCL') return 'ALL';
  if (sport === 'NHL' && metric === 'saves') return 'G';
  for (const candidate of candidates) {
    const role = roleFor(sport, candidate);
    if (role && !(sport === 'NHL' && role === 'G')) return role;
  }
  return null;
}

/** Kept for callers that only have a listed role. */
export function exactPosition(sport: string, ...candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    const role = roleFor(sport, candidate);
    if (role) return role;
  }
  return null;
}

export function teamIdFor(label: unknown, teams: DefensePositionResponse['teams'] = []): string | null {
  // An exact abbreviation or full name is one team: "COL" is Colorado even
  // though it also reads as a shortening of Columbus. Only without an exact
  // match does the looser comparison run, and it must find exactly one team.
  const wanted = String(label ?? '').trim().toUpperCase();
  const exact = wanted ? (teams || []).filter((team) => String(team?.abbreviation || '').trim().toUpperCase() === wanted || String(team?.name || '').trim().toUpperCase() === wanted) : [];
  const exactIds = [...new Set(exact.map((team) => String(team?.id || '')).filter(Boolean))];
  if (exactIds.length === 1) return exactIds[0];
  if (exactIds.length > 1) return null;
  const matches = (teams || []).filter((team) => sameTeamLabel(team?.abbreviation, label) || sameTeamLabel(team?.name, label));
  const ids = [...new Set(matches.map((team) => String(team?.id || '')).filter(Boolean))];
  return ids.length === 1 ? ids[0] : null;
}

export type DefenseReading = {
  teamId: string;
  team: string;
  row: DefensePositionRow;
  /** For a combined ranking, the stats it adds up (shown in place of one stat). */
  label?: string;
  /** 1 = allows the most, so "4th-most" reads naturally for a prop. */
  allowedRank: number;
  leagueSize: number;
  tier: DefenseTier;
};

export function tierFor(allowedRank: number, leagueSize: number): DefenseTier {
  if (allowedRank <= Math.ceil(leagueSize / 3)) return 'soft';
  if (allowedRank > leagueSize - Math.ceil(leagueSize / 3)) return 'tough';
  return 'average';
}

export function defenseReading(
  response: DefensePositionResponse | null,
  opponent: unknown,
  position: string | null,
  metric: string | null,
): DefenseReading | null {
  if (!response?.available || !position || !metric) return null;
  const teamId = teamIdFor(opponent, response.teams);
  if (!teamId) return null;
  const rows = (response.rows || []).filter((row) => row.teamId === teamId && row.position === position && row.metric === metric);
  const row = rows.length === 1 ? rows[0] : null;
  const leagueSize = Number(row?.leagueSize);
  const rank = Number(row?.rank);
  if (!row || !Number.isInteger(rank) || rank < 1 || !Number.isInteger(leagueSize) || rank > leagueSize) return null;
  const allowedRank = leagueSize + 1 - rank;
  const team = (response.teams || []).find((entry) => String(entry?.id) === teamId);
  return { teamId, team: String(team?.abbreviation || team?.name || ''), row, allowedRank, leagueSize, tier: tierFor(allowedRank, leagueSize) };
}

export type OffenseReading = {
  teamId: string;
  team: string;
  row: DefensePositionRow;
  /** 1 = produces the most at this position. */
  producedRank: number;
  leagueSize: number;
};

/** What the player's own team's players at this position produce, ranked. */
export function offenseReading(
  response: DefensePositionResponse | null,
  team: unknown,
  position: string | null,
  metric: string | null,
): OffenseReading | null {
  if (!response?.available || !position || !metric) return null;
  const teamId = teamIdFor(team, response.teams);
  if (!teamId) return null;
  const rows = (response.offenseRows || []).filter((row) => row.teamId === teamId && row.position === position && row.metric === metric);
  const row = rows.length === 1 ? rows[0] : null;
  const leagueSize = Number(row?.leagueSize);
  const rank = Number(row?.rank);
  if (!row || !Number.isInteger(rank) || rank < 1 || !Number.isInteger(leagueSize) || rank > leagueSize) return null;
  const entry = (response.teams || []).find((candidate) => String(candidate?.id) === teamId);
  return { teamId, team: String(entry?.abbreviation || entry?.name || ''), row, producedRank: leagueSize + 1 - rank, leagueSize };
}

/** How the opponent's defense reads for this prop: a soft defense is an easy matchup. */
export const MATCHUP_LABEL: Record<DefenseTier, string> = { soft: 'Easy matchup', average: 'Medium matchup', tough: 'Hard matchup' };

type Composite = { parts: Record<string, number>; label: string };
const combo = (parts: Record<string, number>, label: string): Composite => ({ parts, label });

// Markets built from several ranked stats. The opponent is ranked on the
// weighted sum of what it allows in each; fantasy weights follow the common
// pick'em scoring for the stats that are ranked, and the label says which.
const BASKETBALL_COMBOS: Record<string, Composite> = {};
for (const [keys, value] of [
  [['pointsreboundsassists', 'ptsrebsasts', 'ptsrebast', 'pra'], combo({ points: 1, rebounds: 1, assists: 1 }, 'points, rebounds and assists')],
  [['pointsrebounds', 'ptsrebs', 'ptsreb'], combo({ points: 1, rebounds: 1 }, 'points and rebounds')],
  [['pointsassists', 'ptsasts', 'ptsast'], combo({ points: 1, assists: 1 }, 'points and assists')],
  [['reboundsassists', 'rebsasts', 'rebast'], combo({ rebounds: 1, assists: 1 }, 'rebounds and assists')],
  [['stealsblocks', 'blkstl', 'blksstls', 'blocksteals'], combo({ steals: 1, blocks: 1 }, 'steals and blocks')],
  [['fantasyscore', 'fantasypoints', 'fantasy'], combo({ points: 1, rebounds: 1.2, assists: 1.5, steals: 3, blocks: 3 }, 'fantasy stats (points, rebounds, assists, steals, blocks)')],
] as Array<[string[], Composite]>) for (const k of keys) BASKETBALL_COMBOS[k] = value;

const FOOTBALL_COMBOS: Record<string, Composite> = {};
for (const [keys, value] of [
  [['rushreceptionyds', 'rushrecyds', 'rushingreceivingyards', 'rushreceivingyards', 'rushandrecyds'], combo({ rushingYards: 1, receivingYards: 1 }, 'rushing and receiving yards')],
  [['passrushyds', 'passingrushingyards', 'passandrushyds'], combo({ passingYards: 1, rushingYards: 1 }, 'passing and rushing yards')],
  [['fantasyscore', 'fantasypoints', 'fantasy'], combo({ passingYards: 0.04, passingTouchdowns: 4, rushingYards: 0.1, receivingYards: 0.1, receptions: 1 }, 'fantasy stats (yards, passing TDs, receptions)')],
] as Array<[string[], Composite]>) for (const k of keys) FOOTBALL_COMBOS[k] = value;

const HOCKEY_COMBOS: Record<string, Composite> = {};
for (const k of ['fantasyscore', 'fantasypoints', 'fantasy']) HOCKEY_COMBOS[k] = combo({ goals: 8, assists: 5, shotsOnGoal: 1.5, blockedShots: 1.5 }, 'fantasy stats (goals, assists, shots, blocks)');

// Baseball keeps the batter/pitcher distinction (see BASEBALL above).
const BASEBALL_COMBOS: Record<string, Composite> = {};
for (const [keys, value] of [
  [['batter_hits_runs_rbis', 'hits_runs_rbis', 'hits_runs_rbi', 'h_r_rbi'], combo({ hits: 1, runs: 1, rbis: 1 }, 'hits, runs and RBIs')],
  [['batter_total_bases', 'total_bases'], combo({ hits: 1, homeRuns: 3 }, 'hits and home runs (total bases)')],
  [['batter_fantasy_score', 'hitter_fantasy_score', 'batter_fantasy_points', 'hitter_fantasy_points'], combo({ hits: 3, runs: 2, rbis: 2, walks: 2, homeRuns: 7 }, 'hitter fantasy stats (hits, runs, RBIs, walks, home runs)')],
  [['pitcher_fantasy_score', 'pitcher_fantasy_points'], combo({ pitcherStrikeouts: 3, outs: 1, earnedRuns: -3 }, 'pitcher fantasy stats (strikeouts, outs, earned runs)')],
] as Array<[string[], Composite]>) for (const k of keys) BASEBALL_COMBOS[k] = value;

// Soccer ranks clubs only on shots; other attacking props read against those.
const SOCCER_COMBOS: Record<string, Composite> = {};
for (const k of ['goals', 'anytimegoalscorer', 'goalsassists', 'goalassist', 'assists']) SOCCER_COMBOS[k] = combo({ shotsOnTarget: 1 }, 'shots on target');

const COMPOSITES: Record<string, Record<string, Composite>> = {
  NBA: BASKETBALL_COMBOS, WNBA: BASKETBALL_COMBOS, NCAAB: BASKETBALL_COMBOS, NFL: FOOTBALL_COMBOS, NCAAF: FOOTBALL_COMBOS,
  NHL: HOCKEY_COMBOS, MLB: BASEBALL_COMBOS, MLS: SOCCER_COMBOS, EPL: SOCCER_COMBOS, UCL: SOCCER_COMBOS,
};

export function compositeFor(sport: string, ...markets: Array<string | null | undefined>): Composite | null {
  const table = COMPOSITES[sport];
  if (!table) return null;
  for (const market of markets) {
    const found = sport === 'MLB' ? table[rawKey(market)] : table[key(market)];
    if (found) return found;
  }
  return null;
}

const MIN_RANKED_TEAMS = 8;

/**
 * Ranks every team with a complete set of allowances on `value(teamId)` and
 * reads the opponent's place: rank 1 allows the most, an easy matchup.
 */
function rankedReading(
  response: DefensePositionResponse,
  opponent: unknown,
  position: string,
  metric: string,
  label: string | undefined,
  value: (teamId: string) => { total: number; partial: boolean } | null,
): DefenseReading | null {
  const teamId = teamIdFor(opponent, response.teams);
  if (!teamId) return null;
  const scored = (response.teams || [])
    .map((team) => ({ id: String(team?.id || ''), result: value(String(team?.id || '')) }))
    .filter((entry): entry is { id: string; result: { total: number; partial: boolean } } => Boolean(entry.id && entry.result));
  const mine = scored.find((entry) => entry.id === teamId);
  if (!mine || scored.length < MIN_RANKED_TEAMS) return null;
  const allowedRank = 1 + scored.filter((entry) => entry.result.total > mine.result.total).length;
  const leagueSize = scored.length;
  const team = (response.teams || []).find((entry) => String(entry?.id) === teamId);
  return {
    teamId,
    team: String(team?.abbreviation || team?.name || ''),
    row: { teamId, position, metric, average: mine.result.total, partial: scored.some((entry) => entry.result.partial) || leagueSize < (response.teams || []).length },
    label,
    allowedRank,
    leagueSize,
    tier: tierFor(allowedRank, leagueSize),
  };
}

/** One team's average allowed for a stat at a position, or for all positions summed ('ALL'). */
function allowed(response: DefensePositionResponse, teamId: string, position: string, metric: string): { total: number; partial: boolean } | null {
  const rows = response.rows || [];
  const usable = (row: DefensePositionRow) => typeof row.average === 'number' && Number.isFinite(row.average) && Number(row.games) >= 3;
  if (position !== 'ALL') {
    const found = rows.filter((row) => row.teamId === teamId && row.position === position && row.metric === metric);
    return found.length === 1 && usable(found[0]) ? { total: found[0].average as number, partial: Boolean(found[0].partial) } : null;
  }
  // A team-level stat (soccer) is stored under 'ALL' already.
  const direct = rows.filter((row) => row.teamId === teamId && row.position === 'ALL' && row.metric === metric);
  if (direct.length) return direct.length === 1 && usable(direct[0]) ? { total: direct[0].average as number, partial: Boolean(direct[0].partial) } : null;
  // Otherwise every position the stat is ranked at must be present for this team.
  const positions = [...new Set(rows.filter((row) => row.metric === metric && row.position !== 'ALL').map((row) => String(row.position)))];
  if (!positions.length) return null;
  let total = 0, partial = false;
  for (const pos of positions) {
    const found = rows.filter((row) => row.teamId === teamId && row.position === pos && row.metric === metric);
    if (found.length !== 1 || !usable(found[0])) return null;
    total += found[0].average as number;
    partial ||= Boolean(found[0].partial);
  }
  return { total, partial };
}

function compositeReading(response: DefensePositionResponse | null, opponent: unknown, position: string | null, spec: Composite): DefenseReading | null {
  if (!response?.available || !position) return null;
  return rankedReading(response, opponent, position, 'composite', spec.label, (teamId) => {
    let total = 0, partial = false;
    for (const [metric, weight] of Object.entries(spec.parts)) {
      const part = allowed(response, teamId, position, metric);
      if (!part) return null;
      total += weight * part.total;
      partial ||= part.partial;
    }
    return { total, partial };
  });
}

/** Sports whose ranks are split by the player's role; without one, all roles are summed. */
const ROLE_SPORTS = new Set(['NBA', 'WNBA', 'NCAAB', 'NFL', 'NCAAF', 'NHL']);

/** The stats a reading is ranked on, for its tooltip. */
export function readingStat(reading: Pick<DefenseReading, 'label' | 'row'>) {
  return reading.label || metricLabel(reading.row.metric || '');
}

/** "to guards", or "to all positions" when the prop listed none. */
export function readingAudience(reading: Pick<DefenseReading, 'row'>, sport?: string) {
  if (reading.row.position !== 'ALL') return ' to ' + positionLabel(reading.row.position);
  return sport && ROLE_SPORTS.has(sport.toUpperCase()) ? ' to all positions' : '';
}

/** The board row's matchup: tonight's opponent against this prop's exact position and stat. */
export function propMatchup(
  response: DefensePositionResponse | null,
  group: Pick<PropGroup, 'sport' | 'market' | 'marketId' | 'position' | 'team' | 'opponent' | 'homeTeam' | 'awayTeam' | 'player'>,
): DefenseReading | null {
  const sport = String(group.sport || '').toUpperCase();
  if (!DEFENSE_SPORTS.has(sport)) return null;
  const opponent = currentOpponentLabels(group)[0] || null;
  const metric = defenseMetricFor(sport, group.marketId, group.market);
  const spec = metric ? null : compositeFor(sport, group.marketId, group.market);
  // The role a combined market is ranked at follows its first component.
  const lead = metric || (spec ? Object.keys(spec.parts)[0] : null);
  const exactRole = matchupPosition(sport, lead, group.position);
  // No listed role in a role-split sport: rank against all positions combined.
  const position = exactRole || (lead && ROLE_SPORTS.has(sport) ? 'ALL' : null);
  if (!position) return null;
  if (metric) {
    const exact = defenseReading(response, opponent, position, metric);
    if (exact || position !== 'ALL') return exact;
    if (!response?.available) return null;
    return rankedReading(response, opponent, 'ALL', metric, undefined, (teamId) => allowed(response, teamId, 'ALL', metric));
  }
  return spec ? compositeReading(response, opponent, position, spec) : null;
}

export function ordinal(value: number) {
  const mod100 = value % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[value % 10] || 'th';
  return value + suffix;
}

/** "8th of 32", or "8th of 32 ranked" for a league ranked among teams with enough games. */
export function rankOf(reading: Pick<DefenseReading, 'allowedRank' | 'leagueSize' | 'row'>) {
  return ordinal(reading.allowedRank) + ' of ' + reading.leagueSize + (reading.row?.partial ? ' ranked' : '');
}
