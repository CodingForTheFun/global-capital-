'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  BarChart3,
  BookOpen,
  CalendarDays,
  ChevronRight,
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
  fetchResearchBatch,
  streakOf,
  windowOf,
} from '@/lib/api';
import { marketDisplayLabel, pctValue } from '@/lib/utils';
import {
  marketArbitrage,
  marketArbitrageLabel,
} from '@/lib/arbitrage.mjs';
import {
  expectedValueFor,
  expectedValueSourceLabel,
  type ExpectedValueSelection,
} from '@/lib/expected-value.mjs';
import { uniqueTerminalPlayerCards } from '@/lib/terminal-player-cards.mjs';
import { SignInPanel } from '@/components/sign-in';
import styles from './terminal-board.module.css';

const SPORTS = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'WNBA', 'SOCCER'];
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
  const playerId = text(group.providerPlayerId);
  const marketId = text(group.marketId);
  const sportsbookKey = text(quote?.sportsbookKey || quote?.sportsbook);
  const gameStartTime = text(group.startsAt);
  if (!eventId || !playerId || !marketId || !sportsbookKey || !gameStartTime) return null;
  if (!Number.isFinite(Date.parse(gameStartTime))) return null;

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
  };
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
  const [feedMode, setFeedMode] = React.useState<FeedMode>('connecting');
  const [slip, setSlip] = React.useState<SlipSelection[]>([]);
  const [slipOpen, setSlipOpen] = React.useState(false);
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
  const researchTargets = performanceSort === 'ev' ? page : scopedGroups;
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

  React.useEffect(() => {
    if (!account || !researchTargets.length) return;
    const controller = new AbortController();
    const missing = researchTargets.filter((group) => research[group.key] === undefined);
    if (!missing.length) return () => controller.abort();

    const batches: PropGroup[][] = [];
    for (let index = 0; index < missing.length; index += RESEARCH_BATCH_SIZE) {
      batches.push(missing.slice(index, index + RESEARCH_BATCH_SIZE));
    }

    const hydrate = async () => {
      for (const batch of batches) {
        if (controller.signal.aborted) return;
        try {
          const rows = await fetchResearchBatch(batch, 'OVER', controller.signal);
          if (controller.signal.aborted) return;
          const next: Record<string, ResearchSummary | null> = {};
          batch.forEach((group) => {
            next[group.key] = summarizeResearch(rows[group.key], group.line);
          });
          setResearch((current) => ({ ...current, ...next }));
        } catch (cause) {
          if (controller.signal.aborted) return;
          if (cause instanceof ApiError && cause.status === 401) {
            setAccount(null);
            return;
          }
          const unavailable = Object.fromEntries(batch.map((group) => [group.key, null])) as Record<string, null>;
          setResearch((current) => ({ ...current, ...unavailable }));
        }
      }
    };

    void hydrate();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, researchTargetKey]);

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
          <div>
            <div className={styles.terminalEyebrow}>
              <Sparkles size={13} aria-hidden="true" />
              ObligeProps
            </div>
            <h1>Player Props</h1>
            <p>Compare live lines, hit rates, model edges and sportsbook prices in one research board.</p>
          </div>

          <div className={styles.headerMetrics}>
            <div className={styles.feedMetric}>
              <span className={styles.feedMetricLabel}>Feed</span>
              <b className={styles.feedBadge} data-live={feedMode === 'live' && !meta.stale ? 'true' : 'false'}>
                <span className={styles.feedDotWrap} aria-hidden="true">
                  {feedMode === 'live' && !meta.stale ? <span className={styles.feedPing} /> : null}
                  <span className={styles.feedDot} data-live={feedMode === 'live' && !meta.stale ? 'true' : 'false'} />
                </span>
                {feedLabel}
              </b>
            </div>
            <div>
              <span>Props</span>
              <b>{groups.length.toLocaleString()}</b>
            </div>
            <div>
              <span>Books</span>
              <b>{(meta.sportsbookCount ?? books.length) || '—'}</b>
            </div>
          </div>
        </header>

        <div className={styles.commandBar}>
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
              className={styles.slipButton}
              onClick={() => setSlipOpen(true)}
            >
              <Layers3 size={15} aria-hidden="true" />
              Slip
              {slip.length ? <span>{slip.length}</span> : null}
            </button>
          </div>

          <div className={styles.secondaryFilterRow} aria-label="Game and modifier filters">
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
              predictions={predictions}
              research={research}
              slip={slip}
              onInspect={openResearch}
              onSelect={selectSide}
            />
            <MobileMatrix
              rows={page}
              predictions={predictions}
              research={research}
              slip={slip}
              onInspect={openResearch}
              onSelect={selectSide}
            />

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

