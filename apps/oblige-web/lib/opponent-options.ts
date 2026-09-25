import type { PropGroup, ResearchResponse } from './types';

export type OpponentFilterOption = { value: string; label: string };
type LeagueTeam = NonNullable<ResearchResponse['leagueTeams']>[number];

/** Accent-folded form, for comparing two spellings of the same team. */
const text = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

/**
 * Display form. Folding accents is a matching concern only -- a team is called
 * "San Jos\u00e9 State Spartans", and the picker should say so.
 */
const display = (value: unknown) => String(value ?? '').trim();

const CURRENT_OPPONENT_STAR = '★';

function stripCurrentOpponentMarker(label: string) {
  return label
    .replace(/^★\s+/, '')
    .replace(/\s+★$/, '')
    .trim();
}

function markCurrentOpponent(label: string) {
  const clean = stripCurrentOpponentMarker(label);
  return `${CURRENT_OPPONENT_STAR} ${clean} ${CURRENT_OPPONENT_STAR}`;
}

function isMarkedCurrentOpponent(label: string) {
  return label.startsWith(`${CURRENT_OPPONENT_STAR} `) && label.endsWith(` ${CURRENT_OPPONENT_STAR}`);
}

const CITY_ALIASES: Record<string, string[]> = {
  la: ['los', 'angeles'],
  ny: ['new', 'york'],
  sf: ['san', 'francisco'],
  sd: ['san', 'diego'],
  kc: ['kansas', 'city'],
  tb: ['tampa', 'bay'],
  lv: ['las', 'vegas'],
  no: ['new', 'orleans'],
  gb: ['green', 'bay'],
  okc: ['oklahoma', 'city'],
  stl: ['saint', 'louis'],
};

function words(value: unknown): string[] {
  const parts =
    text(value)
      .toLowerCase()
      .replace(/\buniversity\b/g, '')
      .match(/[a-z0-9]+/g) || [];

  const city = parts[0] ? CITY_ALIASES[parts[0]] : null;
  const expanded = city ? [...city, ...parts.slice(1)] : [...parts];

  // "St. Louis" means Saint; a trailing school "St." means State.
  if (expanded[0] === 'st' && expanded.length > 1) expanded[0] = 'saint';
  for (let index = 1; index < expanded.length; index += 1) {
    if (expanded[index] === 'st') expanded[index] = 'state';
  }
  return expanded;
}

const compact = (value: unknown) => words(value).join('');

function initials(value: unknown) {
  return words(value).map((word) => word[0]).join('');
}

/**
 * Team labels arrive from several verified sources with different display
 * conventions (for example SJSU, San Jose St., San José State Spartans,
 * or LA Angels versus Los Angeles Angels). Matching is intentionally
 * conservative: exact normalized forms, common city aliases,
 * abbreviation/initial forms, or a multi-word school/club prefix.
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
    (short === longInitials || short === longWords.slice(0, short.length).map((word) => word[0]).join(''));

  if (abbreviationMatch(a, rightWords, bi) || abbreviationMatch(b, leftWords, ai)) return true;

  // Several feeds abbreviate by truncating the city rather than by taking
  // initials: JAC for Jacksonville Jaguars, WSH for Washington Commanders,
  // SEA for Seattle Seahawks. Three characters is the floor so two-letter
  // forms (SA, LA) cannot collide with an unrelated city that happens to
  // share their opening letters, and five is the ceiling so a real team
  // name ("Kansas") is never read as an abbreviation of a longer one
  // ("Kansas State").
  const truncationMatch = (short: string, longWords: string[]) =>
    short.length >= 3 &&
    short.length <= 5 &&
    longWords.length > 0 &&
    longWords[0].length > short.length &&
    longWords[0].startsWith(short);

  if (truncationMatch(a, rightWords) || truncationMatch(b, leftWords)) return true;

  const prefixWords = (shorter: string[], longer: string[]) =>
    shorter.length >= 2 &&
    shorter.length < longer.length &&
    shorter.every((word, index) => word === longer[index]);

  return prefixWords(leftWords, rightWords) || prefixWords(rightWords, leftWords);
}

export function currentOpponentLabels(
  group: Pick<PropGroup, 'team' | 'opponent' | 'homeTeam' | 'awayTeam'> & { player?: string | null },
): string[] {
  const labels: string[] = [];
  const add = (value: unknown) => {
    const label = display(value);
    if (label && !labels.some((existing) => sameTeamLabel(existing, label))) labels.push(label);
  };

  add(group.opponent);

  const team = text(group.team);
  const home = text(group.homeTeam);
  const away = text(group.awayTeam);
  if (team && home && sameTeamLabel(team, home)) add(away);
  if (team && away && sameTeamLabel(team, away)) add(home);

  if (group.opponent && home && sameTeamLabel(group.opponent, home)) add(home);
  if (group.opponent && away && sameTeamLabel(group.opponent, away)) add(away);

  // Individual sports (tennis) post the two players as the event's home and
  // away sides and carry no team. The opponent is the other side only when
  // this player is exactly one of them; initials and abbreviations do not
  // count for people.
  const player = compact(group.player);
  if (!team && player && home && away && compact(home) !== compact(away)) {
    if (compact(home) === player) add(away);
    else if (compact(away) === player) add(home);
  }

  return labels;
}

/**
 * The team's full name from the verified league directory ("BOS" -> "Boston
 * Celtics"); the label itself when the directory has no single match.
 */
