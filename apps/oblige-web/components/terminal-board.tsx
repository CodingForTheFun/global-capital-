'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  BarChart3,
  BookOpen,
  CalendarDays,
  CircleDollarSign,
  Layers3,
  Search,
  SlidersHorizontal,
  Sparkles,
  Users,
  X,
  Zap,
} from 'lucide-react';
import type { BoardMeta, PropGroup, PropRow, ResearchResponse, Side } from '@/lib/types';
import {
  ApiError,
  artworkUrl,
  fetchAccount,
  fetchBoard,
  fetchMovement,
  fetchResearchBatch,
  movementKey,
  streakOf,
  windowOf,
  type MovementRow,
} from '@/lib/api';
import { marketDisplayLabel, pctValue } from '@/lib/utils';
import { marketArbitrage } from '@/lib/arbitrage.mjs';
import {
  expectedValueFor,
  expectedValueSourceLabel,
  marketOverProbability,
  type ExpectedValueSelection,
} from '@/lib/expected-value.mjs';
import { uniqueTerminalPlayerCards } from '@/lib/terminal-player-cards.mjs';
import { createResearchQueue, reasonText, type ResearchQueue } from '@/lib/research-queue.mjs';
import { SignInPanel } from '@/components/sign-in';
import styles from './terminal-board.module.css';

const SPORTS = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'WNBA', 'TENNIS', 'SOCCER'];
const INITIAL_ROWS = 40;
const LOAD_MORE_ROWS = 40;
const FALLBACK_REFRESH_MS = 60_000;
const STREAM_REFRESH_DEBOUNCE_MS = 450;
const ALL = 'ALL';
const RESEARCH_BATCH_SIZE = 100;
const BOARD_STATE_KEY = 'oblige:terminal-board-state:v1';
const statCategory = (group: PropGroup) =>
  marketDisplayLabel(group.market, group.player, group.marketId, group.sport);

const PERFORMANCE_SORTS = [
  { id: 'ev', label: 'EV' },
  { id: 'avgL10', label: 'Avg L10' },
  { id: 'diff', label: 'Diff' },
  { id: 'l5', label: 'L5' },
  { id: 'l10', label: 'L10' },
  { id: 'l15', label: 'L15' },
  { id: 'h2h', label: 'H2H' },
  { id: 'streak', label: 'Streak' },
  { id: 'season', label: 'Season' },
] as const;

type PerformanceSort = (typeof PERFORMANCE_SORTS)[number]['id'];
type SortDirection = 'desc' | 'asc';
type FeedMode = 'connecting' | 'live' | 'fallback';

type ModelPrediction = {
  available?: boolean;
  projection?: number;
  probabilityOver?: number;
  probabilityUnder?: number;
  probabilityPush?: number;
  engine?: string;
  code?: string;
  message?: string;
  generatedAt?: string;
  expiresAt?: string;
  /** 'global-model' | 'verified-history-adaptive-model' | 'market-consensus' | ... */
  sourceKind?: string;
};

type RateWindow = {
  hits: number | null;
  sample: number | null;
  rate: number | null;
  average: number | null;
  partial: boolean;
};

type ResearchSummary = {
  l5: RateWindow | null;
  l10: RateWindow | null;
  l15: RateWindow | null;
  h2h: RateWindow | null;
  season: RateWindow | null;
  streak: { count: number; over: boolean } | null;
  diff: number | null;
  /** Last ten verified games against this line, newest first; empty when unknown. */
  recent: Array<'hit' | 'miss' | 'push'>;
  /** The same ten games' values, newest first; empty whenever `recent` is. */
  recentValues: number[];
};

type MlTarget = {
  sport: string;
  eventId: string;
  playerId: string;
  playerName: string;
  marketId: string;
  sportsbookKey: string;
  gameStartTime: string;
  line: number;
  entityType: 'player';
  live: boolean;
  isAlternate: false;
  marketOverProbability?: number;
};

type SlipSelection = {
  id: string;
  groupKey: string;
  player: string;
  market: string;
  line: number;
  side: Side;
  sportsbook: string;
  price: number | null;
};

type TerminalBoardState = {
  sport: string;
  query: string;
  market: string;
  book: string;
  dateFilter: string;
  gameFilter: string;
  modifierFilter: string;
  performanceSort: PerformanceSort;
  sortDirection: SortDirection;
  evFloor: number | null;
  arbOnly: boolean;
};

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function text(value: unknown) {
  return String(value || '').trim();
}

