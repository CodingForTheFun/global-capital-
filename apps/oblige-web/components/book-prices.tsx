'use client';

import * as React from 'react';
import type { PropGroup, PropRow } from '@/lib/types';
import { catalogBookRows } from '@/lib/book-catalog';
import { cn, odds, shortTime } from '@/lib/utils';
import { Badge, Dot } from '@/components/ui/badge';
import { CardHeader, CardPanel, CardTitle } from '@/components/ui/card';

function bookInitials(name: string) {
  const cleaned = String(name || '').replace(/[^A-Za-z0-9 ]/g, '').trim();
  if (!cleaned) return '??';
  const words = cleaned.split(/\s+/);
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  return cleaned.slice(0, 3).toUpperCase();
}

/**
 * Show the books that actually carry this exact prop/line. Registry-only books
 * with no applicable quote stay out of the player research card.
 */
export function BookPrices({ group }: { group: PropGroup }) {
  const rows = React.useMemo(() => catalogBookRows(group.quotes).filter((row) => row.available), [group.quotes]);
  const bestOver = Math.max(...rows.map((row) => Number(row.over?.price ?? -1e6)));
  const bestUnder = Math.max(...rows.map((row) => Number(row.under?.price ?? -1e6)));
  const updated = shortTime(group.quotes[0]?.providerUpdatedAt || group.quotes[0]?.updatedAt);
  const availableCount = rows.filter((row) => row.available).length;

  return (
    <CardPanel className="mt-4">
      <CardHeader>
        <CardTitle>Prices across all books</CardTitle>
        <Badge variant="live">
          <Dot />
          {availableCount} posting
        </Badge>
      </CardHeader>

      {!rows.length ? (
        <p className="py-8 text-center text-[length:var(--fs-sm)] text-[var(--text-3)]">
          No books are currently posting this exact prop and line.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 text-[length:var(--fs-micro)] uppercase tracking-[.1em] text-[var(--text-3)]">
            <span>Book</span>
            <span className="min-w-[74px] text-center">Over</span>
            <span className="min-w-[74px] text-center">Under</span>
          </div>
          <div className="mt-2 grid gap-2">
            {rows.map((row) => (
              <div
                key={row.key}
                data-available={row.available ? 'true' : 'false'}
                className={cn(
                  'grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-[var(--radius-sm)] p-3',
                  'border border-[var(--line)] bg-[var(--surface-2)]',
                  'transition-colors duration-200 ease-[var(--ease-out)]',
                  row.available
                    ? 'hover:border-[var(--line-strong)] hover:bg-[var(--surface-3)]'
                    : '',
                )}
              >
                <span className="flex min-w-0 items-center gap-3 text-[length:var(--fs-sm)] font-semibold">
                  <span
                    aria-hidden="true"
                    className="grid size-7 shrink-0 place-items-center rounded-md text-[10px] font-extrabold text-white"
                    style={{ background: row.badgeColor }}
                  >
                    {bookInitials(row.name)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate">{row.name}</span>

                  </span>
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
        Only books currently posting this exact prop and line are shown.
      </p>
    </CardPanel>
  );
}

function Price({ quote, best }: { quote: PropRow | null; best: boolean }) {
  return (
    <span
      data-best={best && quote ? 'true' : undefined}
      className={cn(
        'num min-w-[74px] rounded-[var(--radius-sm)] border px-2.5 py-[7px] text-center text-[length:var(--fs-sm)] font-semibold',
        best && quote
          ? 'border-[var(--pos)] bg-[color-mix(in_srgb,var(--pos)_12%,transparent)] text-[var(--pos)]'
          : 'border-[var(--line)] bg-[var(--surface)] text-[var(--text-2)]',
      )}
    >
      {quote ? odds(quote.price) : 'No line'}
    </span>
  );
}
