'use client';

import * as React from 'react';
import type { PropGroup, PropRow } from '@/lib/types';
import { cn, odds, shortTime } from '@/lib/utils';
import { Badge, Dot } from '@/components/ui/badge';
import { CardHeader, CardPanel, CardTitle } from '@/components/ui/card';

/** Brand colours for the books the board actually carries. Anything else gets
 *  a neutral chip rather than a guessed colour. */
const BOOK_COLOURS: Record<string, string> = {
  draftkings: '#53D337',
  fanduel: '#1476FF',
  betmgm: '#BFA15A',
  caesars: '#0E7A4B',
  espnbet: '#C8102E',
  betrivers: '#1A4FA0',
  pointsbet: '#ED1C24',
  fanatics: '#1B1B1B',
  bet365: '#027B5B',
  hardrock: '#6A2B8A',
  underdog: '#FF5A1F',
  prizepicks: '#8B5CF6',
};

function bookColour(key?: string | null, name?: string | null) {
  const slug = String(key || name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return BOOK_COLOURS[slug] || 'var(--line-strong)';
}

function bookInitials(name: string) {
  const cleaned = String(name || '').replace(/[^A-Za-z0-9 ]/g, '').trim();
  if (!cleaned) return '??';
  const words = cleaned.split(/\s+/);
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  return cleaned.slice(0, 3).toUpperCase();
}

type BookRow = { key: string; name: string; over: PropRow | null; under: PropRow | null };

function collapseByBook(quotes: PropRow[]): BookRow[] {
  const books = new Map<string, BookRow>();
  for (const quote of quotes) {
    const name = String(quote.sportsbook || quote.sportsbookKey || '').trim();
    if (!name) continue;
    const key = (quote.sportsbookKey || name).toLowerCase();
    if (!books.has(key)) books.set(key, { key, name, over: null, under: null });
    const row = books.get(key)!;
    const side = String(quote.side || '').toUpperCase();
    const price = Number(quote.price);
    if (!Number.isFinite(price)) continue;
    // A book can quote the same side more than once across a refresh window;
    // keep the better of the two rather than whichever arrived last.
    if (side === 'OVER' && (!row.over || price > Number(row.over.price))) row.over = quote;
    if (side === 'UNDER' && (!row.under || price > Number(row.under.price))) row.under = quote;
  }
  return [...books.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Every book we carry, side by side, with the best available number on each
 * side flagged — so finding two cents does not mean opening five tabs.
 */
export function BookPrices({ group }: { group: PropGroup }) {
  const rows = React.useMemo(() => collapseByBook(group.quotes), [group.quotes]);
  const bestOver = Math.max(...rows.map((row) => Number(row.over?.price ?? -1e6)));
  const bestUnder = Math.max(...rows.map((row) => Number(row.under?.price ?? -1e6)));
  const updated = shortTime(group.quotes[0]?.providerUpdatedAt || group.quotes[0]?.updatedAt);

  return (
    <CardPanel className="mt-4">
      <CardHeader>
        <CardTitle>Prices across books</CardTitle>
        <Badge variant="live">
          <Dot />
          Best flagged
        </Badge>
      </CardHeader>

      {!rows.length ? (
        <p className="py-8 text-center text-[length:var(--fs-sm)] text-[var(--text-3)]">
          No book is currently posting this market.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 text-[length:var(--fs-micro)] uppercase tracking-[.1em] text-[var(--text-3)]">
            <span>Book</span>
            <span className="min-w-[66px] text-center">Over</span>
            <span className="min-w-[66px] text-center">Under</span>
          </div>
          <div className="mt-2 grid gap-2">
            {rows.map((row) => (
              <div
                key={row.key}
                className={cn(
                  'grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-[var(--radius-sm)] p-3',
                  'border border-[var(--line)] bg-[var(--surface-2)]',
                  'transition-colors duration-200 ease-[var(--ease-out)]',
                  'hover:border-[var(--line-strong)] hover:bg-[var(--surface-3)]',
                )}
              >
                <span className="flex min-w-0 items-center gap-3 text-[length:var(--fs-sm)] font-semibold">
                  <span
                    aria-hidden="true"
                    className="grid size-7 shrink-0 place-items-center rounded-md text-[10px] font-extrabold text-white"
                    style={{ background: bookColour(row.key, row.name) }}
                  >
                    {bookInitials(row.name)}
                  </span>
                  <span className="truncate">{row.name}</span>
                </span>
                <Price quote={row.over} best={Number(row.over?.price) === bestOver} />
                <Price quote={row.under} best={Number(row.under?.price) === bestUnder} />
              </div>
            ))}
          </div>
        </>
      )}

      <p className="mt-4 text-[length:var(--fs-xs)] leading-relaxed text-[var(--text-3)]">
        {updated ? `Last quote ${updated}. ` : ''}
        Movement since open is recorded to the minute in the line history log.
      </p>
    </CardPanel>
  );
}

function Price({ quote, best }: { quote: PropRow | null; best: boolean }) {
  return (
    <span
      data-best={best && quote ? 'true' : undefined}
      className={cn(
        'num min-w-[66px] rounded-[var(--radius-sm)] border px-2.5 py-[7px] text-center text-[length:var(--fs-sm)] font-semibold',
        best && quote
          ? 'border-[var(--pos)] bg-[color-mix(in_srgb,var(--pos)_12%,transparent)] text-[var(--pos)]'
          : 'border-[var(--line)] bg-[var(--surface)] text-[var(--text-2)]',
      )}
    >
      {quote ? odds(quote.price) : '—'}
    </span>
  );
}
