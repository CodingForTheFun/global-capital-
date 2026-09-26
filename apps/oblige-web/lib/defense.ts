import type { DefensePositionResponse, DefensePositionRow, DefenseTier, PropGroup } from './types';
import { currentOpponentLabels, sameTeamLabel } from './opponent-options';

/**
 * Joins a prop to the server's defense-vs-position table. Every step requires
 * an exact answer -- a supported stat, one exact position, one matching team --
 * and returns null otherwise, so no rank is ever shown for a guessed pairing.
 */

export const DEFENSE_SPORTS = new Set(['NBA', 'WNBA', 'NFL']);

const POSITIONS: Record<string, string[]> = {
  NBA: ['PG', 'SG', 'SF', 'PF', 'C'],
  WNBA: ['PG', 'SG', 'SF', 'PF', 'C'],
  NFL: ['QB', 'RB', 'WR', 'TE'],
};

const key = (value: unknown) => String(value ?? '').toLowerCase().replace(/^(player|batter|pitcher)_/, '').replace(/[^a-z0-9]/g, '');

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

const METRIC_LABELS: Record<string, string> = {
  points: 'points', rebounds: 'rebounds', assists: 'assists', threes: 'threes', steals: 'steals', blocks: 'blocks',
  passingYards: 'passing yards', passingTouchdowns: 'passing TDs', rushingYards: 'rushing yards',
  receivingYards: 'receiving yards', receptions: 'receptions',
};

export function defenseMetricFor(sport: string, ...markets: Array<string | null | undefined>): string | null {
  const table = sport === 'NFL' ? FOOTBALL : sport === 'NBA' || sport === 'WNBA' ? BASKETBALL : null;
  if (!table) return null;
  for (const market of markets) {
    const found = table[key(market)];
    if (found) return found;
  }
  return null;
}

export function metricLabel(metric: string) {
  return METRIC_LABELS[metric] || metric;
}

/** The first candidate that is exactly one of the sport's ranked positions. */
export function exactPosition(sport: string, ...candidates: Array<string | null | undefined>): string | null {
  const allowed = POSITIONS[sport] || [];
  for (const candidate of candidates) {
    const value = String(candidate ?? '').trim().toUpperCase();
    if (allowed.includes(value)) return value;
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
  return defenseReading(response, opponent, exactPosition(sport, group.position), defenseMetricFor(sport, group.marketId, group.market));
}

export function ordinal(value: number) {
  const mod100 = value % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[value % 10] || 'th';
  return value + suffix;
}
