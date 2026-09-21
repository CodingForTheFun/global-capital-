import type { PropGroup, ResearchResponse } from './types';

export type OpponentFilterOption = { value: string; label: string };
type LeagueTeam = NonNullable<ResearchResponse['leagueTeams']>[number];

const text = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

function words(value: unknown): string[] {
  const parts = text(value).toLowerCase().match(/[a-z0-9]+/g) || [];
  return parts.map((word, index) => (word === 'st' && index === parts.length - 1 ? 'state' : word));
}

const compact = (value: unknown) => words(value).join('');

function initials(value: unknown) {
  return words(value).map(word => word[0]).join('');
}

function locationInitials(parts: string[]) {
  return parts.map(word => (word === 'st' ? 'st' : word[0])).join('');
}

function cityNicknameMatch(shorter: string[], longer: string[]) {
  if (shorter.length < 2 || longer.length < 3) return false;
  for (let split = 2; split <= Math.min(3, longer.length - 1); split += 1) {
    const city = locationInitials(longer.slice(0, split));
    if (shorter[0] !== city) continue;
    if (shorter.slice(1).join(' ') === longer.slice(split).join(' ')) return true;
  }
  return false;
}

/**
 * Match board, directory, and game-log team labels without a sport-specific
 * table. Besides ordinary abbreviations, this handles city aliases such as
 * "LA Angels" / "Los Angeles Angels", "NY Rangers" / "New York Rangers",
 * and "STL Cardinals" / "St. Louis Cardinals".
 */
export function sameTeamLabel(left: unknown, right: unknown): boolean {
  const a = compact(left);
  const b = compact(right);
  if (!a || !b) return false;
  if (a === b) return true;

  const leftWords = words(left);
  const rightWords = words(right);
  const ai = initials(left);
  const bi = initials(right);

  const abbreviationMatch = (short: string, longWords: string[], longInitials: string) =>
    short.length >= 2 &&
    short.length <= 5 &&
    (
      short === longInitials ||
      short === longWords.slice(0, short.length).map(word => word[0]).join('')
    );

  if (abbreviationMatch(a, rightWords, bi) || abbreviationMatch(b, leftWords, ai)) return true;

  const prefixWords = (shorter: string[], longer: string[]) =>
    shorter.length >= 2 &&
    shorter.length < longer.length &&
    shorter.every((word, index) => word === longer[index]);

  if (prefixWords(leftWords, rightWords) || prefixWords(rightWords, leftWords)) return true;
  if (cityNicknameMatch(leftWords, rightWords) || cityNicknameMatch(rightWords, leftWords)) return true;

  const prefixMatch = (short: string, long: string) =>
    short.length >= 3 && short.length <= 5 && long.length > short.length && long.startsWith(short);

  return prefixMatch(a, b) || prefixMatch(b, a);
}

export function currentOpponentLabels(
  group: Pick<PropGroup, 'team' | 'opponent' | 'homeTeam' | 'awayTeam'>,
): string[] {
  const labels: string[] = [];
  const add = (value: unknown) => {
    const label = text(value);
    if (label && !labels.some(existing => sameTeamLabel(existing, label))) labels.push(label);
  };

  add(group.opponent);

  const team = text(group.team);
  const home = text(group.homeTeam);
  const away = text(group.awayTeam);
  if (team && home && sameTeamLabel(team, home)) add(away);
  if (team && away && sameTeamLabel(team, away)) add(home);

  if (group.opponent && home && sameTeamLabel(group.opponent, home)) add(home);
  if (group.opponent && away && sameTeamLabel(group.opponent, away)) add(away);

  return labels;
}

function directoryRows(leagueTeams: LeagueTeam[]) {
  const rows: Array<{ abbreviation: string; name: string }> = [];
  for (const team of leagueTeams || []) {
    const abbreviation = text(team?.abbreviation);
    const name = text(team?.name);
    if (!abbreviation || !name) continue;
    if (rows.some(row => sameTeamLabel(row.abbreviation, abbreviation) || sameTeamLabel(row.name, name))) continue;
    rows.push({ abbreviation, name });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Team sports use the verified league directory first, so the Opponent picker
 * shows the whole league instead of only clubs already present in one player's
 * returned history. Existing game-log aliases stay as option values so selecting
 * a team continues to filter the verified rows exactly. Sports with individual
 * opponents (for example tennis) keep their observed/current competitor list.
 */
export function buildOpponentOptions(
  opponents: Array<string | null | undefined>,
  group: Pick<PropGroup, 'team' | 'opponent' | 'homeTeam' | 'awayTeam'>,
  leagueTeamsOrIndividual: LeagueTeam[] | boolean = [],
  individual = false,
): OpponentFilterOption[] {
  const leagueTeams = Array.isArray(leagueTeamsOrIndividual) ? leagueTeamsOrIndividual : [];
  const individualMode = typeof leagueTeamsOrIndividual === 'boolean' ? leagueTeamsOrIndividual : individual;
  const observed = [...new Set(opponents.map(text).filter(Boolean))];
  const current = individualMode ? [text(group.opponent)].filter(Boolean) : currentOpponentLabels(group);
  const entries: OpponentFilterOption[] = [];

  const isCurrent = (value: string, label: string) =>
    current.some(candidate =>
      individualMode
        ? text(candidate).toLowerCase() === text(value || label).toLowerCase()
        : sameTeamLabel(candidate, value) || sameTeamLabel(candidate, label),
    );

  const add = (value: string, label: string) => {
    if (!value || !label) return;
    const existing = entries.find(entry =>
      individualMode
        ? text(entry.value).toLowerCase() === text(value).toLowerCase()
        : sameTeamLabel(entry.value, value) || sameTeamLabel(entry.label.replace(/\s+★$/, ''), label),
    );
    if (existing) {
      if (isCurrent(value, label) && !existing.label.endsWith(' ★')) existing.label += ' ★';
      return;
    }
    entries.push({ value, label: isCurrent(value, label) ? `${label} ★` : label });
  };

  if (!individualMode) {
    for (const team of directoryRows(leagueTeams)) {
      const historicalValue = observed.find(
        value => sameTeamLabel(value, team.abbreviation) || sameTeamLabel(value, team.name),
      );
      add(historicalValue || team.abbreviation, team.name);
    }
  }

  for (const value of observed) add(value, value);
  for (const value of current) add(value, value);

  entries.sort((a, b) => {
    const aCurrent = a.label.endsWith(' ★');
    const bCurrent = b.label.endsWith(' ★');
    if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
    return a.label.localeCompare(b.label);
  });

  return [{ value: 'all', label: 'All' }, ...entries];
}
