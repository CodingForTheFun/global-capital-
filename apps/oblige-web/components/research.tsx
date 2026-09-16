'use client';

import * as React from 'react';
import { Minus } from 'lucide-react';
import type { GameLogRow, ResearchResponse, Side } from '@/lib/types';
import { splitOf, streakOf, windowOf } from '@/lib/api';
import { cn, pctValue, shortDate, signed } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardPanel } from '@/components/ui/card';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';

type Stat = { key: string; value: string; sub: string; tone?: 'pos' | 'neg' };

export function StatStrip({
  research,
  line,
  loading,
}: {
  research: ResearchResponse | null;
  line: number;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="mt-4 grid grid-cols-4 gap-2 md:grid-cols-7">
        {Array.from({ length: 7 }).map((_, index) => (
          <Skeleton key={index} className="h-20 rounded-[var(--radius)]" />
        ))}
      </div>
    );
  }

  const last5 = windowOf(research, 'last5', 'l5', 'lastFive');
  const last10 = windowOf(research, 'last10', 'l10', 'lastTen');
  const last15 = windowOf(research, 'last15', 'l15');
  const season = windowOf(research, 'season');
  const h2h = research?.h2h ?? null;
  const streak = streakOf(research);
  const average = last15?.average ?? season?.average ?? last10?.average ?? null;
  const diff = research?.diff ?? (average === null ? null : average - line);

  const rateStat = (key: string, w: typeof last5, fallbackSub: string): Stat => {
    const rate = pctValue(w?.hitRate ?? null);
    const hits = w?.hits ?? null;
    const sample = w?.sampleSize ?? w?.games ?? null;
    return {
      key,
      value: rate === null ? '—' : `${rate}%`,
      sub: hits !== null && sample !== null ? `${hits}/${sample}` : fallbackSub,
      tone: rate === null ? undefined : rate >= 60 ? 'pos' : rate < 45 ? 'neg' : undefined,
    };
  };

  const h2hAverage = Number(h2h?.average);
  const h2hRate = pctValue(h2h?.hitRate ?? null);
  const h2hValue = Number.isFinite(h2hAverage) ? h2hAverage.toFixed(1) : h2hRate === null ? '—' : `${h2hRate}%`;

  const stats: Stat[] = [
    rateStat('L5', last5, 'no sample'),
    rateStat('L10', last10, 'no sample'),
    rateStat('L15', last15, last15 ? 'last 15' : 'no sample'),
    {
      key: 'H2H',
      value: h2hValue,
      sub: 'vs opponent',
      tone: h2hRate === null ? undefined : h2hRate >= 60 ? 'pos' : h2hRate < 45 ? 'neg' : undefined,
    },
    {
      key: 'STRK',
      value: streak ? `${streak.count} ${streak.over ? 'O' : 'U'}` : '—',
      sub: streak ? 'current' : 'no streak',
      tone: streak ? (streak.over ? 'pos' : 'neg') : undefined,
    },
    {
      key: 'AVG',
      value: average === null ? '—' : Number(average).toFixed(1),
      sub: last15 ? 'last 15' : season ? 'season' : 'sample',
    },
    {
      key: 'DIFF',
      value: diff === null ? '—' : signed(diff),
      sub: 'avg vs line',
      tone: diff === null ? undefined : diff > 0 ? 'pos' : diff < 0 ? 'neg' : undefined,
    },
  ];

  return (
    <div className="mt-4 grid grid-cols-4 gap-2 md:grid-cols-7">
      {stats.map((stat) => (
        <Card key={stat.key} className="grid min-h-20 justify-items-center gap-1 p-3 text-center">
          <span className="text-[length:var(--fs-micro)] uppercase tracking-[.14em] text-[var(--text-3)]">
            {stat.key}
          </span>
          <span
            className={cn(
              'num text-[length:var(--fs-lg)] font-bold tracking-tight',
              stat.tone === 'pos' && 'text-[var(--pos)]',
              stat.tone === 'neg' && 'text-[var(--neg)]',
            )}
          >
            {stat.value}
          </span>
          <span className="text-[length:var(--fs-micro)] text-[var(--text-3)]">{stat.sub}</span>
        </Card>
      ))}
    </div>
  );
}

