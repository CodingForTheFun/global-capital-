'use client';

import * as React from 'react';
import {
  Activity,
  BarChart3,
  BookOpen,
  ChevronRight,
  CircleDollarSign,
  Layers3,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import type { BoardMeta, PropGroup, PropRow, Side } from '@/lib/types';
import {
  ApiError,
  artworkUrl,
  fetchAccount,
  fetchBoard,
  fetchResearch,
  windowOf,
} from '@/lib/api';
import { pctValue } from '@/lib/utils';
import { SignInPanel } from '@/components/sign-in';
import styles from './terminal-board.module.css';

const SPORTS = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'WNBA', 'SOCCER'];
const INITIAL_ROWS = 40;
const LOAD_MORE_ROWS = 40;
const FALLBACK_REFRESH_MS = 60_000;
const STREAM_REFRESH_DEBOUNCE_MS = 450;
const ALL = 'ALL';

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
};

type ResearchSummary = {
  l5: RateWindow | null;
  l10: RateWindow | null;
  l20: RateWindow | null;
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

type EvSelection = {
  side: Side;
  ev: number;
  probability: number;
  price: number;
  sportsbook: string;
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

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function text(value: unknown) {
  return String(value || '').trim();
}

function numberOf(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function priceLabel(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return '—';
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

function probability01(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  if (number <= 1) return number;
  if (number <= 100) return number / 100;
  return null;
}

function americanDecimal(value: unknown) {
  const odds = Number(value);
  if (!Number.isFinite(odds) || odds === 0) return null;
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
}

function evFor(group: PropGroup, prediction?: ModelPrediction): EvSelection | null {
  if (!prediction?.available) return null;

  const candidates: EvSelection[] = [];
  const add = (side: Side, probabilityRaw: unknown, quote: PropRow | null) => {
    const probability = probability01(probabilityRaw);
    const price = numberOf(quote?.price);
    const decimal = americanDecimal(price);
    if (probability === null || price === null || decimal === null) return;
    candidates.push({
      side,
      probability,
      price,
      sportsbook: quoteBook(quote),
      ev: (probability * decimal - 1) * 100,
    });
  };

  add('OVER', prediction.probabilityOver, group.bestOver);
  add('UNDER', prediction.probabilityUnder, group.bestUnder);
  if (!candidates.length) return null;
  return candidates.sort((a, b) => b.ev - a.ev)[0];
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

  const response = await fetch('/api/props/ml', {
    method: 'POST',
    credentials: 'same-origin',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      props: jobs.map((job, index) => ({ ...job.target, key: String(index) })),
    }),
  });

  if (response.status === 401) throw new ApiError('Sign in to view model estimates.', 401, 'AUTH_REQUIRED');
  if (!response.ok) throw new ApiError('Model estimates are temporarily unavailable.', response.status, 'MODEL_FEED_UNAVAILABLE');

  const body = (await response.json()) as { ok?: boolean; results?: Record<string, ModelPrediction> };
  if (!body.ok || !body.results) {
    throw new ApiError('Model estimates are temporarily unavailable.', 502, 'MODEL_FEED_UNAVAILABLE');
  }

  jobs.forEach((job, index) => {
    output[job.group.key] = body.results?.[String(index)] || {
      available: false,
      code: 'MODEL_FEED_UNAVAILABLE',
      message: 'No verified model estimate is available for this prop.',
    };
  });

  return output;
}

function rateWindow(window: ReturnType<typeof windowOf>): RateWindow | null {
  if (!window) return null;
  const rate = pctValue(window.hitRate ?? null);
  const hits = finite(window.hits) ? window.hits : null;
  const sampleRaw = window.sampleSize ?? window.games;
  const sample = finite(sampleRaw) ? sampleRaw : null;
  if (rate === null && hits === null && sample === null) return null;
  return { rate, hits, sample };
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

export function TerminalBoard() {
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
  const [evFloor, setEvFloor] = React.useState<number | null>(null);
  const [shown, setShown] = React.useState(INITIAL_ROWS);
  const [predictions, setPredictions] = React.useState<Record<string, ModelPrediction>>({});
  const [research, setResearch] = React.useState<Record<string, ResearchSummary | null>>({});
  const [feedMode, setFeedMode] = React.useState<FeedMode>('connecting');
  const [inspector, setInspector] = React.useState<PropGroup | null>(null);
  const [slip, setSlip] = React.useState<SlipSelection[]>([]);
  const [slipOpen, setSlipOpen] = React.useState(false);

  React.useEffect(() => {
    const controller = new AbortController();
    fetchAccount(controller.signal)
      .then(setAccount)
      .finally(() => setChecking(false));
    return () => controller.abort();
  }, []);

  React.useEffect(() => {
    if (checking || !account) return;
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
          setMarket(ALL);
          setBook(ALL);
          setEvFloor(null);
          setShown(INITIAL_ROWS);
          setPredictions({});
          setResearch({});
          setInspector(null);
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
  }, [checking, account, sport]);

  const markets = React.useMemo(
    () => [...new Set(groups.map((group) => group.market).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [groups],
  );

  const books = React.useMemo(() => {
    const names = new Set<string>();
    groups.forEach((group) => group.quotes.forEach((quote) => {
      const value = quoteBook(quote);
      if (value !== 'Book unavailable') names.add(value);
    }));
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [groups]);

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();

    return groups
      .filter((group) => {
        if (market !== ALL && group.market !== market) return false;
        if (book !== ALL && !group.quotes.some((quote) => quoteBook(quote) === book)) return false;
        if (
          needle &&
          !`${group.player} ${group.market} ${group.matchup} ${group.team || ''} ${group.opponent || ''}`
            .toLowerCase()
            .includes(needle)
        ) return false;

        if (evFloor !== null) {
          const best = evFor(group, predictions[group.key]);
          if (!best || best.ev < evFloor) return false;
        }

        return true;
      })
      .sort((a, b) => {
        const evA = evFor(a, predictions[a.key])?.ev ?? -Infinity;
        const evB = evFor(b, predictions[b.key])?.ev ?? -Infinity;
        if (evA !== evB) return evB - evA;
        const l10A = research[a.key]?.l10?.rate ?? -1;
        const l10B = research[b.key]?.l10?.rate ?? -1;
        return l10B - l10A || a.player.localeCompare(b.player);
      });
  }, [book, evFloor, groups, market, predictions, query, research]);

  const page = React.useMemo(() => filtered.slice(0, shown), [filtered, shown]);
  const pageKey = page.map((group) => group.key).join('|');

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
    if (!account || !page.length) return;
    const controller = new AbortController();
    const queue = page.filter((group) => research[group.key] === undefined);
    if (!queue.length) return () => controller.abort();

    const worker = async () => {
      while (queue.length && !controller.signal.aborted) {
        const group = queue.shift();
        if (!group) break;

        try {
          const row = await fetchResearch(group, 'OVER', controller.signal);
          const summary: ResearchSummary = {
            l5: rateWindow(windowOf(row, 'last5', 'l5', 'lastFive')),
            l10: rateWindow(windowOf(row, 'last10', 'l10', 'lastTen')),
            l20: rateWindow(windowOf(row, 'last20', 'l20', 'lastTwenty')),
          };
          if (!controller.signal.aborted) {
            setResearch((current) => ({ ...current, [group.key]: summary }));
          }
        } catch {
          if (!controller.signal.aborted) {
            setResearch((current) => ({ ...current, [group.key]: null }));
          }
        }
      }
    };

    void Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, pageKey]);

  const visibleBooks = React.useMemo(() => {
    if (!inspector) return [];
    return [...inspector.quotes].sort((a, b) => {
      const bookOrder = quoteBook(a).localeCompare(quoteBook(b));
      if (bookOrder) return bookOrder;
      return text(a.side).localeCompare(text(b.side));
    });
  }, [inspector]);

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
              Oblige Props v2
            </div>
            <h1>Research Terminal</h1>
            <p>Streaming prop research, multi-book prices, verified history and model context.</p>
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
                onClick={() => setSport(option)}
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
                placeholder="Search player / team / market"
              />
            </label>

            <label className={styles.selectControl}>
              <Activity size={14} aria-hidden="true" />
              <span className="sr-only">Market</span>
              <select value={market} onChange={(event) => setMarket(event.target.value)}>
                <option value={ALL}>All markets</option>
                {markets.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>

            <label className={styles.selectControl}>
              <BookOpen size={14} aria-hidden="true" />
              <span className="sr-only">Sportsbook</span>
              <select value={book} onChange={(event) => setBook(event.target.value)}>
                <option value={ALL}>All books</option>
                {books.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>

            <button
              type="button"
              className={styles.slipButton}
              onClick={() => {
                setInspector(null);
                setSlipOpen(true);
              }}
            >
              <Layers3 size={15} aria-hidden="true" />
              Slip
              {slip.length ? <span>{slip.length}</span> : null}
            </button>
          </div>

          <div className={styles.evRail} role="group" aria-label="Minimum expected value">
            <span><SlidersHorizontal size={13} /> EV filter</span>
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
            <p>Change the league, book, market, EV threshold, or search text.</p>
          </div>
        ) : (
          <>
            <DesktopMatrix
              rows={page}
              predictions={predictions}
              research={research}
              slip={slip}
              onInspect={(group) => {
                setSlipOpen(false);
                setInspector(group);
              }}
              onSelect={selectSide}
            />
            <MobileMatrix
              rows={page}
              predictions={predictions}
              research={research}
              slip={slip}
              onInspect={(group) => {
                setSlipOpen(false);
                setInspector(group);
              }}
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

      {inspector ? (
        <Inspector
          group={inspector}
          prediction={predictions[inspector.key]}
          research={research[inspector.key]}
          quotes={visibleBooks}
          slip={slip}
          onClose={() => setInspector(null)}
          onSelect={selectSide}
        />
      ) : null}

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
      <table className={styles.matrix}>
        <thead>
          <tr>
            <th className={styles.playerColumn}>Player / game</th>
            <th>Market</th>
            <th>Line</th>
            <th>Best over</th>
            <th>Best under</th>
            <th>L5</th>
            <th>L10</th>
            <th>L20</th>
            <th>Model</th>
            <th>EV</th>
            <th aria-label="Open" />
          </tr>
        </thead>
        <tbody>
          {rows.map((group) => {
            const prediction = predictions[group.key];
            const summary = research[group.key];
            const bestEv = evFor(group, prediction);
            const projection = prediction?.available && finite(prediction.projection) ? prediction.projection : null;
            const overSelected = slip.some((item) => item.id === selectionId(group.key, 'OVER'));
            const underSelected = slip.some((item) => item.id === selectionId(group.key, 'UNDER'));

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
                    <small>{group.matchup} · {timeLabel(group.startsAt)}</small>
                  </span>
                </td>
                <td className={styles.marketCell}>{group.market}</td>
                <td className={styles.numCell}>{group.line}</td>
                <td>
                  <button
                    type="button"
                    className={overSelected ? styles.selectedQuote : styles.quoteButton}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(group, 'OVER');
                    }}
                  >
                    <span>O {priceLabel(group.bestOver?.price)}</span>
                    <small>{quoteBook(group.bestOver)}</small>
                  </button>
                </td>
                <td>
                  <button
                    type="button"
                    className={underSelected ? styles.selectedQuote : styles.quoteButton}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(group, 'UNDER');
                    }}
                  >
                    <span>U {priceLabel(group.bestUnder?.price)}</span>
                    <small>{quoteBook(group.bestUnder)}</small>
                  </button>
                </td>
                <RateCell window={summary === undefined ? undefined : summary?.l5 ?? null} />
                <RateCell window={summary === undefined ? undefined : summary?.l10 ?? null} />
                <RateCell window={summary === undefined ? undefined : summary?.l20 ?? null} />
                <td className={styles.modelCell}>
                  {prediction === undefined ? (
                    <span className={styles.loadingDot}>…</span>
                  ) : projection !== null ? (
                    <>
                      <b>{projection.toFixed(1)}</b>
                      <small>{projection > group.line ? 'OVER lean' : projection < group.line ? 'UNDER lean' : 'at line'}</small>
                    </>
                  ) : (
                    <span className={styles.unavailable}>—</span>
                  )}
                </td>
                <td className={styles.evCell} data-positive={bestEv && bestEv.ev > 0 ? 'true' : 'false'}>
                  {bestEv ? (
                    <>
                      <b>{bestEv.ev >= 0 ? '+' : ''}{bestEv.ev.toFixed(1)}%</b>
                      <small>{bestEv.side}</small>
                    </>
                  ) : (
                    <span className={styles.unavailable}>—</span>
                  )}
                </td>
                <td><ChevronRight size={16} className={styles.rowChevron} /></td>
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
    <div className={styles.mobileRows}>
      {rows.map((group) => {
        const prediction = predictions[group.key];
        const summary = research[group.key];
        const bestEv = evFor(group, prediction);
        const overSelected = slip.some((item) => item.id === selectionId(group.key, 'OVER'));
        const underSelected = slip.some((item) => item.id === selectionId(group.key, 'UNDER'));

        return (
          <article key={group.key} className={styles.mobileRow}>
            <button type="button" className={styles.mobileIdentity} onClick={() => onInspect(group)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={artworkUrl(group.sport, group.player, group.team, group.providerPlayerId)}
                alt=""
                onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }}
              />
              <span>
                <b>{group.player}</b>
                <small>{group.matchup}</small>
              </span>
              <span className={styles.mobileEv}>
                {bestEv ? `${bestEv.ev >= 0 ? '+' : ''}${bestEv.ev.toFixed(1)}% EV` : 'EV —'}
              </span>
            </button>

            <div className={styles.mobileMeta}>
              <span><b>{group.line}</b> {group.market}</span>
              <span>L5 <b>{rateLabel(summary === undefined ? undefined : summary?.l5 ?? null)}</b></span>
              <span>L10 <b>{rateLabel(summary === undefined ? undefined : summary?.l10 ?? null)}</b></span>
              <span>L20 <b>{rateLabel(summary === undefined ? undefined : summary?.l20 ?? null)}</b></span>
            </div>

            <div className={styles.mobileQuotes}>
              <button
                type="button"
                data-selected={overSelected ? 'true' : 'false'}
                onClick={() => onSelect(group, 'OVER')}
              >
                <span>OVER</span>
                <b>{priceLabel(group.bestOver?.price)}</b>
                <small>{quoteBook(group.bestOver)}</small>
              </button>
              <button
                type="button"
                data-selected={underSelected ? 'true' : 'false'}
                onClick={() => onSelect(group, 'UNDER')}
              >
                <span>UNDER</span>
                <b>{priceLabel(group.bestUnder?.price)}</b>
                <small>{quoteBook(group.bestUnder)}</small>
              </button>
              <button type="button" className={styles.inspectButton} onClick={() => onInspect(group)}>
                <BarChart3 size={15} />
                Inspect
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function RateCell({ window }: { window: RateWindow | null | undefined }) {
  const sample = hitSample(window);
  return (
    <td className={styles.rateCell} data-high={window?.rate !== null && window?.rate !== undefined && window.rate >= 60 ? 'true' : 'false'}>
      <b>{rateLabel(window)}</b>
      {sample ? <small>{sample}</small> : null}
    </td>
  );
}

function Inspector({
  group,
  prediction,
  research,
  quotes,
  slip,
  onClose,
  onSelect,
}: {
  group: PropGroup;
  prediction?: ModelPrediction;
  research?: ResearchSummary | null;
  quotes: PropRow[];
  slip: SlipSelection[];
  onClose: () => void;
  onSelect: (group: PropGroup, side: Side) => void;
}) {
  const ev = evFor(group, prediction);
  const projection = prediction?.available && finite(prediction.projection) ? prediction.projection : null;

  return (
    <div className={styles.drawerBackdrop} onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <aside className={styles.inspector} aria-label="Player inspector">
        <div className={styles.drawerHeader}>
          <span>Player inspector</span>
          <button type="button" aria-label="Close inspector" onClick={onClose}><X size={18} /></button>
        </div>

        <div className={styles.inspectorHero}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={artworkUrl(group.sport, group.player, group.team, group.providerPlayerId)}
            alt=""
            onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }}
          />
          <div>
            <span>{group.sport} · {group.team || 'Team unavailable'}</span>
            <h2>{group.player}</h2>
            <p>{group.matchup} · {timeLabel(group.startsAt)}</p>
          </div>
        </div>

        <div className={styles.inspectorLine}>
          <div><span>Market</span><b>{group.market}</b></div>
          <div><span>Line</span><b>{group.line}</b></div>
          <div><span>Model</span><b>{projection !== null ? projection.toFixed(1) : '—'}</b></div>
          <div><span>Best EV</span><b data-positive={ev && ev.ev > 0 ? 'true' : 'false'}>{ev ? `${ev.ev >= 0 ? '+' : ''}${ev.ev.toFixed(1)}%` : '—'}</b></div>
        </div>

        <section className={styles.drawerSection}>
          <div className={styles.sectionHeading}>
            <span>Hit-rate windows</span>
            <small>verified game log</small>
          </div>
          <div className={styles.hitStrip}>
            {[
              { label: 'L5', window: research === undefined ? undefined : research?.l5 ?? null },
              { label: 'L10', window: research === undefined ? undefined : research?.l10 ?? null },
              { label: 'L20', window: research === undefined ? undefined : research?.l20 ?? null },
            ].map(({ label, window }) => (
              <div key={label}>
                <span>{label}</span>
                <b>{rateLabel(window)}</b>
                <small>{hitSample(window) || 'sample unavailable'}</small>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.drawerSection}>
          <div className={styles.sectionHeading}>
            <span>Multi-book matrix</span>
            <small>{new Set(quotes.map((quote) => quoteBook(quote))).size} books</small>
          </div>

          <div className={styles.bookMatrix}>
            <div className={styles.bookMatrixHead}>
              <span>Book</span><span>Side</span><span>Line</span><span>Price</span>
            </div>
            {quotes.length ? quotes.map((quote, index) => (
              <div key={`${quoteBook(quote)}-${quote.side}-${quote.line}-${index}`} className={styles.bookMatrixRow}>
                <span>{quoteBook(quote)}</span>
                <span>{text(quote.side).toUpperCase() || '—'}</span>
                <span>{numberOf(quote.line) ?? group.line}</span>
                <span>{priceLabel(quote.price)}</span>
              </div>
            )) : <p className={styles.drawerEmpty}>No verified book matrix is available for this line.</p>}
          </div>
        </section>

        <div className={styles.inspectorActions}>
          <button
            type="button"
            data-selected={slip.some((item) => item.id === selectionId(group.key, 'OVER')) ? 'true' : 'false'}
            onClick={() => onSelect(group, 'OVER')}
          >
            <span>Best over</span>
            <b>{priceLabel(group.bestOver?.price)}</b>
            <small>{quoteBook(group.bestOver)}</small>
          </button>
          <button
            type="button"
            data-selected={slip.some((item) => item.id === selectionId(group.key, 'UNDER')) ? 'true' : 'false'}
            onClick={() => onSelect(group, 'UNDER')}
          >
            <span>Best under</span>
            <b>{priceLabel(group.bestUnder?.price)}</b>
            <small>{quoteBook(group.bestUnder)}</small>
          </button>
        </div>

        <a
          className={styles.fullResearch}
          href={`/research?${new URLSearchParams({
            sport: group.sport,
            player: group.player,
            market: group.market,
            line: String(group.line),
          })}`}
        >
          Open full player research
          <ChevronRight size={16} />
        </a>
      </aside>
    </div>
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
                <small>{item.market} · {item.line} · {priceLabel(item.price)}</small>
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
