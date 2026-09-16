'use client';

import * as React from 'react';
import { ChevronDown, Minus, Plus, RotateCcw, Star } from 'lucide-react';
import type { GameLogRow, PropGroup, PropRow } from '@/lib/types';
import {
  applyFilters,
  buildWindows,
  computeWindow,
  distinct,
  EMPTY_FILTERS,
  filtersActive,
  headToHead,
  playable,
  sampleFor,
  sortRecentFirst,
  streakOf,
  type SampleFilters,
  type SampleId,
  type Side,
  type Window,
} from '@/lib/analytics';
import { cn, odds, shortDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

/* --------------------------------------------------------------- controls */

function Stepper({
  value,
  step,
  onChange,
  posted,
}: {
  value: number;
  step: number;
  onChange: (value: number) => void;
  posted: number;
}) {
  const moved = Math.round((value - posted) * 100) / 100;
  return (
    <div className="flex items-center overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-[var(--surface-2)]">
      <button
        type="button"
        onClick={() => onChange(Math.max(0, Math.round((value - step) * 100) / 100))}
        aria-label={`Lower the line to ${Math.max(0, value - step)}`}
        className="grid size-12 place-items-center text-[var(--text-2)] transition-colors duration-200 hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
      >
        <Minus className="size-4" strokeWidth={2.4} aria-hidden="true" />
      </button>
      <output
        aria-live="polite"
        className={cn(
          'num min-w-[86px] border-x border-[var(--line)] px-2 py-3 text-center',
          'text-[length:var(--fs-md)] font-bold',
          moved !== 0 && 'text-[var(--warn)]',
        )}
      >
        {value}
      </output>
      <button
        type="button"
        onClick={() => onChange(Math.round((value + step) * 100) / 100)}
        aria-label={`Raise the line to ${value + step}`}
        className="grid size-12 place-items-center text-[var(--text-2)] transition-colors duration-200 hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
      >
        <Plus className="size-4" strokeWidth={2.4} aria-hidden="true" />
      </button>
    </div>
  );
}

function SidePicker({ side, onChange }: { side: Side; onChange: (side: Side) => void }) {
  return (
    <div
      role="group"
      aria-label="Side"
      className="flex overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-[var(--surface-2)]"
    >
      {(['OVER', 'UNDER'] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={side === option}
          onClick={() => onChange(option)}
          className={cn(
            'min-h-12 px-4 text-[length:var(--fs-sm)] font-bold tracking-wide',
            'transition-[color,background-color,box-shadow] duration-200 ease-[var(--ease-out)]',
            'first:border-r first:border-[var(--line)]',
            side !== option && 'text-[var(--text-3)] hover:text-[var(--text)]',
            side === option &&
              option === 'OVER' &&
              'bg-[color-mix(in_srgb,var(--pos)_14%,transparent)] text-[var(--pos)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--pos)_55%,transparent)]',
            side === option &&
              option === 'UNDER' &&
              'bg-[color-mix(in_srgb,var(--neg)_14%,transparent)] text-[var(--neg)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--neg)_55%,transparent)]',
          )}
        >
          {option === 'OVER' ? 'O' : 'U'}
          <span className="ml-1.5 hidden sm:inline">{option === 'OVER' ? 'Over' : 'Under'}</span>
        </button>
      ))}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const id = React.useId();
  return (
    <div className="grid min-w-0 gap-1.5">
      <span id={id} className="text-[length:var(--fs-micro)] text-[var(--text-3)]">
        {label}
      </span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-labelledby={id} className="min-h-11">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/* ------------------------------------------------------------ sample strip */

function SampleChip({
  window,
  active,
  onSelect,
  suffix,
}: {
  window: Window;
  active: boolean;
  onSelect: () => void;
  suffix?: string;
}) {
  const rate = window.hitRate;
  const tone = rate === null ? 'none' : rate >= 60 ? 'pos' : rate < 45 ? 'neg' : 'mid';
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        'grid min-w-0 flex-1 gap-1 rounded-[var(--radius-sm)] border px-3 py-2.5 text-left',
        'transition-[border-color,background-color,transform] duration-200 ease-[var(--ease-out)]',
        'active:scale-[.98]',
        active
          ? 'border-[var(--line-strong)] bg-[var(--surface-3)] shadow-[var(--shadow-1)]'
          : 'border-transparent bg-transparent hover:bg-[var(--surface-2)]',
      )}
    >
      <span className="text-[length:var(--fs-xs)] font-bold tracking-wide text-[var(--text)]">
        {window.label}
      </span>
      <span
        className={cn(
          'num text-[length:var(--fs-xs)] font-semibold',
          tone === 'pos' && 'text-[var(--pos)]',
          tone === 'neg' && 'text-[var(--neg)]',
          tone === 'mid' && 'text-[var(--warn)]',
          tone === 'none' && 'text-[var(--text-3)]',
        )}
      >
        {rate === null ? 'No games' : `HR ${rate}%`}
      </span>
      <span className="num truncate text-[length:var(--fs-micro)] text-[var(--text-3)]">
        {window.average === null ? '—' : `${suffix ? `${suffix} ` : ''}Avg ${window.average}`}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ chart */

function ValueChart({
  games,
  line,
  side,
}: {
  games: GameLogRow[];
  line: number;
  side: Side;
}) {
  const [grown, setGrown] = React.useState(false);
  React.useEffect(() => {
    setGrown(false);
    const timer = window.setTimeout(() => setGrown(true), 40);
    return () => window.clearTimeout(timer);
  }, [games, line, side]);

  // Oldest on the left, so the run reads left to right like a timeline.
  const shown = [...games].reverse();
  const values = shown.map((game) => Number(game.value)).filter(Number.isFinite);
  if (!shown.length || !values.length) {
    return (
      <p className="py-14 text-center text-[length:var(--fs-sm)] text-[var(--text-3)]">
        No games match these filters.
      </p>
    );
  }

  const max = Math.max(...values, line) * 1.22;
  const height = 210;

  return (
    <div className="min-w-0">
      <div className="relative min-w-0 pt-7">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 z-10 h-0 border-t-2 border-dashed border-[var(--text-3)] opacity-70"
          style={{ bottom: (line / max) * height + 24 }}
        />
        <div
          className="grid min-w-0 grid-flow-col items-end gap-1 sm:gap-1.5"
          style={{ height, gridAutoColumns: 'minmax(0,1fr)' }}
        >
          {shown.map((game, index) => {
            const value = Number(game.value);
            const push = value === line;
            const hit = !push && (side === 'UNDER' ? value < line : value > line);
            const barHeight = Math.max(6, (value / max) * height);
            return (
              <div key={game.gameId || `${game.date}-${index}`} className="grid h-full min-w-0 content-end">
                <span
                  className={cn(
                    'num mb-1 truncate text-center text-[10px] font-bold sm:text-[length:var(--fs-micro)]',
                    push
                      ? 'text-[var(--text-3)]'
                      : hit
                        ? 'text-[var(--pos)]'
                        : 'text-[var(--neg)]',
                    'transition-opacity duration-300 ease-[var(--ease-out)]',
                    grown ? 'opacity-100' : 'opacity-0',
                  )}
                  style={{ transitionDelay: `${160 + index * 34}ms` }}
                >
                  {value}
                </span>
                <span
                  title={`${game.isHome === false ? '@ ' : ''}${game.opponent || '—'} · ${shortDate(game.date)} · ${value}`}
                  className={cn(
                    'block origin-bottom rounded-t-[5px]',
                    'transition-transform duration-[480ms] ease-[var(--ease-spring)]',
                    push
                      ? 'bg-[var(--surface-3)]'
                      : hit
                        ? 'bg-[linear-gradient(180deg,color-mix(in_srgb,var(--pos)_92%,white),var(--pos))]'
                        : 'bg-[linear-gradient(180deg,color-mix(in_srgb,var(--neg)_78%,white),color-mix(in_srgb,var(--neg)_82%,var(--surface-3)))]',
                  )}
                  style={{
                    height: barHeight,
                    transform: grown ? 'scaleY(1)' : 'scaleY(0)',
                    transitionDelay: `${index * 34}ms`,
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div
        className="mt-2 grid min-w-0 grid-flow-col gap-1 sm:gap-1.5"
        style={{ gridAutoColumns: 'minmax(0,1fr)' }}
      >
        {shown.map((game, index) => (
          <span
            key={game.gameId || `x-${index}`}
            className="min-w-0 overflow-hidden text-center text-[9px] font-medium whitespace-nowrap text-[var(--text-3)] sm:text-[length:var(--fs-micro)]"
          >
            {game.isHome === false ? '@' : ''}
            {game.opponent || '—'}
          </span>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- explorer */

export type ExplorerState = { line: number; side: Side; book: string | null };

/**
 * The working surface for one prop: move the line, switch side, pick a book,
 * narrow the sample, and watch every number and every bar move with it.
 *
 * Everything here is recomputed from the game log the research route returned,
 * on the reader's own machine — so the stepper and the filters are instant and
 * cost the rate-limited research route nothing.
 */
export function PropExplorer({
  group,
  games,
  loading,
  unavailableReason,
  state,
  onState,
  favourite,
  onFavourite,
}: {
  group: PropGroup;
  games: GameLogRow[];
  loading?: boolean;
  unavailableReason?: string | null;
  state: ExplorerState;
  onState: (next: ExplorerState) => void;
  favourite: boolean;
  onFavourite: () => void;
}) {
  const [filters, setFilters] = React.useState<SampleFilters>(EMPTY_FILTERS);
  const [sample, setSample] = React.useState<SampleId>('l10');

  // A different prop is a different sample; start it clean.
  React.useEffect(() => {
    setFilters(EMPTY_FILTERS);
    setSample('l10');
  }, [group.key]);

  const played = React.useMemo(() => sortRecentFirst(playable(games)), [games]);
  const filtered = React.useMemo(() => applyFilters(played, filters), [played, filters]);
  const opponentCode = group.opponent || null;

  const windows = React.useMemo(
    () => buildWindows(filtered, state.line, state.side),
    [filtered, state.line, state.side],
  );
  const h2h = React.useMemo(
    () => headToHead(played, opponentCode, state.line, state.side),
    [played, opponentCode, state.line, state.side],
  );
  const streak = React.useMemo(
    () => streakOf(filtered, state.line, state.side),
    [filtered, state.line, state.side],
  );

  const chartGames = React.useMemo(
    () => (sample === 'h2h' ? sampleFor(played, 'h2h', opponentCode) : sampleFor(filtered, sample, opponentCode)),
    [played, filtered, sample, opponentCode],
  );
  const chartWindow = React.useMemo(
    () => computeWindow(chartGames, state.line, state.side, 'chart', 'Shown', undefined),
    [chartGames, state.line, state.side],
  );

  /* Filter choices come from the sample itself, so a dropdown never offers an
     opponent or a season this player has no games against. */
  const opponents = React.useMemo(
    () => distinct(played.map((game) => game.opponent)).sort(),
    [played],
  );
  const seasons = React.useMemo(
    () => distinct(played.map((game) => (game.season == null ? null : String(game.season)))).sort().reverse(),
    [played],
  );

  const books = React.useMemo(() => {
    const seen = new Map<string, { key: string; name: string; over: PropRow | null; under: PropRow | null }>();
    for (const quote of group.quotes) {
      const name = String(quote.sportsbook || quote.sportsbookKey || '').trim();
      if (!name) continue;
      const key = (quote.sportsbookKey || name).toLowerCase();
      if (!seen.has(key)) seen.set(key, { key, name, over: null, under: null });
      const row = seen.get(key)!;
      const price = Number(quote.price);
      if (!Number.isFinite(price)) continue;
      if (String(quote.side || '').toUpperCase() === 'OVER' && (!row.over || price > Number(row.over.price))) row.over = quote;
      if (String(quote.side || '').toUpperCase() === 'UNDER' && (!row.under || price > Number(row.under.price))) row.under = quote;
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [group.quotes]);

  const activeBook = books.find((book) => book.key === state.book) || books[0] || null;
  const lineStep = group.line < 12 ? 0.5 : group.line < 60 ? 0.5 : 0.5;
  const moved = Math.round((state.line - group.line) * 100) / 100;

  return (
    <div className="grid gap-5">
      {/* line, side, book, favourite */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <Stepper
          value={state.line}
          step={lineStep}
          posted={group.line}
          onChange={(line) => onState({ ...state, line })}
        />
        <SidePicker side={state.side} onChange={(side) => onState({ ...state, side })} />

        {books.length > 0 && (
          <div className="grid min-w-0 gap-1.5">
            <Select
              value={activeBook?.key ?? ''}
              onValueChange={(book) => onState({ ...state, book })}
            >
              <SelectTrigger aria-label="Sportsbook" className="min-h-12 min-w-[190px]">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="truncate">{activeBook?.name}</span>
                  <span className="num flex shrink-0 gap-2 text-[length:var(--fs-xs)]">
                    <span className="text-[var(--pos)]">O {odds(activeBook?.over?.price)}</span>
                    <span className="text-[var(--neg)]">U {odds(activeBook?.under?.price)}</span>
                  </span>
                </span>
              </SelectTrigger>
              <SelectContent>
                {books.map((book) => (
                  <SelectItem key={book.key} value={book.key}>
                    {book.name} · O {odds(book.over?.price)} / U {odds(book.under?.price)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <button
          type="button"
          aria-pressed={favourite}
          onClick={onFavourite}
          aria-label={favourite ? `Unfollow ${group.player}` : `Follow ${group.player}`}
          className={cn(
            'grid size-12 place-items-center rounded-[var(--radius)] border',
            'transition-[color,border-color,background-color,transform] duration-200 ease-[var(--ease-out)] active:scale-[.94]',
            favourite
              ? 'border-[color-mix(in_srgb,var(--warn)_55%,transparent)] bg-[color-mix(in_srgb,var(--warn)_14%,transparent)] text-[var(--warn)]'
              : 'border-[var(--line)] bg-[var(--surface-2)] text-[var(--text-3)] hover:border-[var(--line-strong)] hover:text-[var(--text)]',
          )}
        >
          <Star className="size-5" fill={favourite ? 'currentColor' : 'none'} aria-hidden="true" />
        </button>
      </div>

      {moved !== 0 && (
        <p className="-mt-2 flex flex-wrap items-center gap-2 text-[length:var(--fs-xs)] text-[var(--warn)]">
          Reading against {state.line}, not the posted {group.line}.
          <button
            type="button"
            onClick={() => onState({ ...state, line: group.line })}
            className="font-semibold underline underline-offset-4"
          >
            Back to the posted line
          </button>
        </p>
      )}

      {/* sample filters */}
      <div className="grid gap-3">
        <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
          <FilterSelect
            label="Opponent"
            value={filters.opponent}
            onChange={(opponent) => setFilters((prev) => ({ ...prev, opponent }))}
            options={[
              { value: 'all', label: 'All' },
              ...opponents.map((code) => ({ value: code, label: code })),
            ]}
          />
          <FilterSelect
            label="Season"
            value={filters.season}
            onChange={(season) => setFilters((prev) => ({ ...prev, season }))}
            options={[
              { value: 'all', label: 'All' },
              ...seasons.map((season) => ({ value: season, label: season })),
            ]}
          />
          <FilterSelect
            label="Home / Away"
            value={filters.venue}
            onChange={(venue) => setFilters((prev) => ({ ...prev, venue: venue as SampleFilters['venue'] }))}
            options={[
              { value: 'all', label: 'All' },
              { value: 'home', label: 'Home' },
              { value: 'away', label: 'Away' },
            ]}
          />
          <Button
            variant="ghost"
            size="md"
            disabled={!filtersActive(filters)}
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="col-span-2 sm:col-span-1"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            Reset
          </Button>
        </div>
        {filtersActive(filters) && (
          <p className="text-[length:var(--fs-xs)] text-[var(--text-3)]">
            {filtered.length} of {played.length} games match.
          </p>
        )}
      </div>

      {/* windows */}
      {loading ? (
        <Skeleton className="h-[86px] rounded-[var(--radius)]" />
      ) : (
        <div className="rail gap-1 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--surface-2)] p-1.5">
          {windows.map((window) => (
            <SampleChip
              key={window.id}
              window={window}
              active={sample === window.id}
              onSelect={() => setSample(window.id as SampleId)}
            />
          ))}
          {h2h && (
            <SampleChip
              window={{ ...h2h, label: `vs ${opponentCode}` }}
              active={sample === 'h2h'}
              onSelect={() => setSample('h2h')}
              suffix={`${h2h.games}G`}
            />
          )}
        </div>
      )}

      {/* chart */}
      {loading ? (
        <Skeleton className="h-[260px] rounded-[var(--radius)]" />
      ) : unavailableReason ? (
        <div className="grid justify-items-center gap-2 rounded-[var(--radius)] border border-dashed border-[var(--line-strong)] px-6 py-14 text-center">
          <p className="text-[length:var(--fs-sm)] font-semibold">No game history for this market</p>
          <p className="max-w-[54ch] text-[length:var(--fs-sm)] leading-relaxed text-[var(--text-3)]">
            {unavailableReason}
          </p>
        </div>
      ) : (
        <>
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="text-[length:var(--fs-sm)] font-semibold normal-case">
              {chartGames.length} game{chartGames.length === 1 ? '' : 's'} shown
            </h3>
            {/* separate spans rather than one long string, so a narrow panel
                wraps the summary instead of clipping the end of it */}
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-[length:var(--fs-xs)] text-[var(--text-3)]">
              {chartWindow.hitRate === null ? (
                <span>No sample</span>
              ) : (
                <>
                  <span className="num">
                    {chartWindow.hits}/{chartWindow.games}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="num">{chartWindow.hitRate}%</span>
                  <span aria-hidden="true">·</span>
                  <span className="num">avg {chartWindow.average}</span>
                </>
              )}
              {streak && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="num">
                    {streak.count} straight {streak.over ? 'over' : 'under'}
                  </span>
                </>
              )}
            </div>
          </div>
          <ValueChart games={chartGames} line={state.line} side={state.side} />
        </>
      )}
    </div>
  );
}