export function PropChart({
  games,
  line,
  side,
  market,
  loading,
}: {
  games: GameLogRow[];
  line: number;
  side: Side;
  market: string;
  loading?: boolean;
}) {
  const [grown, setGrown] = React.useState(false);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setGrown(true), 80);
    return () => window.clearTimeout(timer);
  }, [games]);

  void side;

  if (loading) {
    return (
      <CardPanel className="mt-4">
        <CardHeader>
          <CardTitle>Recent games</CardTitle>
        </CardHeader>
        <Skeleton className="h-[230px]" />
      </CardPanel>
    );
  }

  const shown = games.slice(0, 15).reverse();
  if (!shown.length) {
    return (
      <CardPanel className="mt-4">
        <CardHeader>
          <CardTitle>Recent games</CardTitle>
        </CardHeader>
        <p className="py-10 text-center text-[length:var(--fs-sm)] text-[var(--text-3)]">
          No verified game log is available for this player and market yet.
        </p>
      </CardPanel>
    );
  }

  const values = shown.map((game) => Number(game.value)).filter(Number.isFinite);
  const max = Math.max(...values, line) * 1.18 || 1;
  const height = 200;

  return (
    <CardPanel className="mt-4">
      <CardHeader>
        <CardTitle>Last {shown.length} · {market}</CardTitle>
        <div className="flex flex-wrap gap-4 text-[length:var(--fs-micro)] text-[var(--text-3)]">
          <span><i className="mr-1.5 inline-block size-2.5 rounded-[3px] bg-[var(--pos)] align-[-1px]" />Over</span>
          <span><i className="mr-1.5 inline-block size-2.5 rounded-[3px] bg-[color-mix(in_srgb,var(--neg)_72%,var(--surface-3))] align-[-1px]" />Under</span>
          <span><i className="mr-1.5 inline-block size-2.5 border border-dashed border-[var(--line-strong)] bg-[repeating-linear-gradient(45deg,var(--surface-3)_0_3px,transparent_3px_6px)] align-[-1px]" />DNP</span>
          <span><i className="mr-1.5 mt-[5px] inline-block h-0 w-2.5 border-t-2 border-dashed border-[var(--warn)] align-[-1px]" />Line</span>
        </div>
      </CardHeader>

      <div className="relative min-w-0 pr-[46px] pt-6">
        <div
          className="pointer-events-none absolute right-[46px] left-0 z-10 h-0 border-t-2 border-dashed border-[var(--warn)]"
          style={{ bottom: (line / max) * height + 26 }}
        >
          <span className="num absolute top-[-10px] left-full ml-1.5 whitespace-nowrap rounded border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-[var(--surface-2)] px-1.5 py-1 text-[length:var(--fs-micro)] font-bold text-[var(--warn)]">
            {line}
          </span>
        </div>

        <div className="grid min-w-0 grid-flow-col items-end gap-1" style={{ height, gridAutoColumns: 'minmax(0,1fr)' }}>
          {shown.map((game, index) => {
            const value = Number(game.value);
            const dnp = game.value === null || game.value === undefined || !Number.isFinite(value);
            const result = dnp ? 'dnp' : value > line ? 'over' : value < line ? 'under' : 'push';
            const barHeight = dnp ? 40 : Math.max(4, (value / max) * height);
            const edge = index < 2 ? 'start' : index > shown.length - 3 ? 'end' : 'mid';
            return (
              <button
                key={game.gameId || `${game.date}-${index}`}
                type="button"
                className="group relative grid h-full min-w-0 content-end bg-transparent p-0"
                aria-label={`${game.opponent || 'Game'} ${shortDate(game.date)}: ${dnp ? 'did not play' : `${value}, ${result}`}`}
              >
                <span
                  className={cn(
                    'pointer-events-none absolute bottom-[calc(100%+8px)] z-20 whitespace-nowrap rounded-[var(--radius-sm)]',
                    'border border-[var(--line-strong)] bg-[var(--surface-3)] px-3 py-2 text-[length:var(--fs-micro)] text-[var(--text)] shadow-[var(--shadow-2)]',
                    'opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100',
                    edge === 'start' && 'left-0', edge === 'end' && 'right-0', edge === 'mid' && 'left-1/2 -translate-x-1/2',
                  )}
                >
                  {game.opponent || '—'} · <b className="num">{dnp ? 'DNP' : value}</b>
                  <span className="ml-1 text-[var(--text-3)]">{shortDate(game.date)}</span>
                </span>
                <span
                  className={cn(
                    'block origin-bottom rounded-t transition-transform duration-[480ms] ease-[var(--ease-spring)]',
                    result === 'over' && 'bg-[var(--pos)]',
                    result === 'under' && 'bg-[color-mix(in_srgb,var(--neg)_72%,var(--surface-3))]',
                    result === 'push' && 'bg-[var(--surface-3)]',
                    result === 'dnp' && 'border border-dashed border-b-0 border-[var(--line-strong)] bg-[repeating-linear-gradient(45deg,var(--surface-3)_0_4px,transparent_4px_8px)]',
                  )}
                  style={{ height: barHeight, transform: grown ? 'scaleY(1)' : 'scaleY(0)', transitionDelay: `${index * 36}ms` }}
                />
              </button>
            );
          })}
        </div>

        <div className="mt-2 grid min-w-0 grid-flow-col gap-1 pr-[46px]" style={{ gridAutoColumns: 'minmax(0,1fr)' }}>
          {shown.map((game, index) => (
            <span key={game.gameId || `x-${index}`} className="min-w-0 overflow-hidden whitespace-nowrap pt-1.5 text-center text-[9px] font-medium text-[var(--text-3)] sm:text-[length:var(--fs-micro)]">
              {game.isHome === false ? '@' : ''}{game.opponent || '—'}
            </span>
          ))}
        </div>
      </div>
    </CardPanel>
  );
}

