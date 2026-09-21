import type { PropRow } from './types';

const compact = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Data providers and research feeds are not sportsbooks. They can contribute
 * identity, schedules, stats and enrichment, but must never win a "best price"
 * comparison or render as a selectable book.
 *
 * Real brands that contain one of these words remain valid: e.g. "ESPN BET"
 * compacts to "espnbet", not "espn".
 */
const NON_BOOK_SOURCES = new Set([
  'espn',
  'sportsdataio',
  'sportsgameodds',
  'propline',
  'sportsradar',
  'theoddsapi',
  'oddsapi',
  'publicfeed',
]);

export function isWageringBookQuote(row: Pick<PropRow, 'sportsbook' | 'sportsbookKey'>): boolean {
  const key = compact(row.sportsbookKey || row.sportsbook);
  return Boolean(key) && !NON_BOOK_SOURCES.has(key);
}
