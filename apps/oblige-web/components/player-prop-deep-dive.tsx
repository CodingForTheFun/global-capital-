'use client';

import * as React from 'react';
import { ArrowRight, ChevronDown, Flame, Minus, Plus, Star } from 'lucide-react';
import type { GameLogRow, PropGroup, ResearchResponse, Side } from '@/lib/types';
import {
  applyFilters,
  computeWindow,
  headToHead,
  sortRecentFirst,
  type SampleFilters,
} from '@/lib/analytics';
import { buildOpponentOptions } from '@/lib/opponent-options';
import { catalogBookRows } from '@/lib/book-catalog';
import { PlayerAvatar } from '@/components/face-card';
import { marketDisplayLabel, odds, shortDate, shortTime } from '@/lib/utils';

export type DeepDiveState = {
  line: number;
  side: Side;
  book: string | null;
};

type Props = {
  group: PropGroup;
  markets: PropGroup[];
  research: ResearchResponse | null;
  loading: boolean;
  state: DeepDiveState;
  onState(next: DeepDiveState): void;
  favourite: boolean;
  onFavourite(): void;
  onMarket(group: PropGroup): void;
  fullResearch: React.ReactNode;
};

type SampleId = 'l5' | 'l10' | 'l15' | 'l20' | 'season' | 'h2h';

const text = (value: unknown) => String(value ?? '').trim();

function periodLabel(value: string | null) {
  const raw = text(value).toLowerCase();
  if (!raw || ['game', 'full', 'fullgame', 'match', 'singlestat', 'single_stat'].includes(raw)) return 'Full Game';
  const direct = raw.match(/^([1-9])([qhpis])$/);
  if (direct) {
    const suffix: Record<string, string> = { q: 'Q', h: 'H', p: 'P', i: 'I', s: 'S' };
    return `${direct[1]}${suffix[direct[2]] || direct[2].toUpperCase()}`;
  }
  return raw.toUpperCase();
}

function bookInitials(name: string) {
  const clean = name.replace(/[^a-z0-9]/gi, '').toUpperCase();
  return clean.slice(0, 2) || 'BK';
}

function compactStatLabel(label: string) {
  const key = label.toLowerCase();
  const known: Array<[RegExp, string]> = [
    [/^receptions?$/, 'REC'],
    [/receiv.*yards|reception yards/, 'REC YDS'],
    [/^targets?$/, 'TARGETS'],
    [/touchdowns?|anytime touchdown/, 'TD'],
    [/rush.*yards/, 'RUSH YDS'],
    [/longest.*reception/, 'LONG'],
    [/pass.*yards/, 'PASS YDS'],
    [/^points$/, 'PTS'],
    [/rebounds?/, 'REB'],
    [/assists?/, 'AST'],
    [/three|3-pointer/, '3PM'],
    [/strikeouts?/, 'K'],
    [/total bases/, 'TB'],
    [/shots on goal/, 'SOG'],
    [/^aces?$/, 'ACES'],
    [/double faults?/, 'DF'],
    [/solo tackles?/, 'SOLO TKL'],
    [/combined tackles?/, 'TACKLES'],
  ];
  return known.find(([pattern]) => pattern.test(key))?.[1] || label.toUpperCase().slice(0, 15);
}

function gameLabel(group: PropGroup) {
  const start = shortTime(group.startsAt);
  return start ? `${group.matchup} · ${start}` : group.matchup;
}

function finiteValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function SelectFilter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange(value: string): void;
}) {
  const selected = options.find((option) => option.value === value)?.label || value;
  return (
    <label data-filter={label} className="deep-dive-filter relative flex h-10 min-w-[112px] shrink-0 items-center gap-1 rounded-lg border border-slate-700/80 bg-slate-900/80 px-2.5 pr-7 text-[10px] text-slate-400">
      <span className="whitespace-nowrap text-slate-500">{label}:</span>
      <span className="max-w-[108px] truncate font-semibold text-slate-200">{selected}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 h-3 w-3 text-slate-500" aria-hidden="true" />
    </label>
  );
}

