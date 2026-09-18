import type { GameLogRow } from './types';

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
};

export const EMPTY_FILTERS: SampleFilters = { opponent: 'all', season: 'all', venue: 'all' };

export function applyFilters(games: GameLogRow[], filters: SampleFilters) {
  return games.filter((game) => {
    if (filters.venue === 'home' && game.isHome !== true) return false;
    if (filters.venue === 'away' && game.isHome !== false) return false;
    if (filters.opponent !== 'all' && String(game.opponent || '') !== filters.opponent) return false;
    if (filters.season !== 'all' && String(game.season ?? '') !== filters.season) return false;
    return true;
  });
}

export function filtersActive(filters: SampleFilters) {
  return filters.opponent !== 'all' || filters.season !== 'all' || filters.venue !== 'all';
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

export function headToHead(games: GameLogRow[], opponent: string | null, line: number, side: Side) {
  if (!opponent) return null;
  const rows = sortRecentFirst(playable(games)).filter(
    (game) => String(game.opponent || '') === opponent,
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
