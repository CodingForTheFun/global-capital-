'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3, Bookmark, CalendarDays, ChevronDown, Search, Settings2, SlidersHorizontal, Swords, TriangleAlert, User, Users } from 'lucide-react';
import type { BoardMeta, PropGroup, ResearchWindow } from '@/lib/types';
import { ApiError, fetchAccount, fetchBoard, fetchResearch, windowOf } from '@/lib/api';
import { cn, marketDisplayLabel, pctValue } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PropCard, PropCardSkeleton, type PropCardStats } from '@/components/face-card';
import { Reveal } from '@/components/motion';
import { SignInPanel } from '@/components/sign-in';

const SPORTS = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'WNBA', 'SOCCER'];
const SORTS = [
  { id: 'hit', label: 'Hit rate' },
  { id: 'line', label: 'Line' },
  { id: 'name', label: 'A–Z' },
] as const;

type SortId = (typeof SORTS)[number]['id'];

const MOBILE_METRICS = [
  { id: 'line', label: 'Line' },
  { id: 'l5', label: 'L5' },
  { id: 'l10', label: 'L10' },
  { id: 'l15', label: 'L15' },
  { id: 'h2h', label: 'H2H' },
  { id: 'streak', label: 'Strk' },
] as const;

type HitWindowId = Exclude<(typeof MOBILE_METRICS)[number]['id'], 'line'>;
type ResearchMetrics = {
  l5: PropCardStats;
  l10: PropCardStats;
  l15: PropCardStats;
  h2h: PropCardStats;
  streak: number | null;
};

const asCardStats = (window: ResearchWindow | null | undefined): PropCardStats => {
  if (!window) return null;
  const rate = pctValue(window.hitRate ?? null);
  const hits = window.hits ?? null;
  const sample = window.sampleSize ?? window.games ?? null;
  return rate === null && hits === null ? null : { hits, sample, rate };
};

const quoteModifier = (quote: {
  specialType?: string;
  dfsOddsType?: string;
  payoutMultiplier?: number | string;
}) => {
  const named = String(quote.specialType || quote.dfsOddsType || '').trim();
  if (named) return named;
  const multiplier = Number(quote.payoutMultiplier);
  return Number.isFinite(multiplier) && multiplier > 0 ? `${multiplier}x` : '';
};

const dateKey = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

const dateLabel = (value: string) => {
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
};