export function GameLog({
  games,
  line,
  market,
  loading,
}: {
  games: GameLogRow[];
  line: number;
  market: string;
  loading?: boolean;
}) {
  return (
    <CardPanel className="mt-4">
      <CardHeader>
        <CardTitle>Game log</CardTitle>
        <span className="text-[length:var(--fs-xs)] text-[var(--text-3)]">Season + playoffs</span>
      </CardHeader>
      {loading ? (
        <div className="grid gap-2">{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-11" />)}</div>
      ) : !games.length ? (
        <p className="py-8 text-center text-[length:var(--fs-sm)] text-[var(--text-3)]">No games to show yet.</p>
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Opp</Th>
                <Th>Result</Th>
                <Th className="text-right">{market}</Th>
                <Th className="text-right">vs line</Th>
                <Th className="text-right">Date</Th>
              </tr>
            </thead>
            <tbody>
              {games.map((game, index) => {
                const value = Number(game.value);
                const dnp = game.value === null || game.value === undefined || !Number.isFinite(value);
                const result = dnp ? 'dnp' : value > line ? 'over' : value < line ? 'under' : 'push';
                const delta = dnp ? null : value - line;
                return (
                  <Tr key={game.gameId || `${game.date}-${index}`}>
                    <Td>{game.isHome === false ? '@' : ''}{game.opponent || '—'}</Td>
                    <Td><ResultBadge result={result} /></Td>
                    <Td className="num text-right font-semibold">{dnp ? '—' : value}</Td>
                    <Td className={cn('num text-right', delta !== null && delta > 0 && 'text-[var(--pos)]', delta !== null && delta < 0 && 'text-[var(--neg)]')}>
                      {delta === null ? '—' : signed(delta)}
                    </Td>
                    <Td className="text-right text-[var(--text-3)]">{shortDate(game.date)}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </CardPanel>
  );
}

function ResultBadge({ result }: { result: 'over' | 'under' | 'push' | 'dnp' }) {
  const map = {
    over: { label: 'OVER', className: 'text-[var(--pos)] bg-[color-mix(in_srgb,var(--pos)_14%,transparent)]' },
    under: { label: 'UNDER', className: 'text-[var(--neg)] bg-[color-mix(in_srgb,var(--neg)_14%,transparent)]' },
    push: { label: 'PUSH', className: 'text-[var(--text-3)] bg-[var(--surface-3)]' },
    dnp: { label: 'DNP', className: 'text-[var(--text-3)] bg-[var(--surface-3)]' },
  } as const;
  const { label, className } = map[result];
  return (
    <span className={cn('inline-flex h-7 items-center rounded-[var(--radius-sm)] px-2.5 text-[length:var(--fs-micro)] font-bold tracking-wide', className)}>
      {result === 'push' || result === 'dnp' ? <Minus className="mr-1 size-3" aria-hidden="true" /> : null}
      {label}
    </span>
  );
}

export function Splits({ research }: { research: ResearchResponse | null }) {
  const rows = [
    { key: 'Home', window: splitOf(research, 'home') },
    { key: 'Away', window: splitOf(research, 'away') },
    { key: 'Head to head', window: research?.h2h ?? null },
  ];
  const any = rows.some((row) => pctValue(row.window?.hitRate ?? null) !== null);
  if (!any) return null;

  return (
    <CardPanel className="mt-4">
      <CardHeader><CardTitle>Splits</CardTitle></CardHeader>
      <div className="grid gap-2 sm:grid-cols-3">
        {rows.map((row) => {
          const rate = pctValue(row.window?.hitRate ?? null);
          const sample = row.window?.sampleSize ?? row.window?.games ?? null;
          return (
            <div key={row.key} className="grid justify-items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)] p-3 text-center">
              <span className="text-[length:var(--fs-micro)] text-[var(--text-3)]">{row.key}</span>
              <span className={cn('num text-[length:var(--fs-md)] font-bold', rate === null ? 'text-[var(--text-3)]' : rate >= 60 ? 'text-[var(--pos)]' : rate < 45 ? 'text-[var(--neg)]' : 'text-[var(--text)]')}>
                {rate === null ? '—' : `${rate}%`}
              </span>
              <span className="text-[length:var(--fs-micro)] text-[var(--text-3)]">{sample === null ? 'no sample' : `${sample} games`}</span>
            </div>
          );
        })}
      </div>
    </CardPanel>
  );
}
