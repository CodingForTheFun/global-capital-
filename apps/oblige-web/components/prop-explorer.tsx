'use client';

import * as React from 'react';
import { Minus, Plus, Star, RotateCcw } from 'lucide-react';
import type { GameLogRow, PropGroup, PropRow, ResearchResponse } from '@/lib/types';
import { catalogBookRows } from '@/lib/book-catalog';
import { applyFilters, buildWindows, computeWindow, distinct, EMPTY_FILTERS, filtersActive, headToHead, sampleFor, sortRecentFirst, type SampleFilters, type SampleId, type Side, type Window as ResearchWindow } from '@/lib/analytics';
import { marketDisplayLabel, odds, shortDate } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { AppliedFilter } from '@/components/applied-filter';
import { buildOpponentOptions, sameTeamLabel } from '@/lib/opponent-options';

export type ExplorerState = { line: number; side: Side; book: string | null };
type ChartSample = SampleId | 'l20';
const numberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || typeof value === 'boolean' || String(value).trim() === '') return null;
  const number = Number(value); return Number.isFinite(number) ? number : null;
};

function SampleTile({ window: item, selected, onSelect }: { window: ResearchWindow; selected: boolean; onSelect(): void }) {
  return <button type="button" className="op-sample" aria-pressed={selected} onClick={onSelect}>
    <span>{item.label === 'All' ? 'Available' : item.label}</span>
    <strong data-tone={item.hitRate === null ? 'none' : item.hitRate >= 60 ? 'positive' : item.hitRate < 45 ? 'negative' : 'neutral'}>{item.hitRate === null ? '—' : `${item.hitRate}%`}</strong>
    <span>Avg {item.average ?? '—'}</span><small>{item.games} games</small>
  </button>;
}

function ValueChart({ games, line, side }: { games: GameLogRow[]; line: number; side: Side }) {
  const shown = [...games].reverse();
  if (!shown.length) return <p className="op-no-history">No verified games match these filters. Clear an individual filter to broaden the sample.</p>;
  const ceiling = Math.max(1, line, ...shown.map(game => Number(game.value))) * 1.22;
  return <div className="op-chart-scroll" tabIndex={0} role="region" aria-label="Recent game results chart; scroll horizontally for longer samples">
    <div className="op-chart-content" style={{ minWidth: Math.max(260, shown.length * 21) }}>
      <div className="op-chart-plot" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}>
        <div className="op-chart-threshold" style={{ bottom: `${line / ceiling * 100}%` }}><span>{line}</span></div>
        {shown.map((game, index) => {
          const value = Number(game.value);
          const push = value === line;
          const hit = !push && (side === 'UNDER' ? value < line : value > line);
          const percent = Math.max(1.2, value / ceiling * 100);
          return <div key={`${game.gameId || game.date}-${index}`} className="op-chart-column" title={`${shortDate(game.date)} ${game.isHome === false ? '@' : ''}${game.opponent || 'Opponent unavailable'}: ${value} — ${push ? 'Push' : hit ? 'Hit' : 'Miss'}`}>
            <span className="op-chart-number" style={{ bottom: `${percent}%` }}>{value}</span>
            <span className="op-chart-bar" data-result={push ? 'push' : hit ? 'hit' : 'miss'} style={{ height: `${percent}%` }} />
          </div>;
        })}
      </div>
      <div className="op-chart-labels" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}>{shown.map((game, index) => <span key={`${game.gameId || game.date}-${index}`}><span>{shortDate(game.date)}</span><strong>{game.isHome === false ? '@' : ''}{game.opponent || '—'}</strong></span>)}</div>
    </div>
  </div>;
}

/** Same input/output contract and existing research engine. No fetch, provider
 * polling, auth change or new data source is introduced by these controls. */
