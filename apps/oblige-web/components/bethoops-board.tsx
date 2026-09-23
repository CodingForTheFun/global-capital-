'use client';

/*
 * UI structure adapted from the MIT-licensed BetHoopsXG project by Tony Mao.
 * See ../NOTICE-BetHoopsXG.txt for the preserved license notice.
 * Data, authentication, billing, research, and model contracts remain ObligeProps-owned.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  AlertCircle,
  BarChart3,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Search,
  Target,
  TrendingUp,
  Trophy,
} from 'lucide-react';
import type { BoardMeta, PropGroup } from '@/lib/types';
import {
  ApiError,
  artworkUrl,
  fetchAccount,
  fetchBoard,
  fetchResearch,
  windowOf,
} from '@/lib/api';
import { marketDisplayLabel, pctValue } from '@/lib/utils';
import { SignInPanel } from '@/components/sign-in';
import styles from './bethoops-board.module.css';

const SPORTS = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'WNBA', 'SOCCER'];
const PAGE_SIZE = 24;
const FALLBACK_REFRESH_MS = 60_000;
const STREAM_REFRESH_DEBOUNCE_MS = 500;
const ALL = 'ALL';
const statCategory = (group: PropGroup) =>
  marketDisplayLabel(group.market, group.player, group.marketId, group.sport);

type Tab = 'predictions' | 'history';
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
  validation?: {
    observations?: number;
    events?: number;
  };
};

type ResearchSummary = {
  hits: number | null;
  sample: number | null;
  rate: number | null;
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

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function text(value: unknown) {
  return String(value || '').trim();
}

function price(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
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

export function BetHoopsBoard() {
  const router = useRouter();
  const [account, setAccount] = React.useState<{ id: string; email?: string } | null>(null);
  const [checking, setChecking] = React.useState(true);
  const [sport, setSport] = React.useState('NFL');
  const [tab, setTab] = React.useState<Tab>('predictions');
  const [groups, setGroups] = React.useState<PropGroup[]>([]);
  const [meta, setMeta] = React.useState<BoardMeta>({});
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [market, setMarket] = React.useState(ALL);
  const [predictions, setPredictions] = React.useState<Record<string, ModelPrediction>>({});
  const [research, setResearch] = React.useState<Record<string, ResearchSummary | null>>({});
  const [feedMode, setFeedMode] = React.useState<FeedMode>('connecting');

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
          setPredictions({});
          setResearch({});
        }
      } catch (cause) {
        if (cancelled) return;
        if (cause instanceof ApiError && cause.status === 401) {
          setAccount(null);
          return;
        }
        if (initial) {
          setError(cause instanceof Error ? cause.message : 'The live prop board is unavailable.');
        }
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
        // EventSource automatically reconnects with Last-Event-ID. The slower
        // interval below is only a safety net while the stream is unavailable.
      };
    } else {
      setFeedMode('fallback');
    }

    const fallbackTick = () => {
      if (document.visibilityState === 'visible') void load(false);
    };
    const fallbackInterval = window.setInterval(fallbackTick, FALLBACK_REFRESH_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void load(false);
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      activeController?.abort();
      stream?.close();
      if (streamRefreshTimer !== null) window.clearTimeout(streamRefreshTimer);
      window.clearInterval(fallbackInterval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [checking, account, sport]);

  const markets = React.useMemo(
    () => [...new Set(groups.map(statCategory).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [groups],
  );

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return groups.filter((group) => {
      if (market !== ALL && statCategory(group) !== market) return false;
      if (!needle) return true;
      return `${group.player} ${group.market} ${statCategory(group)} ${group.matchup} ${group.team || ''} ${group.opponent || ''}`
        .toLowerCase()
        .includes(needle);
    });
  }, [groups, market, query]);

  const page = React.useMemo(() => filtered.slice(0, PAGE_SIZE), [filtered]);
  const pageKey = page.map((group) => group.key).join('|');

  React.useEffect(() => {
    if (!account || !page.length) return;
    const controller = new AbortController();
    void fetchPredictions(page, controller.signal)
      .then((rows) => setPredictions((current) => ({ ...current, ...rows })))
      .catch((cause) => {
        if (cause instanceof ApiError && cause.status === 401) setAccount(null);
      });
    return () => controller.abort();
    // pageKey captures the exact visible target list without re-running on object identity changes.
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
          const l10 = windowOf(row, 'last10', 'l10', 'lastTen');
          const rate = pctValue(l10?.hitRate ?? null);
          const hits = finite(l10?.hits) ? l10.hits : null;
          const sampleRaw = l10?.sampleSize ?? l10?.games;
          const sample = finite(sampleRaw) ? sampleRaw : null;
          if (!controller.signal.aborted) {
            setResearch((current) => ({
              ...current,
              [group.key]: rate === null && hits === null && sample === null ? null : { hits, sample, rate },
            }));
          }
        } catch {
          if (!controller.signal.aborted) setResearch((current) => ({ ...current, [group.key]: null }));
        }
      }
    };

    void Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
    return () => controller.abort();
    // pageKey captures the exact visible target list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, pageKey]);

  const displayPage = React.useMemo(() => {
    return [...page].sort((a, b) => {
      const pa = predictions[a.key];
      const pb = predictions[b.key];
      const edgeA = pa?.available && finite(pa.projection) ? Math.abs(pa.projection - a.line) : -1;
      const edgeB = pb?.available && finite(pb.projection) ? Math.abs(pb.projection - b.line) : -1;
      return edgeB - edgeA || a.player.localeCompare(b.player);
    });
  }, [page, predictions]);

  const historyRows = React.useMemo(
    () =>
      displayPage
        .map((group) => ({ group, summary: research[group.key], prediction: predictions[group.key] }))
        .filter((row) => row.summary !== undefined),
    [displayPage, research, predictions],
  );

  const historyTotals = React.useMemo(() => {
    let hits = 0;
    let samples = 0;
    let available = 0;
    for (const row of historyRows) {
      if (!row.summary || !finite(row.summary.hits) || !finite(row.summary.sample) || row.summary.sample <= 0) continue;
      hits += row.summary.hits;
      samples += row.summary.sample;
      available += 1;
    }
    const misses = Math.max(samples - hits, 0);
    const rate = samples > 0 ? (hits / samples) * 100 : null;
    return { hits, misses, samples, rate, available };
  }, [historyRows]);

  function openResearch(group: PropGroup) {
    const params = new URLSearchParams({
      sport: group.sport,
      player: group.player,
      market: group.market,
      line: String(group.line),
    });
    router.push(`/research?${params}`);
  }

  if (checking) {
    return <BoardLoading />;
  }

  if (!account) {
    return (
      <div className={styles.signInShell}>
        <SignInPanel onSignedIn={setAccount} />
      </div>
    );
  }

  const feedLabel = meta.stale
    ? 'Latest cached feed'
    : feedMode === 'live'
      ? 'Live stream'
      : feedMode === 'connecting'
        ? 'Connecting live…'
        : 'Live feed · fallback sync';

  return (
    <div className={styles.pageShell}>
      <section className={styles.appContainer}>
        <header className={styles.appHeader}>
          <p className={styles.eyebrow}>PropLine market data · ObligeProps research</p>
          <h1 className={styles.appTitle}>ObligeProps</h1>
          <p className={styles.appSubtitle}>Live player props with verified model projections and recent-game context.</p>
          <div className={styles.tabBar} role="tablist" aria-label="Prop dashboard views">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'predictions'}
              className={`${styles.tabBtn} ${tab === 'predictions' ? styles.active : ''}`}
              onClick={() => setTab('predictions')}
            >
              <Target size={16} /> Today's Props
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'history'}
              className={`${styles.tabBtn} ${tab === 'history' ? styles.active : ''}`}
              onClick={() => setTab('history')}
            >
              <BarChart3 size={16} /> Performance
            </button>
          </div>
        </header>

        <div className={styles.controlStack}>
          <div className={styles.rail} role="group" aria-label="Sport">
            {SPORTS.map((option) => (
              <button
                key={option}
                type="button"
                className={`${styles.statBtn} ${sport === option ? styles.active : ''}`}
                aria-pressed={sport === option}
                onClick={() => setSport(option)}
              >
                {option}
              </button>
            ))}
          </div>

          <div className={styles.searchRow}>
            <label className={styles.searchField}>
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search players, teams or props</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search players, teams, or props…"
              />
            </label>
            <span className={styles.feedStatus} data-stale={meta.stale || feedMode === 'fallback' ? 'true' : 'false'}>
              <span />
              {feedLabel}
            </span>
          </div>

          <div className={styles.rail} role="group" aria-label="Market">
            <button
              type="button"
              className={`${styles.statBtn} ${market === ALL ? styles.active : ''}`}
              aria-pressed={market === ALL}
              onClick={() => setMarket(ALL)}
            >
              <Activity size={16} /> All Props
            </button>
            {markets.map((option) => (
              <button
                key={option}
                type="button"
                className={`${styles.statBtn} ${market === option ? styles.active : ''}`}
                aria-pressed={market === option}
                onClick={() => setMarket(option)}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <div className={styles.errorMessage} role="alert">
            <AlertCircle size={42} />
            <h2>Failed to load the prop board</h2>
            <p>{error}</p>
          </div>
        ) : tab === 'history' ? (
          <PerformanceView rows={historyRows} totals={historyTotals} onOpen={openResearch} />
        ) : (
          <div className={styles.glassPanel}>
            <div className={styles.panelHeading}>
              <div>
                <span className={styles.panelKicker}>{sport} prop board</span>
                <h2>{loading ? 'Loading props…' : `${filtered.length.toLocaleString()} props available`}</h2>
              </div>
              <span className={styles.panelMeta}>
                {meta.sportsbookCount ? `${meta.sportsbookCount} books` : 'Book count unavailable'}
              </span>
            </div>

            {loading ? (
              <div className={styles.loadingContainer}>
                <div className={styles.spinner} />
                <p>Loading PropLine markets and verified model targets…</p>
              </div>
            ) : displayPage.length === 0 ? (
              <div className={styles.emptyState}>
                <AlertCircle size={42} />
                <h3>No matching props right now.</h3>
                <p>Try another sport, market, or search.</p>
              </div>
            ) : (
              <div className={styles.predictionsGrid}>
                {displayPage.map((group) => (
                  <PredictionCard
                    key={group.key}
                    group={group}
                    prediction={predictions[group.key]}
                    summary={research[group.key]}
                    onOpen={() => openResearch(group)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function PredictionCard({
  group,
  prediction,
  summary,
  onOpen,
}: {
  group: PropGroup;
  prediction?: ModelPrediction;
  summary?: ResearchSummary | null;
  onOpen: () => void;
}) {
  const hasProjection = prediction?.available === true && finite(prediction.projection);
  const diff = hasProjection ? prediction.projection! - group.line : null;
  const recommendation = diff === null ? null : Math.abs(diff) < 0.2 ? 'PASS' : diff > 0 ? 'OVER' : 'UNDER';
  const isOver = recommendation === 'OVER';
  const isUnder = recommendation === 'UNDER';
  const books = new Set(group.quotes.map((quote) => text(quote.sportsbook || quote.sportsbookKey)).filter(Boolean)).size;

  return (
    <article className={styles.predictionCard}>
      {recommendation && recommendation !== 'PASS' ? (
        <div
          className={`${styles.recommendationBadge} ${isOver ? styles.recommendationOver : styles.recommendationUnder}`}
        >
          {recommendation} {isOver ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      ) : (
        <div className={`${styles.recommendationBadge} ${styles.recommendationNeutral}`}>
          {recommendation === 'PASS' ? 'CLOSE' : 'MODEL —'}
        </div>
      )}

      <div className={styles.cardHeader}>
        <div className={styles.playerIdentity}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={artworkUrl(group.sport, group.player, group.team, group.providerPlayerId)}
            alt=""
            className={styles.playerAvatar}
            onError={(event) => {
              event.currentTarget.style.visibility = 'hidden';
            }}
          />
          <div>
            <h3 className={styles.playerName}>{group.player}</h3>
            <span className={styles.matchupBadge}>{group.matchup}</span>
          </div>
        </div>
      </div>

      <div className={styles.statsRow}>
        <div className={styles.statBlock}>
          <span className={styles.statLabel}>Line · {group.market}</span>
          <span className={styles.statValue}>{group.line}</span>
        </div>
        <div className={`${styles.statBlock} ${styles.alignRight}`}>
          <span className={styles.statLabel}>Model projection</span>
          <span
            className={styles.statValue}
            data-tone={isOver ? 'over' : isUnder ? 'under' : 'neutral'}
          >
            {hasProjection ? prediction.projection!.toFixed(1) : 'Unavailable'}
          </span>
        </div>
      </div>

      <div className={styles.contextGrid}>
        <span>
          <TrendingUp size={14} />
          {summary === undefined
            ? 'L10 loading…'
            : summary?.rate !== null && summary?.rate !== undefined
              ? `L10 ${Math.round(summary.rate)}%${finite(summary.hits) && finite(summary.sample) ? ` · ${summary.hits}/${summary.sample}` : ''}`
              : 'L10 unavailable'}
        </span>
        <span>
          <BookOpen size={14} /> {books || '—'} {books === 1 ? 'book' : 'books'}
        </span>
      </div>

      <div className={styles.quoteRow}>
        <span>
          <b>Over</b> {price(group.bestOver?.price)}
        </span>
        <span>
          <b>Under</b> {price(group.bestUnder?.price)}
        </span>
      </div>

      <div className={styles.cardFooter}>
        <span>{timeLabel(group.startsAt)}</span>
        <button type="button" onClick={onOpen}>Open analysis</button>
      </div>
    </article>
  );
}

function PerformanceView({
  rows,
  totals,
  onOpen,
}: {
  rows: Array<{ group: PropGroup; summary: ResearchSummary | null | undefined; prediction: ModelPrediction | undefined }>;
  totals: { hits: number; misses: number; samples: number; rate: number | null; available: number };
  onOpen: (group: PropGroup) => void;
}) {
  return (
    <div className={styles.glassPanel}>
      <div className={styles.performanceNotice}>
        Verified recent-game results for the current slate. This is historical hit-rate context, not a claim about model profitability.
      </div>

      <div className={styles.historySummary}>
        <div className={`${styles.summaryCard} ${styles.summaryWins}`}>
          <Trophy size={24} />
          <div><span className={styles.summaryNumber}>{totals.hits}</span><span className={styles.summaryLabel}>L10 hits</span></div>
        </div>
        <div className={`${styles.summaryCard} ${styles.summaryLosses}`}>
          <Activity size={24} />
          <div><span className={styles.summaryNumber}>{totals.misses}</span><span className={styles.summaryLabel}>L10 misses</span></div>
        </div>
        <div className={`${styles.summaryCard} ${styles.summaryRate}`}>
          <TrendingUp size={24} />
          <div>
            <span className={styles.summaryNumber}>{totals.rate === null ? '—' : `${totals.rate.toFixed(1)}%`}</span>
            <span className={styles.summaryLabel}>Weighted hit rate</span>
          </div>
        </div>
      </div>

      <div className={styles.historyTableWrapper}>
        <table className={styles.historyTable}>
          <thead>
            <tr><th>Player</th><th>Market</th><th>Line</th><th>L10</th><th>Rate</th><th>Model</th><th /></tr>
          </thead>
          <tbody>
            {rows.map(({ group, summary, prediction }) => {
              const projection = prediction?.available && finite(prediction.projection) ? prediction.projection : null;
              const lean = projection === null ? '—' : projection > group.line ? 'Over' : projection < group.line ? 'Under' : 'Even';
              return (
                <tr key={group.key}>
                  <td className={styles.cellPlayer}>{group.player}<small>{group.matchup}</small></td>
                  <td>{group.market}</td>
                  <td>{group.line}</td>
                  <td>{summary && finite(summary.hits) && finite(summary.sample) ? `${summary.hits}/${summary.sample}` : 'Unavailable'}</td>
                  <td>{summary?.rate !== null && summary?.rate !== undefined ? `${Math.round(summary.rate)}%` : '—'}</td>
                  <td><span data-lean={lean.toLowerCase()}>{lean}</span></td>
                  <td><button type="button" className={styles.tableAction} onClick={() => onOpen(group)}>Research</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BoardLoading() {
  return (
    <div className={styles.pageShell}>
      <div className={styles.appContainer}>
        <div className={styles.loadingContainer}>
          <div className={styles.spinner} />
          <p>Opening ObligeProps…</p>
        </div>
      </div>
    </div>
  );
}