const compactBookLabel = (value: string) =>
  value
    .split(/\s+/)
    .map((part) => part[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase();

/** Enough cards to fill a tall screen without asking the research route for
 * hundreds of histories nobody scrolled to. */
const PAGE_SIZE = 24;
const ALL = 'ALL';
const AUTO_REFRESH_MS = 15_000;

const bookName = (value: unknown) => String(value || '').trim();
const sortedUnique = (values: Array<string | null | undefined>) =>
  [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
// Release marker: the Stat selector intentionally displays normalized stat categories only.
const statCategory = (group: PropGroup) =>
  marketDisplayLabel(group.market, group.player, group.marketId, group.sport);

export function BoardView() {
  const router = useRouter();
  const [account, setAccount] = React.useState<{ id: string; email?: string } | null>(null);
  const [checking, setChecking] = React.useState(true);

  const [sport, setSport] = React.useState('NFL');
  const [groups, setGroups] = React.useState<PropGroup[]>([]);
  const [meta, setMeta] = React.useState<BoardMeta>({});
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [nonce, setNonce] = React.useState(0);

  const [query, setQuery] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [sort, setSort] = React.useState<SortId>('line');
  const [hitWindow, setHitWindow] = React.useState<HitWindowId>('l10');
  const [shown, setShown] = React.useState(PAGE_SIZE);
  const [picks, setPicks] = React.useState<Record<string, 'OVER' | 'UNDER'>>({});
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [marketFilter, setMarketFilter] = React.useState(ALL);
  const [teamFilter, setTeamFilter] = React.useState(ALL);
  const [opponentFilter, setOpponentFilter] = React.useState(ALL);
  const [bookFilter, setBookFilter] = React.useState(ALL);
  const [gameFilter, setGameFilter] = React.useState(ALL);
  const [dateFilter, setDateFilter] = React.useState(ALL);
  const [modifierFilter, setModifierFilter] = React.useState(ALL);
  const [picksOnly, setPicksOnly] = React.useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = React.useState(false);
  const [sportMenuOpen, setSportMenuOpen] = React.useState(false);

  /** Hit rates arrive per card from the research route, so the board renders
   * immediately and each card fills in as its history lands. */
  const [stats, setStats] = React.useState<Record<string, PropCardStats>>({});
  const [metricStats, setMetricStats] = React.useState<Record<string, ResearchMetrics>>({});

  React.useEffect(() => {
    const controller = new AbortController();
    fetchAccount(controller.signal)
      .then(setAccount)
      .finally(() => setChecking(false));
    return () => controller.abort();
  }, []);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim().toLowerCase()), 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  React.useEffect(() => {
    if (checking || !account) return;

    let cancelled = false;
    let activeController: AbortController | null = null;

    const loadBoard = async (initial: boolean) => {
      if (activeController) return;
      const controller = new AbortController();
      activeController = controller;
      const timeout = window.setTimeout(() => controller.abort(), 20000);

      if (initial) {
        setLoading(true);
        setError('');
      }

      try {
        const board = await fetchBoard(sport, controller.signal);
        if (cancelled) return;

        setGroups(board.groups);
        setMeta(board.meta);
        setError('');

        if (initial) {
          setShown(PAGE_SIZE);
          setMarketFilter(ALL);
          setTeamFilter(ALL);
          setOpponentFilter(ALL);
          setBookFilter(ALL);
          setGameFilter(ALL);
          setDateFilter(ALL);
          setModifierFilter(ALL);
          setPicksOnly(false);
          setSportMenuOpen(false);
        }
      } catch (cause: unknown) {
        if (cancelled) return;
        if (cause instanceof ApiError && cause.status === 401) {
          setAccount(null);
          return;
        }
        if (initial) {
          setError(
            controller.signal.aborted
              ? 'The prop board took too long to respond. Try again.'
              : cause instanceof Error
                ? cause.message
                : 'The live prop board is unavailable.',
          );
        }
      } finally {
        window.clearTimeout(timeout);
        if (activeController === controller) activeController = null;
        if (!cancelled && initial) setLoading(false);
      }
    };

    void loadBoard(true);

    const refreshVisibleBoard = () => {
      if (document.visibilityState === 'visible') void loadBoard(false);
    };
    const interval = window.setInterval(refreshVisibleBoard, AUTO_REFRESH_MS);
    document.addEventListener('visibilitychange', refreshVisibleBoard);

    return () => {
      cancelled = true;
      activeController?.abort();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshVisibleBoard);
    };
  }, [checking, account, sport, nonce]);

  const filterOptions = React.useMemo(() => {
    const books: string[] = [];
    for (const group of groups) {
      for (const quote of group.quotes) {
        const value = bookName(quote.sportsbook || quote.sportsbookKey);
        if (value) books.push(value);
      }
    }
    return {
      markets: sortedUnique(groups.map(statCategory)),
      teams: sortedUnique(groups.map((group) => group.team)),
      opponents: sortedUnique(groups.map((group) => group.opponent)),
      games: sortedUnique(groups.map((group) => group.matchup)),
      dates: sortedUnique(groups.map((group) => dateKey(group.startsAt))),
      modifiers: sortedUnique(
        groups.flatMap((group) => group.quotes.map((quote) => quoteModifier(quote))),
      ),
      books: sortedUnique(books),
    };
  }, [groups]);

  const activeFilterCount =
    [marketFilter, teamFilter, opponentFilter, bookFilter, gameFilter, dateFilter, modifierFilter].filter(
      (value) => value !== ALL,
    ).length + (picksOnly ? 1 : 0);

  const visible = React.useMemo(() => {
    const filtered = groups.filter((group) => {
      if (debounced && !`${group.player} ${group.market} ${statCategory(group)} ${group.matchup}`.toLowerCase().includes(debounced)) return false;
      if (marketFilter !== ALL && statCategory(group) !== marketFilter) return false;
      if (teamFilter !== ALL && group.team !== teamFilter) return false;
      if (opponentFilter !== ALL && group.opponent !== opponentFilter) return false;
      if (gameFilter !== ALL && group.matchup !== gameFilter) return false;
      if (dateFilter !== ALL && dateKey(group.startsAt) !== dateFilter) return false;
      if (
        modifierFilter !== ALL &&
        !group.quotes.some((quote) => quoteModifier(quote) === modifierFilter)
      ) return false;
      if (
        bookFilter !== ALL &&
        !group.quotes.some((quote) => bookName(quote.sportsbook || quote.sportsbookKey) === bookFilter)
      ) return false;
      if (picksOnly && !picks[group.key]) return false;
      return true;
    });
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sort === 'name') return a.player.localeCompare(b.player);
      if (sort === 'line') return b.line - a.line;
      const metricScore = (groupKey: string) => {
        const metric = metricStats[groupKey];
        if (!metric) return -1;
        if (hitWindow === 'streak') return metric.streak ?? -1;
        return metric[hitWindow]?.rate ?? -1;
      };
      const ra = metricScore(a.key);
      const rb = metricScore(b.key);
      return rb - ra || a.player.localeCompare(b.player);
    });
    return sorted;
  }, [groups, debounced, sort, hitWindow, metricStats, marketFilter, teamFilter, opponentFilter, bookFilter, gameFilter, dateFilter, modifierFilter, picksOnly, picks]);

  const page = visible.slice(0, shown);

  const requested = React.useRef(new Set<string>());
  const inflight = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    inflight.current = controller;
    return () => {
      controller.abort();
      inflight.current = null;
    };
  }, []);

  React.useEffect(() => {
    requested.current = new Set();
    setStats({});
    setMetricStats({});
  }, [sport]);

  const pageKeys = page.map((group) => group.key).join('|');

  React.useEffect(() => {
    const controller = inflight.current;
    if (!controller) return;
    const wanted = page.filter((group) => !requested.current.has(group.key));
    if (!wanted.length) return;
    for (const group of wanted) requested.current.add(group.key);

    const queue = [...wanted];
    const worker = async () => {
      while (queue.length && !controller.signal.aborted) {
        const group = queue.shift()!;
        try {
          const research = await fetchResearch(group, 'OVER', controller.signal);
          const l5 = asCardStats(windowOf(research, 'last5', 'l5', 'lastFive'));
          const l10 = asCardStats(windowOf(research, 'last10', 'l10', 'lastTen'));
          const l15 = asCardStats(windowOf(research, 'last15', 'l15', 'lastFifteen'));
          const h2h = asCardStats(research.h2h);
          const rawStreak =
            typeof research.streak === 'number' ? research.streak : Number(research.streak?.count);
          const streak = Number.isFinite(rawStreak) ? rawStreak : null;
          if (controller.signal.aborted) return;
          setStats((prev) => ({ ...prev, [group.key]: l10 }));
          setMetricStats((prev) => ({
            ...prev,
            [group.key]: { l5, l10, l15, h2h, streak },
          }));
        } catch {
          if (!controller.signal.aborted) {
            setStats((prev) => ({ ...prev, [group.key]: null }));
            setMetricStats((prev) => ({
              ...prev,
              [group.key]: { l5: null, l10: null, l15: null, h2h: null, streak: null },
            }));
          }
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, wanted.length) }, worker));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKeys]);

  function openPlayer(group: PropGroup) {
    const params = new URLSearchParams({
      sport: group.sport,
      player: group.player,
      market: group.market,
      line: String(group.line),
    });
    router.push(`/research?${params}`);
  }

  function resetFilters() {
    setMarketFilter(ALL);
    setTeamFilter(ALL);
    setOpponentFilter(ALL);
    setBookFilter(ALL);
    setGameFilter(ALL);
    setDateFilter(ALL);
    setModifierFilter(ALL);
    setPicksOnly(false);
  }

  if (checking) {
    return (
      <div className="board-loading-shell mx-auto w-full max-w-[var(--maxw)] px-3 py-4 sm:px-4 md:px-8">
        <div className="board-grid grid gap-2.5 [&>*]:min-w-0 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <PropCardSkeleton key={index} />
          ))}
        </div>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="mx-auto w-full max-w-[var(--maxw)] px-4 py-10 md:px-8">
        <SignInPanel onSignedIn={setAccount} />
      </div>
    );
  }

  return (
    <div className="board-shell mx-auto w-full max-w-[var(--maxw)] px-3 pt-2 pb-16 sm:px-4 md:px-6 md:pt-5 lg:px-8">
      <div className="board-summary mb-2.5 hidden items-end justify-between gap-3 md:mb-4 md:flex">
        <div className="board-summary__title min-w-0">
          <div className="board-kicker">Live player prop research</div>
          <h1 className="text-[length:var(--fs-xl)]" style={{ textTransform: 'var(--display-case)' as 'none' }}>
            Props
          </h1>
        </div>
        <p className="board-summary__meta shrink-0 text-right text-[length:var(--fs-xs)] text-[var(--text-3)] md:text-[length:var(--fs-sm)]">
          {loading
            ? 'Loading live board…'
            : `${visible.length.toLocaleString()} props${meta.sportsbookCount ? ` · ${meta.sportsbookCount} books` : ''}`}
        </p>
      </div>

      {meta.stale && (
        <p className="board-stale mb-2.5 flex items-center gap-2 rounded-[10px] border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--warn)_8%,transparent)] px-3 py-2 text-[length:var(--fs-xs)] text-[var(--warn)] md:mb-4 md:text-[length:var(--fs-sm)]">
          <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
          Live feed temporarily delayed. Showing the latest available prices.
        </p>
      )}

      <div className="board-toolbar sticky top-14 z-20 grid gap-1.5 border-y border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_94%,transparent)] py-1.5 backdrop-blur-xl md:top-16 md:gap-2 md:rounded-[14px] md:border md:px-2.5 md:py-2.5">
        <div className="board-mobile-controls md:hidden">
          <div className="board-mobile-context-row">
            <div className="board-mobile-context">
              <span className="board-mobile-context__mark" aria-hidden="true">▥</span>
              <strong>Props</strong>
              <span className="board-mobile-context__slash">/</span>
              <button
                type="button"
                className="board-mobile-sport-button"
                aria-expanded={sportMenuOpen}
                onClick={() => setSportMenuOpen((open) => !open)}
              >
                {SPORTS.length} SPORTS
                <ChevronDown className="size-4" aria-hidden="true" />
              </button>
            </div>
            <button
              type="button"
              className="board-mobile-profile-button"
              aria-label="Open account"
              onClick={() => router.push('/account')}
            >
              <User className="size-6" aria-hidden="true" />
            </button>
          </div>

          {sportMenuOpen && (
            <div className="board-mobile-sports-rail" role="group" aria-label="Choose sport">
              {SPORTS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={option === sport}
                  onClick={() => {
                    setSport(option);
                    setSportMenuOpen(false);
                  }}
                >
                  {option}
                </button>
              ))}
            </div>
          )}

          <div className="board-mobile-app-row">
            <label className="board-mobile-app-select">
              <span className="board-mobile-app-title">Apps</span>
              <span className="board-mobile-book-badges" aria-hidden="true">
                {filterOptions.books.slice(0, 3).map((book, index) => (
                  <span key={book} data-index={index}>{compactBookLabel(book)}</span>
                ))}
              </span>
              {filterOptions.books.length > 3 && (
                <span className="board-mobile-more-books">+ {filterOptions.books.length - 3}</span>
              )}
              <ChevronDown className="size-4" aria-hidden="true" />
              <select
                aria-label="Filter by app or sportsbook"
                value={bookFilter}
                onChange={(event) => setBookFilter(event.target.value)}
              >
                <option value={ALL}>All apps</option>
                {filterOptions.books.map((book) => (
                  <option key={book} value={book}>{book}</option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className="board-mobile-square-button"
              aria-label={mobileSearchOpen ? 'Close search' : 'Search props'}
              aria-pressed={mobileSearchOpen}
              onClick={() => setMobileSearchOpen((open) => !open)}
            >
              <Search className="size-6" aria-hidden="true" />
            </button>

            <button
              type="button"
              className="board-mobile-square-button"
              aria-label={picksOnly ? 'Show all props' : 'Show selected props'}
              aria-pressed={picksOnly}
              onClick={() => setPicksOnly((value) => !value)}
            >
              <Bookmark className="size-5" aria-hidden="true" />
            </button>
          </div>

          {mobileSearchOpen && (
            <label className="board-mobile-search">
              <Search className="size-4" aria-hidden="true" />
              <span className="sr-only">Search players, teams, or props</span>
              <Input
                autoFocus
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search players, teams, or props…"
                autoComplete="off"
              />
            </label>
          )}

          <div className="board-mobile-filter-rail" aria-label="Prop filters">
            <CompactFilterSelect
              icon={<Users className="size-5" aria-hidden="true" />}
              label="Teams"
              value={teamFilter}
              onChange={setTeamFilter}
              options={filterOptions.teams}
            />
            <CompactFilterSelect
              icon={<Swords className="size-5" aria-hidden="true" />}
              label="Opponent"
              value={opponentFilter}
              onChange={setOpponentFilter}
              options={filterOptions.opponents}
            />
            <CompactFilterSelect
              icon={<BarChart3 className="size-5" aria-hidden="true" />}
              label="Stat"
              value={marketFilter}
              onChange={setMarketFilter}
              options={filterOptions.markets}
            />
            <CompactFilterSelect
              icon={<Swords className="size-5" aria-hidden="true" />}
              label="Games"
              value={gameFilter}
              onChange={setGameFilter}
              options={filterOptions.games}
            />
            <CompactFilterSelect
              icon={<CalendarDays className="size-5" aria-hidden="true" />}
              label="Date"
              value={dateFilter}
              onChange={setDateFilter}
              options={filterOptions.dates}
              formatOption={dateLabel}
            />
            <CompactFilterSelect
              icon={<Settings2 className="size-5" aria-hidden="true" />}
              label="Modifier"
              value={modifierFilter}
              onChange={setModifierFilter}
              options={filterOptions.modifiers}
            />
            <CompactFilterSelect
              icon={<SlidersHorizontal className="size-5" aria-hidden="true" />}
              label="Apps"
              value={bookFilter}
              onChange={setBookFilter}
              options={filterOptions.books}
            />
          </div>

          <div className="board-mobile-metric-rail" role="group" aria-label="Sort props">
            {MOBILE_METRICS.map((option) => {
              const active =
                option.id === 'line'
                  ? sort === 'line'
                  : sort === 'hit' && hitWindow === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    if (option.id === 'line') {
                      setSort('line');
                      return;
                    }
                    setHitWindow(option.id);
                    setSort('hit');
                  }}
                >
                  <span>{option.label}</span>
                  {active && activeFilterCount > 0 && (
                    <span className="board-mobile-metric-count">{activeFilterCount}</span>
                  )}
                  <span className="board-mobile-sort-glyph" aria-hidden="true">↧</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="board-desktop-toolbar hidden md:grid md:gap-2">
          <div className="board-leagues rail" role="group" aria-label="League">
          {SPORTS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === sport}
              onClick={() => setSport(option)}
              className={cn(
                'flex-none min-h-8 rounded-[8px] border px-2.5 text-[11px] font-semibold md:min-h-9 md:rounded-[9px] md:px-3 md:text-[length:var(--fs-xs)]',
                'transition-[color,background-color,border-color,transform] duration-150 ease-[var(--ease-out)] active:scale-[.97]',
                option === sport
                  ? 'border-[color-mix(in_srgb,var(--accent)_48%,transparent)] bg-[color-mix(in_srgb,var(--accent)_13%,var(--surface))] text-[var(--text)]'
                  : 'border-[var(--line)] bg-[var(--surface)] text-[var(--text-2)] hover:border-[var(--line-strong)] hover:text-[var(--text)]',
              )}
            >
              {option}
            </button>
          ))}
        </div>

        <div className="board-control-row flex items-center gap-1.5">
          <label className="board-search relative flex min-w-0 flex-1 items-center">
            <Search
              className="pointer-events-none absolute left-2.5 size-3.5 text-[var(--text-3)] md:left-3 md:size-4"
              aria-hidden="true"
            />
            <span className="sr-only">Search players or markets</span>
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search players, teams…"
              autoComplete="off"
              className="h-9 min-h-9 rounded-[9px] pl-8 text-xs md:h-10 md:min-h-10 md:rounded-[10px] md:pl-9"
            />
          </label>

          <button
            type="button"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((open) => !open)}
            className={cn(
              'board-filter-trigger inline-flex h-9 min-h-9 flex-none items-center gap-1.5 rounded-[9px] border px-2.5 text-[11px] font-semibold md:h-10 md:min-h-10 md:px-3 md:text-[length:var(--fs-xs)]',
              activeFilterCount
                ? 'border-[color-mix(in_srgb,var(--accent)_45%,transparent)] text-[var(--accent)]'
                : 'border-[var(--line)] text-[var(--text-2)]',
            )}
          >
            <SlidersHorizontal className="size-3.5 md:size-4" aria-hidden="true" />
            <span>Filters{activeFilterCount ? ` ${activeFilterCount}` : ''}</span>
          </button>

          <div className="board-sort-pills hidden items-center gap-1.5 md:flex" aria-label="Sort props">
            {SORTS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={option.id === sort}
                onClick={() => setSort(option.id)}
                className={cn(
                  'min-h-10 flex-none rounded-[9px] border px-3 text-[length:var(--fs-xs)] font-semibold transition-colors duration-150',
                  option.id === sort
                    ? 'border-[color-mix(in_srgb,var(--accent)_44%,transparent)] bg-[color-mix(in_srgb,var(--accent)_12%,var(--surface))] text-[var(--text)]'
                    : 'border-[var(--line)] bg-[var(--surface)] text-[var(--text-2)] hover:border-[var(--line-strong)] hover:text-[var(--text)]',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {filtersOpen && (
          <div className="board-filter-panel" aria-label="Advanced prop filters">
            <label className="board-filter-field board-filter-sort md:hidden">
              <span>Sort</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as SortId)}>
                {SORTS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <FilterSelect label="Stat" value={marketFilter} onChange={setMarketFilter} options={filterOptions.markets} />
            <FilterSelect label="Team" value={teamFilter} onChange={setTeamFilter} options={filterOptions.teams} />
            <FilterSelect label="Opponent" value={opponentFilter} onChange={setOpponentFilter} options={filterOptions.opponents} />
            <FilterSelect label="Game" value={gameFilter} onChange={setGameFilter} options={filterOptions.games} />
            <FilterSelect label="Date" value={dateFilter} onChange={setDateFilter} options={filterOptions.dates} formatOption={dateLabel} />
            <FilterSelect label="Modifier" value={modifierFilter} onChange={setModifierFilter} options={filterOptions.modifiers} />
            <FilterSelect label="Sportsbook" value={bookFilter} onChange={setBookFilter} options={filterOptions.books} />
            <button type="button" onClick={resetFilters} disabled={!activeFilterCount} className="board-filter-reset">
              Reset filters
            </button>
          </div>
        )}
        </div>
      </div>

      {error ? (
        <div className="grid justify-items-center gap-3 py-16 text-center">
          <TriangleAlert className="size-7 text-[var(--warn)]" aria-hidden="true" />
          <h2 className="text-[length:var(--fs-md)] normal-case">{error}</h2>
          <Button variant="ghost" size="sm" onClick={() => setNonce((value) => value + 1)}>
            Try again
          </Button>
        </div>
      ) : loading && !groups.length ? (
        <div className="board-grid mt-2.5 grid gap-2.5 [&>*]:min-w-0 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 md:mt-4 md:gap-3">
          {Array.from({ length: 8 }).map((_, index) => (
            <PropCardSkeleton key={index} />
          ))}
        </div>
      ) : !visible.length ? (
        <div className="grid justify-items-center gap-3 py-16 text-center">
          <Search className="size-7 text-[var(--text-3)]" aria-hidden="true" />
          <h2 className="text-[length:var(--fs-md)] normal-case">No props match that filter</h2>
          <p className="max-w-[46ch] text-[length:var(--fs-sm)] text-[var(--text-3)]">
            Try a different league or clear the filters to see everything {sport} has priced.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuery('');
              setSort('line');
              setHitWindow('l10');
              resetFilters();
            }}
          >
            Clear filters
          </Button>
        </div>
      ) : (
        <>
          <div className="board-grid mt-2.5 grid gap-2.5 [&>*]:min-w-0 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 md:mt-4 md:gap-3">
            {page.map((group, index) => (
              <Reveal key={group.key} delay={Math.min(index * 30, 210)}>
                <PropCard
                  group={group}
                  stats={stats[group.key] ?? null}
                  loading={!(group.key in stats)}
                  onOpen={openPlayer}
                  onPick={(picked, side) =>
                    setPicks((prev) => ({
                      ...prev,
                      [picked.key]: prev[picked.key] === side ? undefined! : side,
                    }))
                  }
                  picked={picks[group.key] ?? null}
                  delay={Math.min(index * 30, 210)}
                />
              </Reveal>
            ))}
          </div>

          {shown < visible.length && (
            <div className="mt-6 grid justify-items-center gap-2 md:mt-8">
              <Button variant="ghost" onClick={() => setShown((value) => value + PAGE_SIZE)}>
                Show {Math.min(PAGE_SIZE, visible.length - shown)} more
              </Button>
              <span className="text-[length:var(--fs-xs)] text-[var(--text-3)]">
                {shown.toLocaleString()} of {visible.length.toLocaleString()}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  formatOption = (option) => option,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  formatOption?: (option: string) => string;
}) {
  return (
    <label className="board-filter-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value={ALL}>All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {formatOption(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function CompactFilterSelect({
  icon,
  label,
  value,
  onChange,
  options,
  formatOption = (option) => option,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  formatOption?: (option: string) => string;
}) {
  const currentLabel = value === ALL ? label : formatOption(value);
  return (
    <label className="board-mobile-filter-pill" data-active={value !== ALL ? 'true' : 'false'}>
      {icon}
      <span title={currentLabel}>{currentLabel}</span>
      <ChevronDown className="size-4" aria-hidden="true" />
      <select
        aria-label={`Filter by ${label}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value={ALL}>{label}</option>
        {options.map((option) => (
          <option key={option} value={option}>{formatOption(option)}</option>
        ))}
      </select>
    </label>
  );
}
