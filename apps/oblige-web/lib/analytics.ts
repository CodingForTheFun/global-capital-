import type { GameLogRow } from './types';
import { sameTeamLabel } from './opponent-options';

/**
 * Client-side windows over a game log.
 *
 * The server already returns windows for the line a book is posting. These
 * exist so the reader can move the line with the stepper, or filter the sample
 * by opponent, season or venue, and see the numbers update without another
 * round trip.
 *
 * The policy matches the server's (`RESEARCH_POLICY` in lib/analytics/research.mjs)
 * so a filtered number and an unfiltered one are computed the same way:
 * the denominator is games played, and a push breaks a streak.
 */

export type Window = {
  id: string;
  label: string;
  games: number;
  hits: number;
  misses: number;
  pushes: number;
  /** null when there is no sample, which is not the same as a rate of zero. */
  hitRate: number | null;
  average: number | null;
};

export type Side = 'OVER' | 'UNDER';

const num = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export function beatsLine(value: number, line: number, side: Side) {
  return side === 'UNDER' ? value < line : value > line;
}

export function playable(games: GameLogRow[]): GameLogRow[] {
  return games.filter((game) => num(game.value) !== null);
}

export function computeWindow(
  games: GameLogRow[],
  line: number,
  side: Side,
  id: string,
  label: string,
  take?: number,
): Window {
  const slice = take ? games.slice(0, take) : games;
  const values = slice.map((game) => Number(game.value)).filter(Number.isFinite);
  if (!values.length) {
    return { id, label, games: 0, hits: 0, misses: 0, pushes: 0, hitRate: null, average: null };
  }
  let hits = 0;
  let misses = 0;
  let pushes = 0;
  for (const value of values) {
    if (value === line) pushes += 1;
    else if (beatsLine(value, line, side)) hits += 1;
    else misses += 1;
  }
  return {
    id,
    label,
    games: values.length,
    hits,
    misses,
    pushes,
    // Denominator is games played, so a push counts against the rate rather
    // than vanishing from it — the same choice the server makes.
    hitRate: Math.round((hits / values.length) * 100),
    average: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100,
  };
}

/** Newest first, which is the order every window slices from. */
export function sortRecentFirst(games: GameLogRow[]) {
  return [...games].sort((a, b) => (Date.parse(b.date || '') || 0) - (Date.parse(a.date || '') || 0));
}

export type SampleFilters = {
  opponent: string;
  season: string;
  venue: 'all' | 'home' | 'away';
  /** Team result in that game, as recorded by the stats source. */
  result?: 'all' | 'W' | 'L';
  /** Whether the player was a listed starter. */
  role?: 'all' | 'starter' | 'bench';
  /** ESPN season type: 2 regular season, 3 postseason. */
  seasonType?: 'all' | 'regular' | 'post';
  /** Days since the player's previous logged game. */
  rest?: 'all' | '0' | '1' | '2' | '3+';
  /** Minimum minutes played, e.g. '25'. */
  minutes?: string;
};

export const EMPTY_FILTERS: SampleFilters = {
  opponent: 'all',
  season: 'all',
  venue: 'all',
  result: 'all',
  role: 'all',
  seasonType: 'all',
  rest: 'all',
  minutes: 'all',
};

const DAY_MS = 86_400_000;