function DesktopMatrix({
  rows,
  predictions,
  research,
  slip,
  onInspect,
  onSelect,
}: {
  rows: PropGroup[];
  predictions: Record<string, ModelPrediction>;
  research: Record<string, ResearchSummary | null>;
  slip: SlipSelection[];
  onInspect: (group: PropGroup) => void;
  onSelect: (group: PropGroup, side: Side) => void;
}) {
  return (
    <div className={styles.matrixWrap}>
      <table className={`${styles.matrix} ${styles.researchMatrix}`}>
        <thead>
          <tr>
            <th className={styles.playerColumn}>Player</th>
            <th>Line</th>
            <th>App(s)</th>
            <th>Avg L10</th>
            <th>Diff</th>
            <th>L5</th>
            <th>L10</th>
            <th>L15</th>
            <th>H2H</th>
            <th>Streak</th>
            <th>EV</th>
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

            return (
              <tr key={group.key} onClick={() => onInspect(group)}>
                <td className={styles.playerCell}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={artworkUrl(group.sport, group.player, group.team, group.providerPlayerId)}
                    alt=""
                    onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }}
                  />
                  <span>
                    <b>{group.player}</b>
                    <small>
                      {marketDisplayLabel(group.market, group.player, group.marketId, group.sport)}
                      {' · '}
                      {group.matchup}
                      {arb ? ' · ARB' : ''}
                    </small>
                  </span>
                </td>
                <td className={styles.numCell}>{group.line}</td>
                <td className={styles.bookCell}>
                  <div className={styles.bookPair}>
                    <button
                      type="button"
                      data-side="over"
                      data-selected={overSelected ? 'true' : 'false'}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelect(group, 'OVER');
                      }}
                      title={`Over · ${quoteBook(group.bestOver)}`}
                    >
                      <b>O {priceLabel(group.bestOver?.price)}</b>
                      <small>{quoteBook(group.bestOver)}</small>
                    </button>
                    <button
                      type="button"
                      data-side="under"
                      data-selected={underSelected ? 'true' : 'false'}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelect(group, 'UNDER');
                      }}
                      title={`Under · ${quoteBook(group.bestUnder)}`}
                    >
                      <b>U {priceLabel(group.bestUnder?.price)}</b>
                      <small>{quoteBook(group.bestUnder)}</small>
                    </button>
                  </div>
                </td>
                <td className={styles.metricCell} data-tone={avgL10 !== null && avgL10 >= group.line ? 'good' : 'none'}>
                  {avgL10 === null ? '—' : avgL10.toFixed(1)}
                </td>
                <td className={styles.metricCell} data-tone={diffTone(diff)}>{signedMetric(diff)}</td>
                <MatrixRateCell window={summary === undefined ? undefined : summary?.l5 ?? null} />
                <MatrixRateCell window={summary === undefined ? undefined : summary?.l10 ?? null} />
                <MatrixRateCell window={summary === undefined ? undefined : summary?.l15 ?? null} />
                <MatrixRateCell window={summary === undefined ? undefined : summary?.h2h ?? null} />
                <td
                  className={styles.metricCell}
                  data-tone={summary?.streak ? (summary.streak.over ? 'good' : 'low') : 'none'}
                >
                  {streakLabel(summary)}
                </td>
                <td
                  className={styles.evCell}
                  data-positive={bestEv && bestEv.ev > 0 ? 'true' : 'false'}
                  title={bestEv ? expectedValueSourceLabel(bestEv) || undefined : 'Verified EV unavailable'}
                >
                  {prediction === undefined ? (
                    <span className={styles.loadingDot}>…</span>
                  ) : bestEv ? (
                    <>
                      <b>{bestEv.ev >= 0 ? '+' : ''}{bestEv.ev.toFixed(1)}%</b>
                      <small>{bestEv.side}</small>
                    </>
                  ) : (
                    <span className={styles.unavailable}>—</span>
                  )}
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
  predictions,
  research,
  slip,
  onInspect,
  onSelect,
}: {
  rows: PropGroup[];
  predictions: Record<string, ModelPrediction>;
  research: Record<string, ResearchSummary | null>;
  slip: SlipSelection[];
  onInspect: (group: PropGroup) => void;
  onSelect: (group: PropGroup, side: Side) => void;
}) {
  return (
    <div className={styles.mobileMatrixWrap} aria-label="Player prop research matrix">
      <div className={styles.mobileMatrix} role="table">
        <div className={`${styles.mobileMatrixRow} ${styles.mobileMatrixHead}`} role="row">
          <span className={styles.mobileSticky}>Player</span>
          <span>Line</span>
          <span>App(s)</span>
          <span>Avg L10</span>
          <span>Diff</span>
          <span>L5</span>
          <span>L10</span>
          <span>L15</span>
          <span>H2H</span>
          <span>Streak</span>
          <span>EV</span>
        </div>

        {rows.map((group) => {
          const prediction = predictions[group.key];
          const summary = research[group.key];
          const bestEv = expectedValueFor(group, prediction);
          const overSelected = slip.some((item) => item.id === selectionId(group.key, 'OVER'));
          const underSelected = slip.some((item) => item.id === selectionId(group.key, 'UNDER'));
          const avgL10 = summary?.l10?.average ?? null;
          const diff = summary?.diff ?? null;

          return (
            <div key={group.key} className={styles.mobileMatrixRow} role="row">
              <button
                type="button"
                className={`${styles.mobilePlayerMatrixCell} ${styles.mobileSticky}`}
                onClick={() => onInspect(group)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={artworkUrl(group.sport, group.player, group.team, group.providerPlayerId)}
                  alt=""
                  onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }}
                />
                <span>
                  <b>{group.player}</b>
                  <small>{marketDisplayLabel(group.market, group.player, group.marketId, group.sport)}</small>
                </span>
              </button>

              <button type="button" className={styles.mobileLineCell} onClick={() => onInspect(group)}>
                {group.line}
              </button>

              <div className={styles.mobileBookPair}>
                <button
                  type="button"
                  data-side="over"
                  data-selected={overSelected ? 'true' : 'false'}
                  onClick={() => onSelect(group, 'OVER')}
                >
                  <b>O {priceLabel(group.bestOver?.price)}</b>
                  <small>{quoteBook(group.bestOver)}</small>
                </button>
                <button
                  type="button"
                  data-side="under"
                  data-selected={underSelected ? 'true' : 'false'}
                  onClick={() => onSelect(group, 'UNDER')}
                >
                  <b>U {priceLabel(group.bestUnder?.price)}</b>
                  <small>{quoteBook(group.bestUnder)}</small>
                </button>
              </div>

              <span className={styles.mobileMetricCell} data-tone={avgL10 !== null && avgL10 >= group.line ? 'good' : 'none'}>
                {avgL10 === null ? '—' : avgL10.toFixed(1)}
              </span>
              <span className={styles.mobileMetricCell} data-tone={diffTone(diff)}>{signedMetric(diff)}</span>
              <MobileRateCell window={summary === undefined ? undefined : summary?.l5 ?? null} />
              <MobileRateCell window={summary === undefined ? undefined : summary?.l10 ?? null} />
              <MobileRateCell window={summary === undefined ? undefined : summary?.l15 ?? null} />
              <MobileRateCell window={summary === undefined ? undefined : summary?.h2h ?? null} />
              <span
                className={styles.mobileMetricCell}
                data-tone={summary?.streak ? (summary.streak.over ? 'good' : 'low') : 'none'}
              >
                {streakLabel(summary)}
              </span>
              <span
                className={styles.mobileMetricCell}
                data-tone={bestEv ? (bestEv.ev >= 5 ? 'elite' : bestEv.ev > 0 ? 'good' : 'low') : 'none'}
                title={bestEv ? expectedValueSourceLabel(bestEv) || undefined : 'Verified EV unavailable'}
              >
                {prediction === undefined ? '…' : bestEv ? `${bestEv.ev >= 0 ? '+' : ''}${bestEv.ev.toFixed(1)}%` : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MatrixRateCell({ window }: { window: RateWindow | null | undefined }) {
  const sample = hitSample(window);
  return (
    <td className={styles.heatCell} data-tone={rateTone(window)} title={sample ? `${sample} hits` : undefined}>
      {rateLabel(window)}
    </td>
  );
}

function MobileRateCell({ window }: { window: RateWindow | null | undefined }) {
  const sample = hitSample(window);
  return (
    <span className={styles.mobileHeatCell} data-tone={rateTone(window)} title={sample ? `${sample} hits` : undefined}>
      {rateLabel(window)}
    </span>
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