export function PropExplorer({ group, games, loading, unavailableReason, leagueTeams = [], state, onState, favourite, onFavourite }: {
  group: PropGroup; games: GameLogRow[]; loading?: boolean; unavailableReason?: string | null;
  leagueTeams?: NonNullable<ResearchResponse['leagueTeams']>;
  state: ExplorerState; onState(next: ExplorerState): void; favourite: boolean; onFavourite(): void;
}) {
  const [filters, setFilters] = React.useState<SampleFilters>(EMPTY_FILTERS);
  const [sample, setSample] = React.useState<ChartSample>('l15');
  React.useEffect(() => { setFilters(EMPTY_FILTERS); setSample('l15'); }, [group.key]);
  // Number(null) is 0. Explicitly exclude missing/DNP values before calling
  // any historic engine helper; they must never become invented zeroes.
  const played = React.useMemo(() => unavailableReason ? [] : sortRecentFirst(games.filter(game => numberOrNull(game.value) !== null).map(game => ({ ...game, value: numberOrNull(game.value) }))), [games, unavailableReason]);
  const filtered = React.useMemo(() => applyFilters(played, filters), [played, filters]);
  const windows = React.useMemo(() => {
    const result = buildWindows(filtered, state.line, state.side);
    result.splice(3, 0, computeWindow(filtered, state.line, state.side, 'l20', 'L20', 20));
    return result;
  }, [filtered, state.line, state.side]);
  const h2h = React.useMemo(() => headToHead(filtered, group.opponent, state.line, state.side), [filtered, group.opponent, state.line, state.side]);
  const chartGames = React.useMemo(() => sample === 'l20' ? filtered.slice(0, 20) : sampleFor(filtered, sample, group.opponent), [filtered, sample, group.opponent]);
  const summary = React.useMemo(() => computeWindow(chartGames, state.line, state.side, 'chart', 'Shown'), [chartGames, state.line, state.side]);
  const opponentOptions = React.useMemo(
    () => buildOpponentOptions(played.map(game => game.opponent), group, leagueTeams),
    [played, group.team, group.opponent, group.homeTeam, group.awayTeam, leagueTeams],
  );
  // A research response can replace a pre-load full team name with the exact
  // historical abbreviation used by the game log. Keep an already-selected
  // opponent attached to its equivalent option instead of silently showing All.
  React.useEffect(() => {
    const selected = filters.opponent;
    if (!selected || selected === 'all' || opponentOptions.some(option => option.value === selected)) return;
    const equivalent = opponentOptions.find(
      option =>
        sameTeamLabel(option.value, selected) ||
        sameTeamLabel(option.label.replace(/\s+★$/, ''), selected),
    );
    if (!equivalent) return;
    setFilters(previous =>
      previous.opponent === selected ? { ...previous, opponent: equivalent.value } : previous,
    );
  }, [filters.opponent, opponentOptions]);
  const seasons = React.useMemo(() => distinct(played.map(game => game.season == null ? null : String(game.season))).sort().reverse(), [played]);
  // Every supported book remains visible for every prop. Missing exact lines are
  // explicit instead of disappearing, while observed future books are retained.
  const books = React.useMemo(() => catalogBookRows(group.quotes), [group.quotes]);
  const activeBook = books.find(book => book.key === state.book);
  const over = activeBook ? activeBook.over : group.bestOver;
  const under = activeBook ? activeBook.under : group.bestUnder;
  const moved = Math.abs(state.line - group.line) > .001;
  const quoteOdds = (quote: PropRow | null | undefined) => numberOrNull(quote?.price) === null || Number(quote?.price) === 0 ? '—' : odds(quote?.price);
  const seasonOptions = [{ value: 'all', label: 'All years' }, ...seasons.map(value => ({ value, label: value }))];
  function step(amount: number) { onState({ ...state, line: Math.max(0, Math.round((state.line + amount) * 100) / 100) }); }

  return <div className="research-reference" data-release="oblige-installable-20260918">
    <div className="op-research-title"><div><span>PLAYER RESEARCH</span><h3>{marketDisplayLabel(group.market, group.player, group.marketId, group.sport)}</h3></div><button type="button" className="op-follow" aria-label={favourite ? `Unfollow ${group.player}` : `Follow ${group.player}`} aria-pressed={favourite} onClick={onFavourite} title="Follow on this device"><Star size={19} fill={favourite ? 'currentColor' : 'none'} /></button></div>
    <div className="op-research-filters">
      <AppliedFilter key={`${group.key}-opponent`} label="Opponent" value={filters.opponent} options={opponentOptions} onApply={opponent => setFilters(previous => ({ ...previous, opponent }))} />
      <AppliedFilter key={`${group.key}-season`} label="Season" value={filters.season} options={seasonOptions} onApply={season => setFilters(previous => ({ ...previous, season }))} />
      <AppliedFilter key={`${group.key}-venue`} label="Home / Away" value={filters.venue} options={[{ value: 'all', label: 'All' }, { value: 'home', label: 'Home' }, { value: 'away', label: 'Away' }]} onApply={venue => setFilters(previous => ({ ...previous, venue: venue as SampleFilters['venue'] }))} />
      <AppliedFilter key={`${group.key}-book`} label="Book" value={state.book || 'all'} options={[{ value: 'all', label: 'Best prices · all books' }, ...books.map(book => ({ value: book.key, label: book.available ? `${book.name} · Line ${group.line}` : `${book.name} · No line` }))]} onApply={book => onState({ ...state, book: book === 'all' ? null : book })} />
    </div>
    <div className="op-sample-caption"><span className="op-sample-count">{filtered.length} of {played.length} verified games</span>{filtersActive(filters) && <button type="button" onClick={() => setFilters(EMPTY_FILTERS)}><RotateCcw size={12} /> Clear all history filters</button>}</div>
    <div className="op-line-controls">
      <div className="op-line-stepper"><button type="button" aria-label="Lower research line" onClick={() => step(-.5)}><Minus size={18} /></button><output className="op-line-number" aria-live="polite">{state.line}</output><button type="button" aria-label="Raise research line" onClick={() => step(.5)}><Plus size={18} /></button></div>
      <div className="op-side-picker" role="group" aria-label="Research side">{(['OVER', 'UNDER'] as const).map(side => <button key={side} type="button" aria-pressed={state.side === side} data-side={side} onClick={() => onState({ ...state, side })}><strong>{side === 'OVER' ? 'O' : 'U'} {quoteOdds(side === 'OVER' ? over : under)}</strong><span>{side === 'OVER' ? 'Over' : 'Under'}</span></button>)}</div>
    </div>
    <p className="op-price-note">{activeBook ? (activeBook.available ? `${activeBook.name} · Prices shown at posted line ${group.line}.` : `${activeBook.name} · No line posted for this exact prop.`) : `Best available book prices · Posted line ${group.line}.`}{moved && <> Research line adjusted to {state.line}. <button type="button" onClick={() => onState({ ...state, line: group.line })}>Reset line</button></>}</p>
    {loading ? <Skeleton className="h-[90px]" /> : <div className="op-samples" aria-label="History windows">{windows.map(item => <SampleTile key={item.id} window={item} selected={sample === item.id} onSelect={() => setSample(item.id as ChartSample)} />)}{h2h && <SampleTile window={{ ...h2h, label: `H2H · ${group.opponent}` }} selected={sample === 'h2h'} onSelect={() => setSample('h2h')} />}</div>}
    {loading ? <Skeleton className="h-[230px]" /> : unavailableReason ? <div className="op-no-history"><strong>Verified history unavailable</strong><p>{unavailableReason}</p></div> : <section className="op-chart-section"><div className="op-chart-heading"><h4>{sample === 'h2h' ? `Head to head · ${group.opponent}` : sample === 'season' ? 'Available history' : `Last ${sample.slice(1)} games`} · {marketDisplayLabel(group.market, group.player, group.marketId, group.sport)}</h4><span>{summary.hits}/{summary.games} hits · {summary.hitRate ?? '—'}{summary.hitRate === null ? '' : '%'} · Avg {summary.average ?? '—'}</span></div><div className="op-chart-legend"><span>Hit</span><span>Miss</span><span>Push</span><span>— Research line</span></div><ValueChart games={chartGames} line={state.line} side={state.side} /></section>}
    <p className="op-research-footnote">Rates use verified games played. Pushes remain in the denominator. Missing/DNP values are excluded. “Available” describes the returned sample, not a claim of complete season coverage.</p>
  </div>;
}
