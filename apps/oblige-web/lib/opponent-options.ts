import type { PropGroup } from './types';

export type OpponentFilterOption = { value: string; label: string };

const text = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
const compact = (value: unknown) => text(value).toLowerCase().replace(/[^a-z0-9]/g, '');
const wordParts = (value: unknown) => text(value).toLowerCase().match(/[a-z0-9]+/g) || [];

function teamTokens(value: unknown): Set<string> {
  const words = wordParts(value);
  const tokens = new Set<string>();
  const joined = compact(value);
  if (joined) tokens.add(joined);
  if (words.length > 1) {
    tokens.add(words.map(word => word[0]).join(''));
    tokens.add(words.slice(0, 2).map(word => word[0]).join(''));
  }
  return tokens;
}

/**
 * Match board matchup labels to history labels without a sport-specific table.
 * This covers exact abbreviations, ordinary city/name prefixes (BOS/Boston,
 * CONN/Connecticut), and common multi-word initials (NYR/New York Rangers,
 * LAC/Los Angeles Clippers, KC/Kansas City).
 */
export function sameTeamLabel(left: unknown, right: unknown): boolean {
  const a = compact(left), b = compact(right);
  if (!a || !b) return false;
  if (a === b) return true;

  const aTokens = teamTokens(left), bTokens = teamTokens(right);
  for (const token of aTokens) if (token.length >= 2 && bTokens.has(token)) return true;

  const prefixMatch = (short: string, long: string) =>
    short.length >= 3 && short.length <= 5 && long.length > short.length && long.startsWith(short);
  return prefixMatch(a, b) || prefixMatch(b, a);
}

export function currentOpponentLabels(group: Pick<PropGroup, 'team' | 'opponent' | 'homeTeam' | 'awayTeam'>): string[] {
  const labels: string[] = [];
  const add = (value: unknown) => {
    const label = text(value);
    if (label && !labels.some(existing => sameTeamLabel(existing, label))) labels.push(label);
  };

  add(group.opponent);

  const team = text(group.team), home = text(group.homeTeam), away = text(group.awayTeam);
  if (team && home && sameTeamLabel(team, home)) add(away);
  if (team && away && sameTeamLabel(team, away)) add(home);

  if (group.opponent && home && sameTeamLabel(group.opponent, home)) add(home);
  if (group.opponent && away && sameTeamLabel(group.opponent, away)) add(away);

  return labels;
}

/**
 * Opponent values stay untouched for filtering; only the visible label gains
 * a star. The upcoming opponent is also shown when there is no prior meeting,
 * so every sport with verified matchup identity can identify today's opponent.
 */
export function buildOpponentOptions(
  opponents: Array<string | null | undefined>,
  group: Pick<PropGroup, 'team' | 'opponent' | 'homeTeam' | 'awayTeam'>,
  individual = false,
): OpponentFilterOption[] {
  const values = [...new Set(opponents.map(text).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const current = individual ? [text(group.opponent)].filter(Boolean) : currentOpponentLabels(group);
  const isCurrent = (value: string) => current.some(label => individual ? text(value).toLowerCase() === text(label).toLowerCase() : sameTeamLabel(value, label));

  if (!values.some(isCurrent) && current[0]) {
    values.push(current[0]);
    values.sort((a, b) => a.localeCompare(b));
  }

  return [
    { value: 'all', label: 'All' },
    ...values.map(value => ({ value, label: isCurrent(value) ? `${value} ★` : value })),
  ];
}