function Chart({
  games,
  line,
  market,
}: {
  games: GameLogRow[];
  line: number;
  market: string;
}) {
  const rows = [...games].reverse();
  const observed = rows.map((game) => finiteValue(game.value)).filter((value): value is number => value !== null);
  const ceiling = Math.max(1, line, ...observed) * 1.18;
  const threshold = Math.max(0, Math.min(100, (line / ceiling) * 100));

  if (!rows.length) {
    return (
      <div className="grid min-h-[230px] place-items-center rounded-xl border border-dashed border-slate-800 px-5 text-center text-xs text-slate-500">
        No verified games match these filters.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="min-w-[520px]">
        <div className="relative h-[220px] border-b border-slate-700 bg-[repeating-linear-gradient(to_top,transparent_0,transparent_54px,rgba(71,85,105,.16)_54px,rgba(71,85,105,.16)_55px)]">
          <div
            className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-amber-400"
            style={{ bottom: `${threshold}%` }}
          >
            <span className="absolute right-0 -top-5 rounded bg-[#211d10] px-1.5 py-0.5 text-[9px] font-black text-amber-300">
              {line}
            </span>
          </div>
          <div
            className="absolute inset-0 grid items-end gap-2 px-1 pt-7"
            style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(22px, 1fr))` }}
          >
            {rows.map((game, index) => {
              const value = finiteValue(game.value);
              const dnp = value === null;
              const height = dnp ? 7 : Math.max(2, Math.min(100, (value / ceiling) * 100));
              const result = dnp ? 'dnp' : value > line ? 'over' : value < line ? 'under' : 'push';
              return (
                <div key={`${game.gameId || game.date || index}-${index}`} className="relative flex h-full items-end">
                  <span
                    className="absolute inset-x-0 text-center text-[9px] font-bold text-slate-300"
                    style={{ bottom: `calc(${height}% + 4px)` }}
                  >
                    {dnp ? 'DNP' : value}
                  </span>
                  <span
                    title={`${shortDate(game.date)} ${game.isHome === false ? '@' : 'vs'} ${game.opponent || 'Opponent'} · ${market}: ${dnp ? 'DNP' : value}`}
                    className={[
                      'deep-dive-chart-bar block w-full rounded-t-[5px] border',
                      result === 'over'
                        ? 'border-emerald-400/25 bg-gradient-to-t from-emerald-600 to-emerald-400'
                        : result === 'under'
                          ? 'border-rose-400/25 bg-gradient-to-t from-rose-700 to-rose-400'
                          : result === 'push'
                            ? 'border-slate-400/30 bg-slate-500'
                            : 'border-slate-600 bg-[repeating-linear-gradient(45deg,#111827_0,#111827_5px,#475569_5px,#475569_7px)]',
                    ].join(' ')}
                    style={{ height: `${height}%` }}
                  />
                </div>
              );
            })}
          </div>
        </div>
        <div
          className="mt-1 grid gap-2 px-1 text-center"
          style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(22px, 1fr))` }}
        >
          {rows.map((game, index) => (
            <span key={`label-${game.gameId || game.date || index}-${index}`} className="min-w-0 overflow-hidden text-[8px] text-slate-500">
              <b className="block truncate font-semibold text-slate-400">{shortDate(game.date)}</b>
              <span className="block truncate">{game.isHome === false ? '@' : 'vs'}{game.opponent || '—'}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PlayerPropDeepDive({
  group,
  markets,
  research,
  loading,
  state,
  onState,
  favourite,
  onFavourite,
  onMarket,
  fullResearch,
}: Props) {
  const [filters, setFilters] = React.useState<SampleFilters>({ opponent: 'all', season: 'all', venue: 'all' });
  const [sample, setSample] = React.useState<SampleId>('l15');
  const [showFullResearch, setShowFullResearch] = React.useState(false);

  React.useEffect(() => {
    setFilters({ opponent: 'all', season: 'all', venue: 'all' });
    setSample('l15');
    setShowFullResearch(false);
  }, [group.key]);

  const marketLabel = marketDisplayLabel(group.market, group.player, group.marketId, group.sport);
  const rawGames = research?.gameLog || [];
  // Missing/DNP values are not zeroes. Keep them out of hit-rate denominators
  // while leaving them available to the chart as explicit unavailable rows.
  const verifiedGames = React.useMemo(
    () => sortRecentFirst(rawGames.filter((game) => finiteValue(game.value) !== null)),
    [rawGames],
  );
  const filteredGames = React.useMemo(
    () => sortRecentFirst(applyFilters(rawGames, filters).filter((game) => finiteValue(game.value) !== null)),
    [rawGames, filters],
  );
  const filteredAllRows = React.useMemo(() => applyFilters(rawGames, filters), [rawGames, filters]);
  const currentOpponent = text(research?.matchup?.opponent || group.opponent) || null;

  const opponentOptions = React.useMemo(
    () => buildOpponentOptions(verifiedGames.map((game) => game.opponent), group, research?.leagueTeams || []),
    [verifiedGames, group, research?.leagueTeams],
  );
  const seasonOptions = React.useMemo(() => {
    const seasons = [...new Set(verifiedGames.map((game) => text(game.season)).filter(Boolean))].sort().reverse();
    return [{ value: 'all', label: 'All years' }, ...seasons.map((season) => ({ value: season, label: season }))];
  }, [verifiedGames]);

  const books = React.useMemo(() => catalogBookRows(group.quotes), [group.quotes]);
  const availableBooks = React.useMemo(() => books.filter((book) => book.available), [books]);
  const selectedBook = state.book ? books.find((book) => book.key === state.book) || null : null;
  const over = selectedBook?.over || group.bestOver;
  const under = selectedBook?.under || group.bestUnder;

  const windows = React.useMemo(() => {
    const h2h = headToHead(filteredGames, currentOpponent, state.line, state.side);
    return [
      computeWindow(filteredGames, state.line, state.side, 'l5', 'L5', 5),
      computeWindow(filteredGames, state.line, state.side, 'l10', 'L10', 10),
      computeWindow(filteredGames, state.line, state.side, 'l15', 'L15', 15),
      computeWindow(filteredGames, state.line, state.side, 'l20', 'L20', 20),
      computeWindow(filteredGames, state.line, state.side, 'season', 'SZN'),
      h2h || computeWindow([], state.line, state.side, 'h2h', 'H2H'),
    ];
  }, [filteredGames, currentOpponent, state.line, state.side]);

  const chartGames = React.useMemo(() => {
    if (sample === 'h2h') {
      return currentOpponent
        ? filteredAllRows.filter((game) => text(game.opponent) === currentOpponent).slice(0, 15)
        : [];
    }
    if (sample === 'season') return filteredAllRows.slice(0, 20);
    const count = sample === 'l5' ? 5 : sample === 'l10' ? 10 : sample === 'l20' ? 20 : 15;
    return filteredAllRows.slice(0, count);
  }, [filteredAllRows, currentOpponent, sample]);

  const categoryLabels = React.useMemo(() => {
    const map = new Map<string, PropGroup[]>();
    for (const candidate of markets) {
      const label = marketDisplayLabel(candidate.market, candidate.player, candidate.marketId, candidate.sport);
      const list = map.get(label) || [];
      list.push(candidate);
      map.set(label, list);
    }
    return [...map.entries()].map(([label, rows]) => ({ label, rows }));
  }, [markets]);

  const periods = React.useMemo(() => {
    const rows = categoryLabels.find((entry) => entry.label === marketLabel)?.rows || [group];
    const map = new Map<string, PropGroup[]>();
    for (const candidate of rows) {
      const key = candidate.period || 'game';
      const list = map.get(key) || [];
      list.push(candidate);
      map.set(key, list);
    }
    return [...map.entries()].map(([period, rows]) => ({ period, rows }));
  }, [categoryLabels, marketLabel, group]);

  const lines = React.useMemo(() => {
    const rows = categoryLabels.find((entry) => entry.label === marketLabel)?.rows || [group];
    return [...new Set(
      rows
        .filter((candidate) => (candidate.period || 'game') === (group.period || 'game'))
        .map((candidate) => candidate.line),
    )].sort((a, b) => a - b);
  }, [categoryLabels, marketLabel, group]);

  const values = filteredGames.map((game) => Number(game.value)).filter(Number.isFinite);
  const supporting = [
    { label: 'Average', value: values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1) : '—' },
    { label: 'High', value: values.length ? Math.max(...values) : '—' },
    { label: 'Low', value: values.length ? Math.min(...values) : '—' },
    { label: 'Sample', value: values.length || '—' },
  ];

  function chooseCategory(label: string) {
    const rows = categoryLabels.find((entry) => entry.label === label)?.rows || [];
    const next =
      rows.find((candidate) => (candidate.period || 'game') === (group.period || 'game') && candidate.line === group.line) ||
      rows.find((candidate) => (candidate.period || 'game') === (group.period || 'game')) ||
      rows[0];
    if (next) onMarket(next);
  }

  function choosePeriod(period: string) {
    const rows = periods.find((entry) => entry.period === period)?.rows || [];
    const next = rows.find((candidate) => candidate.line === group.line) || rows[0];
    if (next) onMarket(next);
  }

  function choosePostedLine(line: number) {
    const rows = categoryLabels.find((entry) => entry.label === marketLabel)?.rows || [];
    const next = rows.find(
      (candidate) =>
        (candidate.period || 'game') === (group.period || 'game') &&
        candidate.line === line,
    );
    if (next) onMarket(next);
  }

  return (
    <section
      className="deep-dive-card mx-auto w-full max-w-[1180px] overflow-hidden rounded-2xl border border-slate-800/90 bg-[#0b101a] text-slate-100 shadow-[0_18px_70px_rgba(0,0,0,.32)]"
      data-design="player-prop-deep-dive-restored"
    >
      <div className="border-b border-slate-800/90 bg-[radial-gradient(580px_180px_at_85%_-25%,rgba(59,130,246,.16),transparent_62%),linear-gradient(180deg,rgba(19,27,46,.94),rgba(10,15,24,.98))] p-3 sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative grid h-14 w-14 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,#38bdf8,#2563eb,#22c55e)] p-[2px] shadow-[0_0_28px_rgba(56,189,248,.28)] sm:h-[66px] sm:w-[66px]">
              <div className="h-full w-full overflow-hidden rounded-full bg-[#101827]">
                <PlayerAvatar
                  name={group.player}
                  sport={group.sport}
                  team={group.team}
                  providerPlayerId={group.providerPlayerId}
                  size={66}
                />
              </div>
              <span className="absolute -bottom-1 -right-1 rounded-full border border-slate-700 bg-[#111827] px-1.5 py-0.5 text-[8px] font-black text-sky-300">
                {group.sport}
              </span>
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <h1 className="truncate text-lg font-black tracking-[-.035em] text-white sm:text-2xl">{group.player}</h1>
                {group.position ? (
                  <span className="rounded-md border border-slate-700 bg-slate-900/90 px-1.5 py-0.5 text-[9px] font-black text-slate-400">
                    {group.position}
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-400 sm:mt-1 sm:text-xs">
                {gameLabel(group)}
              </p>
              <p className="mt-1 hidden text-[9px] text-slate-500 sm:block">
                {group.team || 'Team unavailable'} · {loading ? 'Loading history…' : research?.available === false ? 'History unavailable' : 'Verified history'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onFavourite}
            aria-label={favourite ? `Unfollow ${group.player}` : `Follow ${group.player}`}
            aria-pressed={favourite}
            className={[
              'inline-flex h-9 w-9 shrink-0 items-center justify-center gap-2 rounded-lg border text-xs font-bold transition sm:w-auto sm:px-3',
              favourite
                ? 'border-amber-400/40 bg-amber-400/10 text-amber-300'
                : 'border-slate-700 bg-slate-900/80 text-slate-300 hover:border-slate-600 hover:text-white',
            ].join(' ')}
          >
            <Star className={`h-3.5 w-3.5 ${favourite ? 'fill-current' : ''}`} />
            <span className="hidden sm:inline">{favourite ? 'Watching' : 'Add to Watchlist'}</span>
          </button>
        </div>

        <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-sky-500/20 bg-sky-500/[.07] p-2 sm:mt-4 sm:p-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="rounded-md bg-sky-500 px-2 py-1 text-[9px] font-black tracking-wide text-white">
              {bookInitials(selectedBook?.name || (over?.sportsbook || under?.sportsbook || 'BEST'))}
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-xs font-bold text-white sm:text-sm">{marketLabel}</h2>
              <p className="hidden text-[9px] text-slate-500 sm:block">Main prop · {periodLabel(group.period)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="relative block">
              <span className="sr-only">Sportsbook</span>
              <select
                aria-label="Sportsbook"
                value={state.book || 'all'}
                onChange={(event) => onState({ ...state, book: event.target.value === 'all' ? null : event.target.value })}
                className="h-8 max-w-[112px] appearance-none rounded-lg border border-sky-400/20 bg-slate-950/60 pl-2 pr-6 text-[9px] font-bold text-slate-300 outline-none"
              >
                <option value="all">Best prices</option>
                {availableBooks.map((book) => <option key={book.key} value={book.key}>{book.name}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-1.5 top-2.5 h-3 w-3 text-slate-500" />
            </label>
            <div className="grid text-right text-[11px] font-black leading-tight tabular-nums">
              <span className="text-emerald-400">O {odds(over?.price)}</span>
              <span className="text-rose-400">U {odds(under?.price)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3 p-2.5 sm:p-4">
        <div className="flex items-center gap-2">
          <div role="group" aria-label="Stat categories" className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {categoryLabels.map((entry) => {
              const active = entry.label === marketLabel;
              return (
                <button
                  key={entry.label}
                  type="button"
                  aria-pressed={active}
                  onClick={() => chooseCategory(entry.label)}
                  className={[
                    'h-9 shrink-0 rounded-lg border px-3 text-[10px] font-black tracking-wide transition',
                    active
                      ? 'border-sky-400/50 bg-sky-500/15 text-sky-300 shadow-[0_0_20px_rgba(56,189,248,.16)]'
                      : 'border-slate-800 bg-slate-900/60 text-slate-500 hover:border-slate-700 hover:text-slate-300',
                  ].join(' ')}
                >
                  {compactStatLabel(entry.label)}
                </button>
              );
            })}
          </div>
        </div>

        <div role="group" aria-label="Available game periods" className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {periods.map((entry) => {
            const active = entry.period === (group.period || 'game');
            return (
              <button
                key={entry.period}
                type="button"
                aria-pressed={active}
                onClick={() => choosePeriod(entry.period)}
                className={[
                  'h-8 shrink-0 rounded-full border px-3 text-[10px] font-bold transition',
                  active
                    ? 'border-blue-400/40 bg-blue-500 text-white shadow-[0_0_18px_rgba(59,130,246,.24)]'
                    : 'border-slate-800 bg-[#0e1522] text-slate-500 hover:text-slate-300',
                ].join(' ')}
              >
                {periodLabel(entry.period)}
              </button>
            );
          })}
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <SelectFilter label="Opponent" value={filters.opponent} options={opponentOptions} onChange={(opponent) => setFilters((previous) => ({ ...previous, opponent }))} />
          <SelectFilter label="Season" value={filters.season} options={seasonOptions} onChange={(season) => setFilters((previous) => ({ ...previous, season }))} />
          <SelectFilter
            label="Home/Away"
            value={filters.venue}
            options={[{ value: 'all', label: 'All' }, { value: 'home', label: 'Home' }, { value: 'away', label: 'Away' }]}
            onChange={(venue) => setFilters((previous) => ({ ...previous, venue: venue as SampleFilters['venue'] }))}
          />
          <SelectFilter
            label="Book"
            value={state.book || 'all'}
            options={[{ value: 'all', label: 'Best prices' }, ...availableBooks.map((book) => ({ value: book.key, label: book.name }))]}
            onChange={(book) => onState({ ...state, book: book === 'all' ? null : book })}
          />
        </div>

        <div className="flex min-h-5 items-center justify-between gap-3 text-[10px] text-slate-500">
          <span className="deep-dive-sample-count">{filteredGames.length} of {verifiedGames.length} verified games</span>
          {(filters.opponent !== 'all' || filters.season !== 'all' || filters.venue !== 'all') ? (
            <button
              type="button"
              onClick={() => setFilters({ opponent: 'all', season: 'all', venue: 'all' })}
              className="font-semibold text-sky-300"
            >
              Clear filters
            </button>
          ) : null}
        </div>

        <div className="grid gap-3 lg:grid-cols-[300px_1fr]">
          <div className="rounded-2xl border border-slate-800 bg-[#0d1420] p-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[9px] font-bold uppercase tracking-[.16em] text-slate-500">Target line</div>
              {lines.length > 1 ? (
                <select
                  aria-label="Posted line"
                  value={group.line}
                  onChange={(event) => choosePostedLine(Number(event.target.value))}
                  className="h-7 max-w-[130px] rounded-lg border border-slate-800 bg-slate-950/60 px-2 text-[10px] font-bold text-slate-400 outline-none"
                >
                  {lines.map((line) => <option key={line} value={line}>{line}</option>)}
                </select>
              ) : (
                <span className="text-[9px] text-slate-600">Posted {group.line}</span>
              )}
            </div>
            <div className="mt-1.5 grid grid-cols-[40px_1fr_40px] overflow-hidden rounded-xl border border-slate-700 bg-slate-950/70">
              <button
                type="button"
                onClick={() => onState({ ...state, line: Math.max(0, Math.round((state.line - .5) * 10) / 10) })}
                className="grid h-10 place-items-center border-r border-slate-800 text-slate-400 hover:bg-slate-900 hover:text-white"
                aria-label="Lower research line"
              >
                <Minus className="h-4 w-4" />
              </button>
              <output className="deep-dive-line-number grid h-10 place-items-center text-lg font-black tabular-nums text-white" aria-live="polite">
                {Number.isInteger(state.line) ? state.line : state.line.toFixed(1)}
              </output>
              <button
                type="button"
                onClick={() => onState({ ...state, line: Math.round((state.line + .5) * 10) / 10 })}
                className="grid h-10 place-items-center border-l border-slate-800 text-slate-400 hover:bg-slate-900 hover:text-white"
                aria-label="Raise research line"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-1.5 grid grid-cols-2 overflow-hidden rounded-lg border border-slate-800 bg-slate-950/60">
              <button
                type="button"
                aria-pressed={state.side === 'OVER'}
                data-side="OVER"
                onClick={() => onState({ ...state, side: 'OVER' })}
                className={`px-2 py-2 text-left ${state.side === 'OVER' ? 'bg-emerald-400/[.08]' : ''}`}
              >
                <span className="block text-[8px] font-bold uppercase text-emerald-500/80">Over</span>
                <strong className="mt-0.5 block text-sm font-black tabular-nums text-emerald-400">{odds(over?.price)}</strong>
              </button>
              <button
                type="button"
                aria-pressed={state.side === 'UNDER'}
                data-side="UNDER"
                onClick={() => onState({ ...state, side: 'UNDER' })}
                className={`border-l border-slate-800 px-2 py-2 text-left ${state.side === 'UNDER' ? 'bg-rose-400/[.08]' : ''}`}
              >
                <span className="block text-[8px] font-bold uppercase text-rose-500/80">Under</span>
                <strong className="mt-0.5 block text-sm font-black tabular-nums text-rose-400">{odds(under?.price)}</strong>
              </button>
            </div>
            <p className="deep-dive-price-note mt-1.5 text-[8px] leading-relaxed text-slate-600">Book prices reflect posted line {group.line}; adjusted target line recalculates verified history only.</p>
          </div>

          {!loading && research?.available !== false ? (
            <div className="grid grid-cols-6 overflow-hidden rounded-2xl border border-slate-800 bg-[#0d1420]">
              {windows.map((item, index) => (
                <button
                  type="button"
                  key={item.id}
                  aria-pressed={sample === item.id}
                  onClick={() => setSample(item.id as SampleId)}
                  className={[
                    'min-w-0 px-1 py-2.5 text-center transition hover:bg-slate-900/50',
                    sample === item.id ? 'bg-sky-500/[.06]' : '',
                    index !== windows.length - 1 ? 'border-r border-slate-800' : '',
                  ].join(' ')}
                >
                  <div className="truncate text-[8px] font-bold uppercase tracking-wide text-slate-500 sm:text-[9px]">{item.label}</div>
                  <div className={`mt-1 text-base font-black tabular-nums sm:text-xl ${item.hitRate !== null && item.hitRate >= 60 ? 'text-emerald-400' : 'text-slate-200'}`}>
                    {item.hitRate === null ? '—' : `${item.hitRate}%`}
                  </div>
                  <div className="mt-1 truncate text-[8px] text-slate-500">Avg {item.average ?? '—'}</div>
                  <div className="truncate text-[8px] text-slate-600">{item.games ? `${item.hits}/${item.games}` : 'No sample'}</div>
                </button>
              ))}
            </div>
          ) : (
            <div className="grid min-h-[122px] place-items-center rounded-2xl border border-slate-800 bg-[#0d1420] px-4 text-center text-xs text-slate-500">
              {loading ? 'Loading verified history…' : research?.message || 'Verified history unavailable'}
            </div>
          )}
        </div>

        <section className="deep-dive-chart-section rounded-2xl border border-slate-800 bg-[#0d1420] p-3 sm:p-4" id="analysis-chart">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Flame className="h-4 w-4 text-orange-400" />
                <h2 className="text-sm font-black text-white sm:text-base">
                  {sample === 'season' ? 'Season Games' : sample === 'h2h' ? 'Head-to-Head Games' : `Last ${sample.slice(1)} Games`} – {marketLabel}
                </h2>
              </div>
              <p className="mt-1 text-[9px] text-slate-500">Current target: {state.line} · {periodLabel(group.period)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] font-semibold text-slate-400">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" />Over</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-500" />Under</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm border border-slate-500 bg-slate-800" />DNP</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-3 border-t border-dashed border-amber-400" />Prop line</span>
            </div>
          </div>
          {loading ? (
            <div className="grid min-h-[230px] place-items-center text-xs text-slate-500">Loading verified game history…</div>
          ) : research?.available === false ? (
            <div className="grid min-h-[230px] place-items-center px-5 text-center text-xs text-slate-500">
              {research.message || 'No verified game history is available for this prop.'}
            </div>
          ) : (
            <Chart games={chartGames} line={state.line} market={marketLabel} />
          )}
        </section>

        <section className="rounded-2xl border border-slate-800 bg-[#0d1420] p-3 sm:p-4">
          <div className="mb-3 text-[9px] font-black uppercase tracking-[.16em] text-slate-500">Supporting stats</div>
          <div className="grid grid-cols-4 overflow-hidden rounded-xl border border-slate-800">
            {supporting.map((stat, index) => (
              <div key={stat.label} className={`bg-slate-950/40 px-2 py-3 text-center ${index ? 'border-l border-slate-800' : ''}`}>
                <div className="truncate text-[8px] font-bold uppercase tracking-wide text-slate-500">{stat.label}</div>
                <div className="mt-1 text-base font-black tabular-nums text-white sm:text-lg">{stat.value}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-[#0d1420] p-3 sm:p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-black text-white">Sportsbook Prices</h3>
              <p className="mt-0.5 text-[9px] text-slate-500">Exact real quotes for posted line {group.line}</p>
            </div>
            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[8px] font-black text-emerald-300">
              {availableBooks.length} BOOK{availableBooks.length === 1 ? '' : 'S'}
            </span>
          </div>
          {availableBooks.length ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {availableBooks.map((book) => (
                <article
                  key={book.key}
                  className={`rounded-xl border p-2.5 ${book.key === state.book ? 'border-sky-500/40 bg-sky-500/[.06]' : 'border-slate-800 bg-slate-950/40'}`}
                >
                  <button
                    type="button"
                    onClick={() => onState({ ...state, book: book.key })}
                    className="flex w-full items-center justify-between gap-2 text-left"
                  >
                    <span className="truncate text-[10px] font-black text-white">{book.name}</span>
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[8px] font-black text-slate-400">{bookInitials(book.name)}</span>
                  </button>
                  <div className="mt-1 text-[8px] font-bold text-slate-600">Line {group.line}</div>
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      disabled={!book.over}
                      onClick={() => onState({ ...state, book: book.key, side: 'OVER' })}
                      className="rounded-lg border border-emerald-400/15 bg-emerald-400/[.06] px-2 py-2 text-left disabled:opacity-35"
                    >
                      <span className="block text-[7px] font-bold uppercase text-emerald-500/80">Over</span>
                      <strong className="mt-0.5 block text-xs font-black tabular-nums text-emerald-400">{odds(book.over?.price)}</strong>
                    </button>
                    <button
                      type="button"
                      disabled={!book.under}
                      onClick={() => onState({ ...state, book: book.key, side: 'UNDER' })}
                      className="rounded-lg border border-rose-400/15 bg-rose-400/[.06] px-2 py-2 text-left disabled:opacity-35"
                    >
                      <span className="block text-[7px] font-bold uppercase text-rose-500/80">Under</span>
                      <strong className="mt-0.5 block text-xs font-black tabular-nums text-rose-400">{odds(book.under?.price)}</strong>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500">No verified sportsbook quotes are available for this exact line.</p>
          )}
        </section>

        <button
          type="button"
          onClick={() => setShowFullResearch((value) => !value)}
          aria-expanded={showFullResearch}
          className="group flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 via-sky-500 to-cyan-500 text-sm font-black text-white shadow-[0_10px_32px_rgba(37,99,235,.22)] transition hover:brightness-110"
        >
          {showFullResearch ? 'Hide Full Research' : 'View Full Research'}
          <ArrowRight className={`h-4 w-4 transition-transform ${showFullResearch ? 'rotate-90' : 'group-hover:translate-x-1'}`} />
        </button>

        {showFullResearch ? (
          <div className="space-y-4 rounded-2xl border border-slate-800 bg-[#0d1420] p-3 sm:p-4">
            {fullResearch}
          </div>
        ) : null}
      </div>
    </section>
  );
}