/** Strict: `num(null)` is 0 because Number(null) is 0, and a DNP is not a zero. */
function recorded(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Calendar days between two instants, counted on UTC dates so a late tip and
 * an early one the next day read as one day apart, not zero. */
function calendarDays(later: number, earlier: number) {
  const a = Date.UTC(new Date(later).getUTCFullYear(), new Date(later).getUTCMonth(), new Date(later).getUTCDate());
  const b = Date.UTC(new Date(earlier).getUTCFullYear(), new Date(earlier).getUTCMonth(), new Date(earlier).getUTCDate());
  return Math.round((a - b) / DAY_MS);
}

/**
 * Days of rest before each logged game: calendar days since the previous game
 * in the same log, minus one (back-to-back = 0). The oldest game has no
 * earlier game to measure from, so it has no rest value rather than a guess.
 * Keyed by row identity so it survives any later filtering or sorting.
 */
export function restByGame(games: GameLogRow[]): Map<GameLogRow, number> {
  // Only games the player actually logged a value in count as games played.
  const dated = games
    .filter((game) => recorded(game.value) !== null)
    .map((game) => ({ game, time: Date.parse(game.date || '') }))
    .filter((row) => Number.isFinite(row.time))
    .sort((a, b) => a.time - b.time);
  const out = new Map<GameLogRow, number>();
  for (let index = 1; index < dated.length; index += 1) {
    const gap = calendarDays(dated[index].time, dated[index - 1].time);
    if (gap >= 1) out.set(dated[index].game, gap - 1);
  }
  return out;
}

/** Rest before the upcoming game, measured from the latest logged game. */
export function upcomingRest(games: GameLogRow[], startsAt: string | null | undefined): number | null {
  const start = Date.parse(startsAt || '');
  const latest = Math.max(...games.filter((game) => recorded(game.value) !== null).map((game) => Date.parse(game.date || '')).filter(Number.isFinite));
  if (!Number.isFinite(start) || !Number.isFinite(latest) || start <= latest) return null;
  const gap = calendarDays(start, latest);
  return gap >= 1 ? gap - 1 : null;
}

function restBucket(days: number) {
  return days >= 3 ? '3+' : String(days);
}

/** Which advanced filters this log can actually answer. A filter with no
 * source field is hidden rather than offered and silently emptying the sample. */
export function filterCoverage(games: GameLogRow[]) {
  const has = (pick: (game: GameLogRow) => boolean) => games.some(pick);
  return {
    result: has((game) => game.gameResult === 'W') && has((game) => game.gameResult === 'L'),
    role: has((game) => game.started === true) && has((game) => game.started === false),
    seasonType: has((game) => game.seasonType === 2) && has((game) => game.seasonType === 3),
    rest: restByGame(games).size >= 2,
    minutes: games.filter((game) => (recorded(game.minutes) ?? 0) > 0).length >= 2,
  };
}

export function applyFilters(games: GameLogRow[], filters: SampleFilters) {
  const rest = filters.rest && filters.rest !== 'all' ? restByGame(games) : null;
  const minMinutes = filters.minutes && filters.minutes !== 'all' ? recorded(filters.minutes) : null;
  return games.filter((game) => {
    if (filters.venue === 'home' && game.isHome !== true) return false;
    if (filters.venue === 'away' && game.isHome !== false) return false;
    // Matched on team identity, not on the exact string: the picker offers the
    // league directory's names while a game log may hold abbreviations, and an
    // exact comparison silently emptied the sample for every such pair.
    if (filters.opponent !== 'all' && !sameTeamLabel(game.opponent, filters.opponent)) return false;
    if (filters.season !== 'all' && String(game.season ?? '') !== filters.season) return false;
    // Every advanced filter fails closed: a game missing the field is not
    // assumed to match.
    if (filters.result && filters.result !== 'all' && game.gameResult !== filters.result) return false;
    if (filters.role === 'starter' && game.started !== true) return false;
    if (filters.role === 'bench' && game.started !== false) return false;
    if (filters.seasonType === 'regular' && game.seasonType !== 2) return false;
    if (filters.seasonType === 'post' && game.seasonType !== 3) return false;
    if (rest) {
      const days = rest.get(game);
      if (days === undefined || restBucket(days) !== filters.rest) return false;
    }
    if (minMinutes !== null && !((recorded(game.minutes) ?? -1) >= minMinutes)) return false;
    return true;
  });
}

export function advancedFilterCount(filters: SampleFilters) {
  return (['result', 'role', 'seasonType', 'rest', 'minutes'] as const)
    .filter((key) => filters[key] && filters[key] !== 'all').length;
}

export function filtersActive(filters: SampleFilters) {
  return filters.opponent !== 'all' || filters.season !== 'all' || filters.venue !== 'all' || advancedFilterCount(filters) > 0;
}

export const SAMPLE_WINDOWS = [
  { id: 'l5', label: 'L5', take: 5 },
  { id: 'l10', label: 'L10', take: 10 },
  { id: 'l15', label: 'L15', take: 15 },
  { id: 'season', label: 'All', take: undefined },
] as const;

export type SampleId = (typeof SAMPLE_WINDOWS)[number]['id'] | 'h2h';

export function buildWindows(games: GameLogRow[], line: number, side: Side) {
  const sorted = sortRecentFirst(playable(games));
  return SAMPLE_WINDOWS.map((w) => computeWindow(sorted, line, side, w.id, w.label, w.take));
}

/**
 * The current matchup and the game log do not always name a team the same way:
 * the matchup can say "Jacksonville Jaguars" while the log says "JAC". Exact
 * string equality dropped every such game and reported H2H as empty, so match
 * on team identity instead. This only decides which already-verified rows the
 * window covers; no row is created or altered.
 */
export function headToHead(games: GameLogRow[], opponent: string | null, line: number, side: Side) {
  if (!opponent) return null;
  const rows = sortRecentFirst(playable(games)).filter((game) =>
    sameTeamLabel(game.opponent, opponent),
  );
  return computeWindow(rows, line, side, 'h2h', 'H2H', undefined);
}

/** How many in a row, most recent first, before the result flips. */
export function streakOf(games: GameLogRow[], line: number, side: Side) {
  const rows = sortRecentFirst(playable(games));
  if (!rows.length) return null;
  let count = 0;
  let over: boolean | null = null;
  for (const game of rows) {
    const value = Number(game.value);
    if (value === line) break; // a push breaks the run rather than extending it
    const beat = beatsLine(value, line, side);
    if (over === null) {
      over = beat;
      count = 1;
      continue;
    }
    if (beat !== over) break;
    count += 1;
  }
  return over === null ? null : { count, over };
}

export function sampleFor(
  games: GameLogRow[],
  sample: SampleId,
  opponent: string | null,
): GameLogRow[] {
  const sorted = sortRecentFirst(playable(games));
  if (sample === 'h2h') {
    return opponent ? sorted.filter((game) => String(game.opponent || '') === opponent) : [];
  }
  const found = SAMPLE_WINDOWS.find((w) => w.id === sample);
  return found?.take ? sorted.slice(0, found.take) : sorted;
}

export function distinct<T>(values: (T | null | undefined)[]): T[] {
  return [...new Set(values.filter((value): value is T => value !== null && value !== undefined && value !== ('' as unknown as T)))];
}
