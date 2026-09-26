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
  const matches = (teams || []).filter((team) => sameTeamLabel(team?.abbreviation, label) || sameTeamLabel(team?.name, label));
  const ids = [...new Set(matches.map((team) => String(team?.id || '')).filter(Boolean))];
  return ids.length === 1 ? ids[0] : null;
}

export type DefenseReading = {
  teamId: string;
  team: string;
  row: DefensePositionRow;
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
export const MATCHUP_LABEL: Record<DefenseTier, string> = { soft: 'Easy matchup', average: 'Neutral matchup', tough: 'Hard matchup' };

/** The board row's matchup: tonight's opponent against this prop's exact position and stat. */
export function propMatchup(
  response: DefensePositionResponse | null,
  group: Pick<PropGroup, 'sport' | 'market' | 'marketId' | 'position' | 'team' | 'opponent' | 'homeTeam' | 'awayTeam' | 'player'>,
): DefenseReading | null {
  const sport = String(group.sport || '').toUpperCase();
  if (!DEFENSE_SPORTS.has(sport)) return null;
  const opponent = currentOpponentLabels(group)[0] || null;
  const metric = defenseMetricFor(sport, group.marketId, group.market);
  return defenseReading(response, opponent, matchupPosition(sport, metric, group.position), metric);
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