function numberOf(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function priceLabel(value: unknown) {
  const number = numberOf(value);
  if (number === null || number === 0) return '—';
  return number > 0 ? `+${number}` : String(number);
}

function timeLabel(value: string | null) {
  if (!value) return 'Time unavailable';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Time unavailable';
  return date.toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function quoteBook(row: PropRow | null | undefined) {
  return text(row?.sportsbook || row?.sportsbookKey) || 'Book unavailable';
}

function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function quoteModifier(row: PropRow | null | undefined) {
  if (!row) return '';
  const special = text(row.specialType || row.dfsOddsType || row.payoutType);
  if (special && !/^(standard|regular|normal|none)$/i.test(special)) return titleCase(special);
  if (row.isAlternate === true) return 'Alternate line';
  const multiplier = numberOf(row.payoutMultiplier);
  if (multiplier !== null && Math.abs(multiplier - 1) > 0.0001) return `${multiplier}x payout`;
  if (row.requiresParlay === true) return 'Parlay only';
  return '';
}

function boardDateKey(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function boardDateLabel(key: string) {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year, Math.max(0, month - 1), day);
  if (!Number.isFinite(date.getTime())) return key;
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function targetFor(group: PropGroup): MlTarget | null {
  const quote = group.bestOver || group.bestUnder || group.quotes[0];
  const eventId = text(quote?.eventId);
  // Rows without a provider id are still identified by name for the global
  // model; the server never passes a name: id to research as a provider id.
  const playerId = text(group.providerPlayerId) || (text(group.player) ? `name:${text(group.player).toLowerCase()}` : '');
  const marketId = text(group.marketId);
  const sportsbookKey = text(quote?.sportsbookKey || quote?.sportsbook);
  const gameStartTime = text(group.startsAt);
  if (!eventId || !playerId || !marketId || !sportsbookKey || !gameStartTime) return null;
  if (!Number.isFinite(Date.parse(gameStartTime))) return null;
  const market = marketOverProbability(group);

  return {
    sport: group.sport,
    eventId,
    playerId,
    playerName: group.player,
    marketId,
    sportsbookKey,
    gameStartTime: new Date(gameStartTime).toISOString(),
    line: group.line,
    entityType: 'player',
    live: group.live,
    isAlternate: false,
    ...(market === null ? {} : { marketOverProbability: market }),
  };
}

async function fetchPredictions(groups: PropGroup[], signal?: AbortSignal) {
  const output: Record<string, ModelPrediction> = {};
  const jobs = groups
    .map((group) => ({ group, target: targetFor(group) }))
    .filter((job): job is { group: PropGroup; target: MlTarget } => Boolean(job.target));

  for (const group of groups) {
    if (!targetFor(group)) {
      output[group.key] = {
        available: false,
        code: 'TARGET_UNVERIFIED',
        message: 'A verified model target is not available for this exact prop.',
      };
    }
  }

  if (!jobs.length) return output;

  const batchSize = 24; // Must stay aligned with ML_BATCH_MAX in lib/ml/routes.mjs.
  for (let offset = 0; offset < jobs.length; offset += batchSize) {
    const batch = jobs.slice(offset, offset + batchSize);
    const response = await fetch('/api/props/ml', {
      method: 'POST',
      credentials: 'same-origin',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        props: batch.map((job, index) => ({ ...job.target, key: String(index) })),
      }),
    });

    if (response.status === 401) throw new ApiError('Sign in to view model estimates.', 401, 'AUTH_REQUIRED');
    if (!response.ok) throw new ApiError('Model estimates are temporarily unavailable.', response.status, 'MODEL_FEED_UNAVAILABLE');

    const body = (await response.json()) as { ok?: boolean; results?: Record<string, ModelPrediction> };
    if (!body.ok || !body.results) {
      throw new ApiError('Model estimates are temporarily unavailable.', 502, 'MODEL_FEED_UNAVAILABLE');
    }

    batch.forEach((job, index) => {
      output[job.group.key] = body.results?.[String(index)] || {
        available: false,
        code: 'MODEL_FEED_UNAVAILABLE',
        message: 'No verified model estimate is available for this prop.',
      };
    });
  }

  return output;
}

function rateWindow(window: ReturnType<typeof windowOf>): RateWindow | null {
  if (!window) return null;
  const rate = pctValue(window.hitRate ?? null);
  const hits = finite(window.hits) ? window.hits : null;
  const sampleRaw = window.sampleSize ?? window.games;
  const sample = finite(sampleRaw) ? sampleRaw : null;
  const average = numberOf(window.average);
  if (rate === null && hits === null && sample === null && average === null) return null;
  return { rate, hits, sample, average, partial: window.partial === true };
}

function summarizeResearch(row: ResearchResponse | null | undefined, line: number): ResearchSummary | null {
  if (!row) return null;
  const l10 = rateWindow(windowOf(row, 'last10', 'l10', 'lastTen'));
  const average = l10?.average ?? null;
  return {
    l5: rateWindow(windowOf(row, 'last5', 'l5', 'lastFive')),
    l10,
    l15: rateWindow(windowOf(row, 'last15', 'l15', 'lastFifteen')),
    h2h: rateWindow(row.h2h || null),
    season: rateWindow(windowOf(row, 'season', 'szn')),
    streak: streakOf(row),
    diff: average === null ? null : Number((average - line).toFixed(2)),
    recent: recentResults(row, line, l10),
    recentValues: recentResults(row, line, l10).length ? recentGames(row).map((game) => game.value as number) : [],
  };
}

/**
 * Over/under results for the last ten logged games, newest first. Shown only
 * when it agrees with the L10 window the server reported; if the two disagree
 * the row keeps the server's rate and shows no marks.
 */
function eventIdOf(group: PropGroup): string | null {
  const quote = group.bestOver || group.bestUnder || group.quotes[0] || null;
  return quote?.eventId ? String(quote.eventId) : null;
}

function recentGames(row: ResearchResponse) {
  return (row.gameLog || [])
    .filter((game) => finite(game.value))
    .sort((a, b) => (Date.parse(b.date || '') || 0) - (Date.parse(a.date || '') || 0))
    .slice(0, 10);
}

function recentResults(row: ResearchResponse, line: number, l10: RateWindow | null): Array<'hit' | 'miss' | 'push'> {
  const games = recentGames(row);
  if (games.length < 10) return [];
  const marks = games.map((game) => (game.value! > line ? 'hit' : game.value! < line ? 'miss' : 'push') as 'hit' | 'miss' | 'push');
  const hits = marks.filter((mark) => mark === 'hit').length;
  return l10 && finite(l10.hits) && l10.hits === hits ? marks : [];
}

function performanceValue(
  group: PropGroup,
  metric: PerformanceSort,
  expectedValues: Record<string, ExpectedValueSelection | null>,
  research: Record<string, ResearchSummary | null>,
) {
  const summary = research[group.key];
  if (metric === 'ev') return expectedValues[group.key]?.ev ?? null;
  if (!summary) return null;
  if (metric === 'avgL10') return summary.l10?.average ?? null;
  if (metric === 'diff') return summary.diff;
  if (metric === 'l5') return summary.l5?.rate ?? null;
  if (metric === 'l10') return summary.l10?.rate ?? null;
  if (metric === 'l15') return summary.l15?.rate ?? null;
  if (metric === 'h2h') return summary.h2h?.rate ?? null;
  if (metric === 'season') return summary.season?.rate ?? null;
  if (metric === 'streak') {
    return summary.streak ? (summary.streak.over ? summary.streak.count : -summary.streak.count) : null;
  }
  return null;
}

function rateLabel(window: RateWindow | null | undefined) {
  if (window === undefined) return '…';
  if (!window || window.rate === null) return '—';
  return `${Math.round(window.rate)}%`;
}

function hitSample(window: RateWindow | null | undefined) {
  if (!window || !finite(window.hits) || !finite(window.sample)) return null;
  return `${window.hits}/${window.sample}`;
}

function selectionId(groupKey: string, side: Side) {
  return `${groupKey}|${side}`;
}

function researchHref(group: PropGroup) {
  const params = new URLSearchParams({
    sport: group.sport,
    player: group.player,
    market: group.market,
    line: String(group.line),
    period: group.period || 'game',
  });
  return `/research?${params.toString()}`;
}

function readTerminalBoardState(): TerminalBoardState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(BOARD_STATE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<TerminalBoardState>;
    const savedSport = text(saved.sport).toUpperCase();
    const savedSort = text(saved.performanceSort);
    return {
      sport: SPORTS.includes(savedSport) ? savedSport : 'NFL',
      query: text(saved.query),
      market: text(saved.market) || ALL,
      book: text(saved.book) || ALL,
      dateFilter: text(saved.dateFilter) || ALL,
      gameFilter: text(saved.gameFilter) || ALL,
      modifierFilter: text(saved.modifierFilter) || ALL,
      performanceSort: PERFORMANCE_SORTS.some((option) => option.id === savedSort)
        ? (savedSort as PerformanceSort)
        : 'ev',
      sortDirection: saved.sortDirection === 'asc' ? 'asc' : 'desc',
      evFloor: typeof saved.evFloor === 'number' && Number.isFinite(saved.evFloor) ? saved.evFloor : null,
      arbOnly: saved.arbOnly === true,
    };
  } catch {
    return null;
  }
}