export function teamDisplayName(label: unknown, leagueTeams: LeagueTeam[] = []): string {
  const value = display(label);
  if (!value) return '';
  const matches = directoryRows(leagueTeams).filter((row) => sameTeamLabel(row.abbreviation, value) || sameTeamLabel(row.name, value));
  return matches.length === 1 ? matches[0].name : value;
}

/**
 * Mark the option that describes tonight's game with the same stars the
 * Opponent picker uses, so every filter shows which choice applies to this
 * prop. Nothing is marked when tonight's value is unknown.
 */
export function markCurrentOption<T extends { value: string; label: string }>(options: T[], current: string | null | undefined): T[] {
  if (!current || current === 'all') return options;
  return options.map((option) => (option.value === current && !isMarkedCurrentOpponent(option.label)
    ? { ...option, label: markCurrentOpponent(option.label) }
    : option));
}

function directoryRows(leagueTeams: LeagueTeam[]) {
  const rows: Array<{ abbreviation: string; name: string }> = [];
  for (const team of leagueTeams || []) {
    const abbreviation = display(team?.abbreviation);
    const name = display(team?.name);
    if (!abbreviation || !name) continue;
    if (rows.some((row) => sameTeamLabel(row.abbreviation, abbreviation) || sameTeamLabel(row.name, name))) continue;
    rows.push({ abbreviation, name });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Build the Opponent picker from the verified league directory first, then
 * retain any verified historical labels that are absent from that directory.
 * Values are chosen to preserve exact existing game-log filtering whenever a
 * historical alias exists. Selecting a league team with no prior game simply
 * produces an empty verified sample; no history is fabricated.
 */
export function buildOpponentOptions(
  opponents: Array<string | null | undefined>,
  group: Pick<PropGroup, 'team' | 'opponent' | 'homeTeam' | 'awayTeam'>,
  leagueTeams: LeagueTeam[] = [],
): OpponentFilterOption[] {
  const observed = [...new Set(opponents.map(display).filter(Boolean))];
  const current = currentOpponentLabels(group);
  const entries: OpponentFilterOption[] = [];

  const isCurrent = (value: string, label: string) =>
    current.some((candidate) => sameTeamLabel(candidate, value) || sameTeamLabel(candidate, label));

  const add = (value: string, label: string) => {
    if (!value || !label) return;
    const existing = entries.find(
      (entry) =>
        sameTeamLabel(entry.value, value) ||
        sameTeamLabel(stripCurrentOpponentMarker(entry.label), label),
    );
    if (existing) {
      if (isCurrent(value, label)) existing.label = markCurrentOpponent(existing.label);
      return;
    }
    entries.push({ value, label: isCurrent(value, label) ? markCurrentOpponent(label) : label });
  };

  for (const team of directoryRows(leagueTeams)) {
    const historicalValue = observed.find(
      (value) => sameTeamLabel(value, team.abbreviation) || sameTeamLabel(value, team.name),
    );
    add(historicalValue || team.abbreviation, team.name);
  }

  for (const value of observed) add(value, value);
  for (const value of current) add(value, value);

  entries.sort((a, b) => {
    const aCurrent = isMarkedCurrentOpponent(a.label);
    const bCurrent = isMarkedCurrentOpponent(b.label);
    if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
    return a.label.localeCompare(b.label);
  });

  return [{ value: 'all', label: 'All opponents' }, ...entries];
}
