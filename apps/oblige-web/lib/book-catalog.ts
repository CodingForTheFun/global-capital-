import type { PropRow } from './types';
import { BOOKS, bookId, bookInfo } from '../../../lib/constants/books.mjs';

export type CatalogBookRow = {
  key: string;
  name: string;
  type: string;
  badgeColor: string;
  over: PropRow | null;
  under: PropRow | null;
  available: boolean;
};

const DATA_PROVIDER_BOOKS = new Set([
  'espn',
  'sportsdataio',
  'sportsgameodds',
  'propline',
  'clearsports',
  'sportradar',
]);

const sourceBookKey = (value: unknown) =>
  String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

const isDataProviderBook = (quote: Pick<PropRow, 'sportsbook' | 'sportsbookKey'>) =>
  DATA_PROVIDER_BOOKS.has(sourceBookKey(quote.sportsbookKey)) ||
  DATA_PROVIDER_BOOKS.has(sourceBookKey(quote.sportsbook));

/**
 * Build the book list for one exact prop line.
 *
 * Seed from the product-wide supported book registry so every supported book is
 * visible even when it is not currently posting this line. Then merge any
 * provider-observed book that is not in the registry so newly surfaced books do
 * not disappear from the UI while the registry catches up.
 *
 * Registry membership is presentation support only; a seeded row with no
 * quote is explicitly unavailable and must never be treated as a real line.
 */
export function catalogBookRows(quotes: PropRow[]): CatalogBookRow[] {
  const rows = new Map<string, CatalogBookRow>();

  for (const book of BOOKS) {
    rows.set(book.id, {
      key: book.id,
      name: book.name,
      type: book.type,
      badgeColor: book.badgeColor,
      over: null,
      under: null,
      available: false,
    });
  }

  for (const quote of quotes) {
    // Data providers are provenance, not selectable sportsbooks.
    if (isDataProviderBook(quote)) continue;
    const rawName = String(quote.sportsbook || quote.sportsbookKey || '').trim();
    if (!rawName) continue;

    const key = bookId(quote.sportsbookKey || rawName);
    if (!key) continue;

    if (!rows.has(key)) {
      const info = bookInfo(rawName);
      rows.set(key, {
        key,
        name: rawName || info.name,
        type: info.type,
        badgeColor: info.badgeColor,
        over: null,
        under: null,
        available: false,
      });
    }

    const row = rows.get(key)!;
    const price = Number(quote.price);
    if (!Number.isFinite(price) || price === 0) continue;

    const side = String(quote.side || '').toUpperCase();
    if (side === 'OVER' && (!row.over || price > Number(row.over.price))) row.over = quote;
    if (side === 'UNDER' && (!row.under || price > Number(row.under.price))) row.under = quote;
    row.available = Boolean(row.over || row.under);
  }

  return [...rows.values()].sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