export function TerminalBoard() {
  const router = useRouter();
  const [account, setAccount] = React.useState<{ id: string; email?: string } | null>(null);
  const [checking, setChecking] = React.useState(true);
  const [sport, setSport] = React.useState('NFL');
  const [groups, setGroups] = React.useState<PropGroup[]>([]);
  const [meta, setMeta] = React.useState<BoardMeta>({});
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [market, setMarket] = React.useState(ALL);
  const [book, setBook] = React.useState(ALL);
  const [dateFilter, setDateFilter] = React.useState(ALL);
  const [gameFilter, setGameFilter] = React.useState(ALL);
  const [modifierFilter, setModifierFilter] = React.useState(ALL);
  const [performanceSort, setPerformanceSort] = React.useState<PerformanceSort>('ev');
  const [sortDirection, setSortDirection] = React.useState<SortDirection>('desc');
  const [evFloor, setEvFloor] = React.useState<number | null>(null);
  const [arbOnly, setArbOnly] = React.useState(false);
  const [shown, setShown] = React.useState(INITIAL_ROWS);
  const [predictions, setPredictions] = React.useState<Record<string, ModelPrediction>>({});
  const [research, setResearch] = React.useState<Record<string, ResearchSummary | null>>({});
  // Why a row has no research (server code mapped to one sentence), shown when a blank cell is tapped.
  const [researchReasons, setResearchReasons] = React.useState<Record<string, string>>({});
  const [researchEpoch, setResearchEpoch] = React.useState(0);
  const [reasonNote, setReasonNote] = React.useState<{ title: string; text: string } | null>(null);
  const researchQueue = React.useRef<ResearchQueue<PropGroup> | null>(null);
  const [feedMode, setFeedMode] = React.useState<FeedMode>('connecting');
  const [slip, setSlip] = React.useState<SlipSelection[]>([]);
  const [slipOpen, setSlipOpen] = React.useState(false);
  // Phones keep the select filters behind one button; desktop always shows them.
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [viewRestored, setViewRestored] = React.useState(false);

  const openResearch = React.useCallback((group: PropGroup) => {
    setSlipOpen(false);
    router.push(researchHref(group));
  }, [router]);

  React.useEffect(() => {
    const saved = readTerminalBoardState();
    if (saved) {
      setSport(saved.sport);
      setQuery(saved.query);
      setMarket(saved.market);
      setBook(saved.book);
      setDateFilter(saved.dateFilter);
      setGameFilter(saved.gameFilter);
      setModifierFilter(saved.modifierFilter);
      setPerformanceSort(saved.performanceSort);
      setSortDirection(saved.sortDirection);
      setEvFloor(saved.evFloor);
      setArbOnly(saved.arbOnly);
    }
    setViewRestored(true);
  }, []);

  React.useEffect(() => {
    if (!viewRestored) return;
    const snapshot: TerminalBoardState = {
      sport,
      query,
      market,
      book,
      dateFilter,
      gameFilter,
      modifierFilter,
      performanceSort,
      sortDirection,
      evFloor,
      arbOnly,
    };
    try {
      window.sessionStorage.setItem(BOARD_STATE_KEY, JSON.stringify(snapshot));
    } catch {
      // Board continuity is a convenience; storage failure must never block research.
    }
  }, [
    viewRestored,
    sport,
    query,
    market,
    book,
    dateFilter,
    gameFilter,
    modifierFilter,
    performanceSort,
    sortDirection,
    evFloor,
    arbOnly,
  ]);

  React.useEffect(() => {
    const controller = new AbortController();
    fetchAccount(controller.signal)
      .then(setAccount)
      .finally(() => setChecking(false));
    return () => controller.abort();
  }, []);

  React.useEffect(() => {
    if (!viewRestored || checking || !account) return;
    let cancelled = false;
    let activeController: AbortController | null = null;
    let stream: EventSource | null = null;
    let streamRefreshTimer: number | null = null;

    const load = async (initial: boolean) => {
      if (activeController) return;
      const controller = new AbortController();
      activeController = controller;
      if (initial) {
        setLoading(true);
        setError('');
      }

      try {
        const board = await fetchBoard(sport, controller.signal);
        if (cancelled) return;
        setGroups(board.groups);
        setMeta(board.meta);
        if (initial) {
          setShown(INITIAL_ROWS);
          setPredictions({});
          setResearch({});
          setResearchReasons({});
          setResearchEpoch((epoch) => epoch + 1);
        }
      } catch (cause) {
        if (cancelled) return;
        if (cause instanceof ApiError && cause.status === 401) {
          setAccount(null);
          return;
        }
        if (initial) setError(cause instanceof Error ? cause.message : 'The live prop board is unavailable.');
      } finally {
        if (activeController === controller) activeController = null;
        if (!cancelled && initial) setLoading(false);
      }
    };

    const refreshQuietly = () => {
      if (streamRefreshTimer !== null) return;
      streamRefreshTimer = window.setTimeout(() => {
        streamRefreshTimer = null;
        if (!cancelled && document.visibilityState === 'visible') void load(false);
      }, STREAM_REFRESH_DEBOUNCE_MS);
    };

    setFeedMode('connecting');
    void load(true);

    if (typeof window.EventSource === 'function') {
      stream = new EventSource(`/api/apex/stream?sport=${encodeURIComponent(sport)}`);
      stream.onopen = () => {
        if (!cancelled) setFeedMode('live');
      };
      stream.addEventListener('ready', () => {
        if (!cancelled) setFeedMode('live');
      });
      stream.addEventListener('market', refreshQuietly);
      stream.addEventListener('resync', refreshQuietly);
      stream.onerror = () => {
        if (!cancelled) setFeedMode('fallback');
      };
    } else {
      setFeedMode('fallback');
    }

    const fallbackTick = () => {
      if (document.visibilityState === 'visible') void load(false);
    };
    const interval = window.setInterval(fallbackTick, FALLBACK_REFRESH_MS);
    document.addEventListener('visibilitychange', fallbackTick);

    return () => {
      cancelled = true;
      activeController?.abort();
      stream?.close();
      if (streamRefreshTimer !== null) window.clearTimeout(streamRefreshTimer);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', fallbackTick);
    };
  }, [viewRestored, checking, account, sport]);

  const markets = React.useMemo(
    () => [...new Set(groups.map(statCategory).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [groups],
  );

  React.useEffect(() => {
    if (market !== ALL && !markets.includes(market)) setMarket(ALL);
  }, [market, markets]);

  const books = React.useMemo(() => {
    const names = new Set<string>();
    groups.forEach((group) => group.quotes.forEach((quote) => {
      const value = quoteBook(quote);
      if (value !== 'Book unavailable') names.add(value);
    }));
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [groups]);

  const games = React.useMemo(
    () => [...new Set(groups.map((group) => group.matchup).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [groups],
  );

  const dates = React.useMemo(
    () => [...new Set(groups.map((group) => boardDateKey(group.startsAt)).filter(Boolean))].sort(),
    [groups],
  );

  const modifiers = React.useMemo(() => {
    const values = new Set<string>();
    groups.forEach((group) => group.quotes.forEach((quote) => {
      const modifier = quoteModifier(quote);
      if (modifier) values.add(modifier);
    }));
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [groups]);

  const scopedGroups = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return groups.filter((group) => {
      if (market !== ALL && statCategory(group) !== market) return false;
      if (book !== ALL && !group.quotes.some((quote) => quoteBook(quote) === book)) return false;
      if (dateFilter !== ALL && boardDateKey(group.startsAt) !== dateFilter) return false;
      if (gameFilter !== ALL && group.matchup !== gameFilter) return false;
      if (modifierFilter !== ALL && !group.quotes.some((quote) => quoteModifier(quote) === modifierFilter)) return false;
      if (
        needle &&
        !`${group.player} ${group.market} ${statCategory(group)} ${group.matchup} ${group.team || ''} ${group.opponent || ''}`
          .toLowerCase()
          .includes(needle)
      ) return false;
      if (arbOnly && !marketArbitrage(group)) return false;
      return true;
    });
  }, [arbOnly, book, dateFilter, gameFilter, groups, market, modifierFilter, query]);

  const expectedValues = React.useMemo(() => {
    const values: Record<string, ExpectedValueSelection | null> = {};
    scopedGroups.forEach((group) => {
      values[group.key] = expectedValueFor(group, predictions[group.key]);
    });
    return values;
  }, [predictions, scopedGroups]);

  const filtered = React.useMemo(() => {
    const ranked = scopedGroups
      .filter((group) => {
        if (evFloor === null) return true;
        const best = expectedValues[group.key];
        return Boolean(best && best.ev >= evFloor);
      })
      .sort((a, b) => {
        const valueA = performanceValue(a, performanceSort, expectedValues, research);
        const valueB = performanceValue(b, performanceSort, expectedValues, research);
        if (valueA === null && valueB !== null) return 1;
        if (valueA !== null && valueB === null) return -1;
        if (valueA !== null && valueB !== null && valueA !== valueB) {
          return sortDirection === 'desc' ? valueB - valueA : valueA - valueB;
        }

        if (performanceSort === 'ev') {
          const l10A = research[a.key]?.l10?.rate ?? -1;
          const l10B = research[b.key]?.l10?.rate ?? -1;
          if (l10A !== l10B) return l10B - l10A;
        }
        return a.player.localeCompare(b.player);
      });

    // The API intentionally returns one exact group per market/line. Rank those
    // exact groups first, then keep one preview card per verified player/event.
    // All alternate lines, books, and stat categories remain in /research.
    return uniqueTerminalPlayerCards(ranked);
  }, [evFloor, expectedValues, performanceSort, research, scopedGroups, sortDirection]);

  const page = React.useMemo(() => filtered.slice(0, shown), [filtered, shown]);
  const pageKey = page.map((group) => group.key).join('|');
  // Visible rows first, then the next page, so scrolling finds data waiting.
  // Sorting by a research metric needs every row, so those follow behind.
  const researchTargets = React.useMemo(() => {
    const nextPage = filtered.slice(shown, shown + LOAD_MORE_ROWS);
    return performanceSort === 'ev' ? [...page, ...nextPage] : [...page, ...nextPage, ...scopedGroups];
  }, [filtered, page, performanceSort, scopedGroups, shown]);
  const researchTargetKey = researchTargets.map((group) => group.key).join('|');

  React.useEffect(() => {
    setShown(INITIAL_ROWS);
  }, [arbOnly, book, dateFilter, evFloor, gameFilter, market, modifierFilter, performanceSort, query, sortDirection, sport]);

  React.useEffect(() => {
    if (!account || !page.length) return;
    const missing = page.filter((group) => predictions[group.key] === undefined);
    if (!missing.length) return;

    const controller = new AbortController();
    void fetchPredictions(missing, controller.signal)
      .then((rows) => setPredictions((current) => ({ ...current, ...rows })))
      .catch((cause) => {
        if (cause instanceof ApiError && cause.status === 401) setAccount(null);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, pageKey]);

  // Consensus opening vs current line and steam for the events on this page.
  // Keys are eventId::market|player so a player's other events never collide.
  const [movement, setMovement] = React.useState<Record<string, MovementRow>>({});
  const movementEvents = React.useMemo(
    () => [...new Set(page.map(eventIdOf).filter((id): id is string => Boolean(id) && /^\d{1,18}$/.test(id!)))].slice(0, 12),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageKey],
  );
  const movementEventsKey = movementEvents.join(',');
  React.useEffect(() => {
    if (!account || !movementEvents.length) return;
    const controller = new AbortController();
    const load = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void fetchMovement(sport, movementEvents, controller.signal)
        .then((result) => {
          const next: Record<string, MovementRow> = {};
          for (const [eventId, event] of Object.entries(result.events || {})) {
            for (const [key, row] of Object.entries(event.markets || {})) next[eventId + '::' + key] = row;
          }
          setMovement((current) => ({ ...current, ...next }));
        })
        .catch(() => { /* movement is an enhancement; the board stands without it */ });
    };
    load();
    const timer = window.setInterval(load, 90_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, sport, movementEventsKey]);
  const movementFor = React.useCallback(
    (group: PropGroup) => {
      const eventId = eventIdOf(group);
      return eventId ? movement[eventId + '::' + movementKey(group.marketId, group.player)] || null : null;
    },
    [movement],
  );

  // One queue per signed-in board load. It is never torn down because the row
  // list changed (live refreshes and EV re-sorts change it constantly); it only
  // skips props it already has and puts the visible ones first.
  const accountId = account?.id ?? null;
  React.useEffect(() => {
    if (!accountId) return;
    const queue = createResearchQueue<PropGroup, ResearchResponse>({
      batchSize: RESEARCH_BATCH_SIZE,
      fetchBatch: (groups, signal) => fetchResearchBatch(groups, 'OVER', signal),
      onAuthLost: () => setAccount(null),
      onSettled: (entries) => {
        const summaries: Record<string, ResearchSummary | null> = {};
        const reasons: Record<string, string> = {};
        for (const { group, row, code, message } of entries) {
          const summary = row && row.available !== false ? summarizeResearch(row, group.line) : null;
          summaries[group.key] = summary;
          if (!summary || code) reasons[group.key] = reasonText(code, message);
        }
        setResearch((current) => ({ ...current, ...summaries }));
        setResearchReasons((current) => ({ ...current, ...reasons }));
      },
    });
    researchQueue.current = queue;
    return () => {
      queue.cancel();
      if (researchQueue.current === queue) researchQueue.current = null;
    };
  }, [accountId, sport, researchEpoch]);

  React.useEffect(() => {
    if (!accountId || !researchTargets.length) return;
    researchQueue.current?.want(researchTargets.filter((group) => research[group.key] === undefined));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, researchTargetKey, researchEpoch]);

  React.useEffect(() => {
    if (!reasonNote) return;
    const timer = window.setTimeout(() => setReasonNote(null), 6000);
    return () => window.clearTimeout(timer);
  }, [reasonNote]);

  const explainBlank = React.useCallback((group: PropGroup, column: string) => {
    const text = researchReasons[group.key] || reasonText('NO_WINDOW');
    setReasonNote({ title: `${group.player} · ${column}`, text });
  }, [researchReasons]);

  const feedLabel = meta.stale
    ? 'cached'
    : feedMode === 'live'
      ? 'streaming'
      : feedMode === 'connecting'
        ? 'connecting'
        : 'fallback';

  const selectSide = React.useCallback((group: PropGroup, side: Side) => {
    const quote = side === 'OVER' ? group.bestOver : group.bestUnder;
    const id = selectionId(group.key, side);
    setSlip((current) => {
      if (current.some((item) => item.id === id)) return current.filter((item) => item.id !== id);
      return [
        ...current,
        {
          id,
          groupKey: group.key,
          player: group.player,
          market: group.market,
          line: group.line,
          side,
          sportsbook: quoteBook(quote),
          price: numberOf(quote?.price),
        },
      ].slice(-12);
    });
  }, []);

  const selectSport = React.useCallback((nextSport: string) => {
    if (nextSport === sport) return;
    setQuery('');
    setMarket(ALL);
    setBook(ALL);
    setDateFilter(ALL);
    setGameFilter(ALL);
    setModifierFilter(ALL);
    setPerformanceSort('ev');
    setSortDirection('desc');
    setEvFloor(null);
    setArbOnly(false);
    setSport(nextSport);
  }, [sport]);

  if (checking) return <TerminalLoading />;

  const activeFilterCount = [market, book, dateFilter, gameFilter, modifierFilter].filter((value) => value !== ALL).length;

  if (!account) {
    return (
      <div className={styles.signInShell}>
        <SignInPanel onSignedIn={setAccount} />
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <section className={styles.terminal}>
        <header className={styles.terminalHeader}>
          <h1>Player Props</h1>
          <div className={styles.headerMetrics}>
            <b className={styles.feedBadge} data-live={feedMode === 'live' && !meta.stale ? 'true' : 'false'}>
              <span className={styles.feedDotWrap} aria-hidden="true">
                {feedMode === 'live' && !meta.stale ? <span className={styles.feedPing} /> : null}
                <span className={styles.feedDot} data-live={feedMode === 'live' && !meta.stale ? 'true' : 'false'} />
              </span>
              {feedLabel}
            </b>
            <span>{groups.length.toLocaleString()} props</span>
            <span>{(meta.sportsbookCount ?? books.length) || '—'} books</span>
          </div>
        </header>

        <div className={styles.commandBar} data-filters={filtersOpen ? 'open' : 'closed'}>
          <div className={styles.leagueRail} role="group" aria-label="League">
            {SPORTS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={sport === option}
                className={sport === option ? styles.active : ''}
                onClick={() => selectSport(option)}
              >
                {option}
              </button>
            ))}
          </div>

          <div className={styles.filterRow}>
            <label className={styles.searchBox}>
              <Search size={15} aria-hidden="true" />
              <span className="sr-only">Search players, teams or markets</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search players, teams, or props..."
              />
            </label>

            <label className={styles.selectControl}>
              <Activity size={14} aria-hidden="true" />
              <span className="sr-only">Market</span>
              <select value={market} onChange={(event) => setMarket(event.target.value)}>
                <option value={ALL}>All stats</option>
                {markets.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>

            <label className={styles.selectControl}>
              <BookOpen size={14} aria-hidden="true" />
              <span className="sr-only">Sportsbook</span>
              <select value={book} onChange={(event) => setBook(event.target.value)}>
                <option value={ALL}>All apps / books</option>
                {books.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>

            <button
              type="button"
              className={styles.filtersToggle}
              aria-expanded={filtersOpen}
              aria-controls="board-filters"
              onClick={() => setFiltersOpen((value) => !value)}
            >
              <SlidersHorizontal size={14} aria-hidden="true" />
              Filters
              {activeFilterCount ? <span>{activeFilterCount}</span> : null}
            </button>

            <button
              type="button"
              className={styles.slipButton}
              onClick={() => setSlipOpen(true)}
            >
              <Layers3 size={15} aria-hidden="true" />
              Slip
              {slip.length ? <span>{slip.length}</span> : null}
            </button>
          </div>

          <div id="board-filters" className={styles.secondaryFilterRow} aria-label="Game and modifier filters">
            <label className={styles.selectControl}>
              <CalendarDays size={14} aria-hidden="true" />
              <span className="sr-only">Game date</span>
              <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}>
                <option value={ALL}>Any date</option>
                {dates.map((option) => <option key={option} value={option}>{boardDateLabel(option)}</option>)}
              </select>
            </label>

            <label className={styles.selectControl}>
              <Users size={14} aria-hidden="true" />
              <span className="sr-only">Game</span>
              <select value={gameFilter} onChange={(event) => setGameFilter(event.target.value)}>
                <option value={ALL}>All games</option>
                {games.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>

            <label className={styles.selectControl}>
              <Sparkles size={14} aria-hidden="true" />
              <span className="sr-only">Projection modifier</span>
              <select value={modifierFilter} onChange={(event) => setModifierFilter(event.target.value)}>
                <option value={ALL}>All modifiers</option>
                {modifiers.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          </div>

          <div className={`${styles.evRail} ${styles.performanceRail}`} role="group" aria-label="Performance sorting">
            <span><BarChart3 size={13} /> Sort</span>
            {PERFORMANCE_SORTS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={performanceSort === option.id}
                className={performanceSort === option.id ? styles.active : ''}
                onClick={() => setPerformanceSort(option.id)}
              >
                {option.label}
              </button>
            ))}
            <button
              type="button"
              aria-label={sortDirection === 'desc' ? 'Show worst performers first' : 'Show top performers first'}
              onClick={() => setSortDirection((value) => value === 'desc' ? 'asc' : 'desc')}
              title="Toggle top or worst performers first"
            >
              {sortDirection === 'desc' ? 'Top first' : 'Worst first'}
            </button>
          </div>

          <div className={`${styles.evRail} ${styles.edgeRail}`} role="group" aria-label="Expected value and arbitrage filters">
            <span><SlidersHorizontal size={13} /> Edge</span>
            {[
              { label: 'All', value: null },
              { label: '0%+', value: 0 },
              { label: '2%+', value: 2 },
              { label: '5%+', value: 5 },
              { label: '10%+', value: 10 },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                aria-pressed={evFloor === option.value}
                className={evFloor === option.value ? styles.active : ''}
                onClick={() => setEvFloor(option.value)}
              >
                {option.label}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={arbOnly}
              className={arbOnly ? styles.active : ''}
              onClick={() => setArbOnly((value) => !value)}
              title="Show only settlement-aware exact-line cross-book arbitrage candidates"
            >
              Arb only
            </button>
            <span className={styles.resultCount}>{filtered.length.toLocaleString()} matching</span>
          </div>
        </div>

        {error ? (
          <div className={styles.statePanel}>
            <Activity size={24} />
            <h2>Prop stream unavailable</h2>
            <p>{error}</p>
          </div>
        ) : loading && !groups.length ? (
          <TerminalLoading embedded />
        ) : !filtered.length ? (
          <div className={styles.statePanel}>
            <Search size={24} />
            <h2>No props match this view</h2>
            <p>Change the league, book, market, EV / arb filter, or search text.</p>
          </div>
        ) : (
          <>
            <DesktopMatrix
              rows={page}
              movementFor={movementFor}
              predictions={predictions}
              research={research}
              slip={slip}
              onInspect={openResearch}
              onSelect={selectSide}
              onExplain={explainBlank}
            />
            <MobileMatrix
              rows={page}
              allRows={filtered}
              movementFor={movementFor}
              predictions={predictions}
              research={research}
              slip={slip}
              onInspect={openResearch}
              onSelect={selectSide}
              onExplain={explainBlank}
            />

            {reasonNote ? (
              <div className={styles.reasonNote} role="status" aria-live="polite">
                <div>
                  <b>{reasonNote.title}</b>
                  <span>{reasonNote.text}</span>
                </div>
                <button type="button" aria-label="Dismiss" onClick={() => setReasonNote(null)}>
                  <X size={14} />
                </button>
              </div>
            ) : null}

            {shown < filtered.length ? (
              <div className={styles.loadMoreWrap}>
                <button type="button" onClick={() => setShown((value) => value + LOAD_MORE_ROWS)}>
                  Load {Math.min(LOAD_MORE_ROWS, filtered.length - shown)} more
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

      {slipOpen ? (
        <SlipDrawer
          selections={slip}
          onClose={() => setSlipOpen(false)}
          onRemove={(id) => setSlip((current) => current.filter((item) => item.id !== id))}
          onClear={() => setSlip([])}
        />
      ) : null}
    </div>
  );
}

function rateTone(window: RateWindow | null | undefined) {
  if (!window || window.rate === null) return 'none';
  if (window.rate >= 80) return 'elite';
  if (window.rate >= 60) return 'good';
  if (window.rate >= 50) return 'mid';
  return 'low';
}

function diffTone(value: number | null | undefined) {
  if (value === null || value === undefined) return 'none';
  if (value >= 1) return 'elite';
  if (value > 0) return 'good';
  if (value <= -1) return 'low';
  return 'mid';
}

function signedMetric(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function streakLabel(summary: ResearchSummary | null | undefined) {
  if (!summary?.streak) return '—';
  const count = summary.streak.count;
  if (!count) return '0';
  return `${summary.streak.over ? '+' : '-'}${count}`;
}

/** The EV figure as a pill: stronger fill at 4% and up, dimmed when negative. */
/**
 * The decision figure for a row. EV when a single-bet sportsbook price and a
 * verified probability both exist; otherwise the model's own hit probability
 * for its stronger side (the number pick'em players need); otherwise the
 * model's stated reason for having no estimate.
 */
function EvPill({ group, prediction, bestEv }: { group: PropGroup; prediction: ModelPrediction | undefined; bestEv: ExpectedValueSelection | null }) {
  if (prediction === undefined) return <span className={styles.loadingDot}>…</span>;
  if (bestEv) {
    const tone = bestEv.ev >= 4 ? 'hot' : bestEv.ev > 0 ? 'pos' : 'neg';
    return (
      <span className={styles.evPill} data-tone={tone} title={expectedValueSourceLabel(bestEv) || undefined}>
        {bestEv.ev > 0 ? '+' : bestEv.ev < 0 ? '−' : ''}{Math.abs(bestEv.ev).toFixed(1)}%
        <small>{bestEv.side === 'OVER' ? 'O' : 'U'}</small>
      </span>
    );
  }
  const over = finite(prediction.probabilityOver) ? prediction.probabilityOver : null;
  const under = finite(prediction.probabilityUnder) ? prediction.probabilityUnder : null;
  if (prediction.available !== false && over !== null && under !== null) {
    const priced = [group.bestOver, group.bestUnder].some((quote) => Math.abs(numberOf(quote?.price) ?? 0) >= 100);
    const side = over >= under ? 'O' : 'U';
    const pct = Math.round(Math.max(over, under) * 100);
    const why = priced
      ? 'EV needs a current single-bet sportsbook price; this one is stale or not a straight bet.'
      : 'Pick\'em app: there is no single-bet price, so EV cannot be computed.';
    const market = prediction.sourceKind === 'market-consensus';
    const sideName = side === 'O' ? 'over' : 'under';
    const title = market
      ? `Sportsbook consensus: the no-vig chance of the ${sideName} from books quoting both sides of this line. Not a model estimate. ${why}`
      : `${prediction.sourceKind === 'global-model' ? 'Global model' : 'Model'} hit probability for the ${sideName}. ${why}`;
    return (
      <span className={styles.evPill} data-tone="prob" data-source={market ? 'market' : 'model'} title={title}>
        {market ? <em>Mkt</em> : null}{pct}%<small>{side}</small>
      </span>
    );
  }
  return (
    <span className={styles.unavailable} title={prediction.message || 'No verified model estimate for this prop.'}>
      No model
    </span>
  );
}

/** Ten marks, newest on the right, one per verified game against this line. */
function RecentMarks({ marks }: { marks: Array<'hit' | 'miss' | 'push'> }) {
  if (!marks.length) return null;
  const ordered = [...marks].reverse();
  return (
    <span className={styles.marks} aria-hidden="true">
      {ordered.map((mark, index) => <i key={index} data-mark={mark} />)}
    </span>
  );
}

function projectionOf(prediction: ModelPrediction | undefined) {
  return prediction?.available !== false && finite(prediction?.projection) ? prediction!.projection! : null;
}

function PriceButton({ group, side, selected, onSelect }: { group: PropGroup; side: Side; selected: boolean; onSelect: (group: PropGroup, side: Side) => void }) {
  const quote = side === 'OVER' ? group.bestOver : group.bestUnder;
  return (
    <button
      type="button"
      className={styles.price}
      data-side={side === 'OVER' ? 'over' : 'under'}
      data-selected={selected ? 'true' : 'false'}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(group, side);
      }}
      title={`${side === 'OVER' ? 'Over' : 'Under'} · ${quoteBook(quote)} · add to research slip`}
    >
      <em>{side === 'OVER' ? 'O' : 'U'}</em>
      <b>{quote ? priceLabel(quote.price) : '—'}</b>
      <small>{quote ? quoteBook(quote) : ''}</small>
    </button>
  );
}

/** How far the consensus line has moved since it opened, from the movement feed. */
function LineMove({ row }: { row: MovementRow | null }) {
  const side = row?.over || row?.under || null;
  if (!side || side.open === null || side.latest === null) return null;
  const delta = Math.round((side.latest - side.open) * 10) / 10;
  if (delta === 0) return null;
  return (
    <small className={styles.lineMove} data-dir={delta > 0 ? 'up' : 'down'} title={`Opened ${side.open}; consensus now ${side.latest} (median of ${side.books} ${side.books === 1 ? 'book' : 'books'})`}>
      {delta > 0 ? '▲' : '▼'}{Math.abs(delta)}
    </small>
  );
}

/** Several books moved this player market the same way. */
function SteamTag({ row }: { row: MovementRow | null }) {
  const steam = row?.steam;
  if (!steam) return null;
  const up = /up|over|higher/i.test(steam.direction);
  return (
    <span className={styles.steamTag} title={`${steam.booksMoved}${steam.booksQuoting ? ' of ' + steam.booksQuoting : ''} books moved ${steam.side ? steam.side.toLowerCase() + ' ' : ''}${up ? 'up' : 'down'} · steam score ${Math.round(steam.score)}`}>
      Steam {up ? '▲' : '▼'}
    </span>
  );
}

function DesktopMatrix({
  rows,
  movementFor,
  predictions,
  research,
  slip,
  onInspect,
  onSelect,
  onExplain,
}: {
  rows: PropGroup[];
  movementFor: (group: PropGroup) => MovementRow | null;
  predictions: Record<string, ModelPrediction>;
  research: Record<string, ResearchSummary | null>;
  slip: SlipSelection[];
  onInspect: (group: PropGroup) => void;
  onSelect: (group: PropGroup, side: Side) => void;
  onExplain: (group: PropGroup, column: string) => void;
}) {
  return (
    <div className={styles.matrixWrap}>
      <table className={styles.matrix}>
        <colgroup>
          <col className={styles.colPlayer} /><col className={styles.colMarket} /><col className={styles.colGame} />
          <col className={styles.colLine} /><col className={styles.colPrice} /><col className={styles.colPrice} />
          <col className={styles.colNum} /><col className={styles.colL10} /><col className={styles.colNum} />
          <col className={styles.colNum} /><col className={styles.colNum} /><col className={styles.colAvg} />
          <col className={styles.colNum} /><col className={styles.colEv} />
        </colgroup>
        <thead>
          <tr>
            <th className={styles.playerColumn}>Player</th>
            <th className={styles.left}>Market</th>
            <th className={styles.left}>Game</th>
            <th>Line</th>
            <th className={styles.zone}>Best over</th>
            <th className={styles.zone}>Best under</th>
            <th>Proj</th>
            <th className={styles.left}>Last 10</th>
            <th>L5</th>
            <th>L15</th>
            <th>H2H</th>
            <th>Avg L10</th>
            <th>Streak</th>
            <th className={styles.evColumn}>EV</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((group) => {
            const prediction = predictions[group.key];
            const summary = research[group.key];
            const bestEv = expectedValueFor(group, prediction);
            const arb = marketArbitrage(group);
            const overSelected = slip.some((item) => item.id === selectionId(group.key, 'OVER'));
            const underSelected = slip.some((item) => item.id === selectionId(group.key, 'UNDER'));
            const avgL10 = summary?.l10?.average ?? null;
            const diff = summary?.diff ?? null;
            const projection = projectionOf(prediction);
            const loaded = summary !== undefined;
            const explain = (column: string) => () => onExplain(group, column);
            const move = movementFor(group);

            return (
              <tr key={group.key} onClick={() => onInspect(group)}>
                <td className={styles.playerCell}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={artworkUrl(group.sport, group.player, group.team, group.providerPlayerId)}
                    alt=""
                    onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }}
                  />
                  <b>{group.player}</b>
                  {group.team ? <small>{group.team}</small> : null}
                  {arb ? <span className={styles.arbTag}>ARB</span> : null}
                  <SteamTag row={move} />
                </td>
                <td className={styles.marketCell}>{marketDisplayLabel(group.market, group.player, group.marketId, group.sport)}</td>
                <td className={styles.gameCell}>{group.matchup}</td>
                <td className={styles.lineCell}>{group.line}<LineMove row={move} /></td>
                <td className={styles.priceCell}><PriceButton group={group} side="OVER" selected={overSelected} onSelect={onSelect} /></td>
                <td className={styles.priceCell}><PriceButton group={group} side="UNDER" selected={underSelected} onSelect={onSelect} /></td>
                <td className={styles.metricCell} data-tone={projection !== null && projection > group.line ? 'up' : 'none'}>
                  {projection !== null ? projection.toFixed(1) : prediction === undefined ? '…' : '—'}
                </td>
                <td className={styles.l10Cell} title={hitSample(summary?.l10) ? `${hitSample(summary?.l10)} hits` : undefined}>
                  <RecentMarks marks={summary?.recent || []} />
                  <span className={styles.heatCell} data-tone={rateTone(summary === undefined ? undefined : summary?.l10 ?? null)}>
                    {summary !== undefined && isBlankWindow(summary?.l10 ?? null) ? <BlankReason onExplain={explain('L10')} /> : rateLabel(summary === undefined ? undefined : summary?.l10 ?? null)}
                  </span>
                </td>
                <MatrixRateCell window={summary === undefined ? undefined : summary?.l5 ?? null} onExplain={explain('L5')} />
                <MatrixRateCell window={summary === undefined ? undefined : summary?.l15 ?? null} onExplain={explain('L15')} />
                <MatrixRateCell window={summary === undefined ? undefined : summary?.h2h ?? null} onExplain={explain('H2H')} />
                <td className={styles.metricCell} data-tone={avgL10 !== null && avgL10 >= group.line ? 'good' : 'none'}>
                  {avgL10 !== null ? (
                    <>
                      {avgL10.toFixed(1)}
                      {diff !== null ? <small data-tone={diffTone(diff)}>{signedMetric(diff)}</small> : null}
                    </>
                  ) : loaded ? <BlankReason onExplain={explain('Avg L10')} /> : '…'}
                </td>
                <td
                  className={styles.metricCell}
                  data-tone={summary?.streak ? (summary.streak.over ? 'good' : 'low') : 'none'}
                >
                  {streakLabel(summary)}
                </td>
                <td className={styles.evCell}>
                  <EvPill group={group} prediction={prediction} bestEv={bestEv} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MobileMatrix({
  rows,
  allRows,
  movementFor,
  predictions,
  research,
  slip,
  onInspect,
  onSelect,
  onExplain,
}: {
  rows: PropGroup[];
  /** Every filtered row, so an expanded prop can list the player's other markets. */
  allRows: PropGroup[];
  movementFor: (group: PropGroup) => MovementRow | null;
  predictions: Record<string, ModelPrediction>;
  research: Record<string, ResearchSummary | null>;
  slip: SlipSelection[];
  onInspect: (group: PropGroup) => void;
  onSelect: (group: PropGroup, side: Side) => void;
  onExplain: (group: PropGroup, column: string) => void;
}) {
  // One row open at a time: a tap previews in place instead of leaving the list.
  const [openKey, setOpenKey] = React.useState<string | null>(null);

  return (
    <ol className={styles.mobileList} aria-label="Player props">
      {rows.map((group) => {
        const prediction = predictions[group.key];
        const summary = research[group.key];
        const bestEv = expectedValueFor(group, prediction);
        const overSelected = slip.some((item) => item.id === selectionId(group.key, 'OVER'));
        const underSelected = slip.some((item) => item.id === selectionId(group.key, 'UNDER'));
        const projection = projectionOf(prediction);
        const l10 = summary === undefined ? undefined : summary?.l10 ?? null;
        const sample = hitSample(l10);
        const move = movementFor(group);
        const open = openKey === group.key;

        return (
          <li key={group.key} className={styles.mobileRow} data-open={open ? 'true' : 'false'}>
            <button
              type="button"
              className={styles.mobileMain}
              aria-expanded={open}
              onClick={() => setOpenKey(open ? null : group.key)}
            >
              <span className={styles.mobileName}>
                <b>{group.player}</b>
                {group.team ? <small>{group.team}</small> : null}
                <SteamTag row={move} />
              </span>
              <span className={styles.mobileMarket}>
                {marketDisplayLabel(group.market, group.player, group.marketId, group.sport)} <b>{group.line}</b>
                <LineMove row={move} />
                <small> · {group.matchup}</small>
              </span>
            </button>
            <span className={styles.mobileEv}><EvPill group={group} prediction={prediction} bestEv={bestEv} /></span>
            <span className={styles.mobileRate}>
              <RecentMarks marks={summary?.recent || []} />
              {l10 !== undefined && isBlankWindow(l10) ? (
                <BlankReason onExplain={() => onExplain(group, 'L10')} />
              ) : (
                <span className={styles.mobileHeatCell} data-tone={rateTone(l10)}>{sample || rateLabel(l10)}</span>
              )}
            </span>
            <span className={styles.mobilePrices}>
              <PriceButton group={group} side="OVER" selected={overSelected} onSelect={onSelect} />
              <PriceButton group={group} side="UNDER" selected={underSelected} onSelect={onSelect} />
              {projection !== null ? <span className={styles.mobileProj}>Proj <b>{projection.toFixed(1)}</b></span> : null}
            </span>
            {open ? (
              <PropPreview
                group={group}
                summary={summary}
                move={move}
                allRows={allRows}
                research={research}
                overSelected={overSelected}
                onInspect={onInspect}
                onSelect={onSelect}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** In-place preview for a phone row: recent games, prices across books, the player's other markets, actions. */
function PropPreview({
  group,
  summary,
  move,
  allRows,
  research,
  overSelected,
  onInspect,
  onSelect,
}: {
  group: PropGroup;
  summary: ResearchSummary | null | undefined;
  move: MovementRow | null;
  allRows: PropGroup[];
  research: Record<string, ResearchSummary | null>;
  overSelected: boolean;
  onInspect: (group: PropGroup) => void;
  onSelect: (group: PropGroup, side: Side) => void;
}) {
  const values = [...(summary?.recentValues || [])].reverse();
  const max = Math.max(group.line * 1.4, ...values, 1);
  const books = group.quotes
    .filter((quote) => quote.side === 'OVER' && Math.abs(Number(quote.line) - group.line) < 1e-9 && Math.abs(numberOf(quote.price) ?? 0) >= 100)
    .sort((a, b) => (numberOf(b.price) ?? -Infinity) - (numberOf(a.price) ?? -Infinity))
    .slice(0, 3);
  const others = allRows
    .filter((row) => row.key !== group.key && row.player === group.player && row.matchup === group.matchup)
    .slice(0, 8);
  const opened = move?.over || move?.under || null;

  return (
    <div className={styles.preview}>
      {values.length ? (
        <div>
          <div className={styles.previewHead}><span>Last {values.length} vs {group.line}</span>{summary?.l10?.average != null ? <span>Avg {summary.l10.average.toFixed(1)}</span> : null}</div>
          <div className={styles.previewChart} aria-label={`Last ${values.length} games: ${values.join(', ')}`}>
            {values.map((value, index) => (
              <i key={index} data-mark={value > group.line ? 'hit' : value < group.line ? 'miss' : 'push'} style={{ height: `${Math.max(6, (value / max) * 100)}%` }} />
            ))}
            <b className={styles.previewLine} style={{ bottom: `${(group.line / max) * 100}%` }}><span>{group.line}</span></b>
          </div>
        </div>
      ) : null}
      {books.length ? (
        <div className={styles.previewBooks}>
          {books.map((quote) => (
            <div key={quote.id || quote.sportsbookKey || quote.sportsbook}>
              <span>{quoteBook(quote)}</span>
              <b>{priceLabel(quote.price)}</b>
            </div>
          ))}
        </div>
      ) : null}
      {opened && opened.open !== null && opened.latest !== null && opened.open !== opened.latest ? (
        <p className={styles.previewNote}>Line opened at {opened.open}; consensus now {opened.latest} across {opened.books} {opened.books === 1 ? 'book' : 'books'}.</p>
      ) : null}
      {others.length ? (
        <div>
          <div className={styles.previewHead}><span>Other markets tonight</span></div>
          <div className={styles.previewStrip}>
            {others.map((row) => {
              const rate = research[row.key]?.l10?.rate ?? null;
              return (
                <button key={row.key} type="button" onClick={() => onInspect(row)}>
                  <small>{marketDisplayLabel(row.market, row.player, row.marketId, row.sport)}</small>
                  <b>{row.line}</b>
                  {rate !== null ? <em data-tone={rate >= 60 ? 'good' : 'none'}>L10 {Math.round(rate)}%</em> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className={styles.previewActions}>
        <button type="button" onClick={() => onInspect(group)}>Full research</button>
        <button type="button" data-primary="true" aria-pressed={overSelected} onClick={() => onSelect(group, 'OVER')}>
          {overSelected ? 'Over in slip' : `Add over ${group.bestOver ? priceLabel(group.bestOver.price) : ''}`.trim()}
        </button>
      </div>
    </div>
  );
}

const isBlankWindow = (window: RateWindow | null | undefined) => window !== undefined && (!window || window.rate === null);

/** A '—' that says why when tapped. Looks identical to the plain dash. */
function BlankReason({ onExplain }: { onExplain: () => void }) {
  return (
    <button
      type="button"
      className={styles.blankReason}
      aria-label="Why is this empty?"
      onClick={(event) => {
        event.stopPropagation();
        onExplain();
      }}
    >
      —
    </button>
  );
}

function MatrixRateCell({ window, onExplain }: { window: RateWindow | null | undefined; onExplain?: () => void }) {
  const sample = hitSample(window);
  return (
    <td className={styles.heatCell} data-tone={rateTone(window)} title={sample ? `${sample} hits` : undefined}>
      {isBlankWindow(window) && onExplain ? <BlankReason onExplain={onExplain} /> : rateLabel(window)}
    </td>
  );
}

function SlipDrawer({
  selections,
  onClose,
  onRemove,
  onClear,
}: {
  selections: SlipSelection[];
  onClose: () => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  return (
    <div className={styles.drawerBackdrop} onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <aside className={styles.slipDrawer} aria-label="Research slip">
        <div className={styles.drawerHeader}>
          <span>Research slip · {selections.length}</span>
          <button type="button" aria-label="Close slip" onClick={onClose}><X size={18} /></button>
        </div>

        <div className={styles.slipIntro}>
          <Zap size={17} />
          <p>Keep lines you want to compare together. This is a research list, not a wager placement screen.</p>
        </div>

        <div className={styles.slipList}>
          {selections.length ? selections.map((item) => (
            <article key={item.id} className={styles.slipItem}>
              <div>
                <span>{item.side} · {item.sportsbook}</span>
                <b>{item.player}</b>
                <small>{marketDisplayLabel(item.market, item.player)} · {item.line} · {priceLabel(item.price)}</small>
              </div>
              <button type="button" aria-label={`Remove ${item.player}`} onClick={() => onRemove(item.id)}>
                <X size={15} />
              </button>
            </article>
          )) : (
            <div className={styles.slipEmpty}>
              <CircleDollarSign size={24} />
              <b>No research selections yet</b>
              <p>Tap an Over or Under price in the terminal to add it here.</p>
            </div>
          )}
        </div>

        {selections.length ? (
          <button type="button" className={styles.clearSlip} onClick={onClear}>Clear research slip</button>
        ) : null}
      </aside>
    </div>
  );
}

function TerminalLoading({ embedded = false }: { embedded?: boolean }) {
  return (
    <div className={embedded ? styles.loadingEmbedded : styles.loadingPage}>
      <div className={styles.loadingBar} />
      <p>Opening Oblige Props v2 terminal…</p>
    </div>
  );
}
