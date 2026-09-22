'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import type { PropGroup, ResearchResponse } from '@/lib/types';
import { ApiError, fetchAccount, fetchBoard, fetchResearch, playedGames } from '@/lib/api';
import {
  computeWindow,
  headToHead,
  playable,
  sortRecentFirst,
  type Side,
} from '@/lib/analytics';
import { teamFor } from '@/lib/teams';
import { cn, marketDisplayLabel, shortTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { CardPanel } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PlayerAvatar } from '@/components/face-card';
import { BookPrices } from '@/components/book-prices';
import { GameLog } from '@/components/research';
import { expectedValueFor, expectedValueSourceLabel, type ExpectedValueSelection } from '@/lib/expected-value.mjs';
import { PropExplorer, type ExplorerState } from '@/components/prop-explorer';
import { SignInPanel } from '@/components/sign-in';
import { Reveal } from '@/components/motion';

const FAVOURITES_KEY = 'oblige-followed';

type PlayerSection = 'overview' | 'props' | 'trends' | 'splits';

type ModelPrediction = {
  available?: boolean;
  projection?: number;
  probabilityOver?: number;
  probabilityUnder?: number;
  probabilityPush?: number;
  engine?: string;
  code?: string;
  message?: string;
};

type MlTarget = {
  sport: string; eventId: string; playerId: string; playerName: string; marketId: string;
  sportsbookKey: string; gameStartTime: string; line: number; entityType: 'player'; live: boolean; isAlternate: false;
};

function mlTargetFor(group: PropGroup): MlTarget | null {
  const quote = group.bestOver || group.bestUnder || group.quotes[0];
  const eventId = String(quote?.eventId || '').trim();
  const playerId = String(group.providerPlayerId || '').trim();
  const marketId = String(group.marketId || '').trim();
  const sportsbookKey = String(quote?.sportsbookKey || quote?.sportsbook || '').trim();
  const gameStartTime = String(group.startsAt || '').trim();
  if (!eventId || !playerId || !marketId || !sportsbookKey || !Number.isFinite(Date.parse(gameStartTime))) return null;
  return { sport: group.sport, eventId, playerId, playerName: group.player, marketId, sportsbookKey,
    gameStartTime: new Date(gameStartTime).toISOString(), line: group.line, entityType: 'player', live: group.live, isAlternate: false };
}

async function fetchPlayerPrediction(group: PropGroup, signal?: AbortSignal): Promise<ModelPrediction> {
  const target = mlTargetFor(group);
  if (!target) return { available: false, code: 'TARGET_UNVERIFIED', message: 'A verified model target is not available for this exact prop.' };
  const response = await fetch('/api/props/ml', { method: 'POST', credentials: 'same-origin', signal,
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ props: [{ ...target, key: 'player' }] }) });
  if (!response.ok) return { available: false, code: 'MODEL_FEED_UNAVAILABLE', message: 'Model estimate is temporarily unavailable.' };
  const body = await response.json() as { ok?: boolean; results?: Record<string, ModelPrediction> };
  return body.ok && body.results?.player ? body.results.player : { available: false, code: 'MODEL_FEED_UNAVAILABLE' };
}

const PLAYER_SECTIONS: { id: PlayerSection; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'props', label: 'Props' },
  { id: 'trends', label: 'Trends' },
  { id: 'splits', label: 'Splits' },
];

function readFavourites(): string[] {
  try {
    const raw = localStorage.getItem(FAVOURITES_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function PlayerView() {
  const router = useRouter();
  const params = useSearchParams();
  const sport = params.get('sport') || 'NFL';
  const player = params.get('player') || '';
  const market = params.get('market') || '';
  const period = params.get('period') || 'game';
  const lineParam = Number(params.get('line'));
  const postedLine = Number.isFinite(lineParam) ? lineParam : null;

  const [account, setAccount] = React.useState<{ id: string; email?: string } | null>(null);
  const [checking, setChecking] = React.useState(true);
  const [markets, setMarkets] = React.useState<PropGroup[]>([]);
  const [research, setResearch] = React.useState<ResearchResponse | null>(null);
  const [prediction, setPrediction] = React.useState<ModelPrediction | null>(null);
  const [loadingPrediction, setLoadingPrediction] = React.useState(false);
  const [loadingBoard, setLoadingBoard] = React.useState(true);
  const [loadingResearch, setLoadingResearch] = React.useState(true);
  const [error, setError] = React.useState('');
  const [favourites, setFavourites] = React.useState<string[]>([]);
  const [section, setSection] = React.useState<PlayerSection>('overview');

  React.useEffect(() => {
    const controller = new AbortController();
    fetchAccount(controller.signal)
      .then(setAccount)
      .finally(() => setChecking(false));
    setFavourites(readFavourites());
    return () => controller.abort();
  }, []);

  React.useEffect(() => {
    if (checking || !account || !player) {
      setLoadingBoard(false);
      return;
    }
    const controller = new AbortController();
    setLoadingBoard(true);
    setError('');
    fetchBoard(sport, controller.signal)
      .then((board) => {
        const mine = board.groups.filter((candidate) => candidate.player === player);
        if (!mine.length) setError(`${player} is not on the ${sport} board right now.`);
        setMarkets(mine);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 401) {
          setAccount(null);
          return;
        }
        setError(cause instanceof Error ? cause.message : 'The board is unavailable.');
      })
      .finally(() => setLoadingBoard(false));
    return () => controller.abort();
  }, [checking, account, sport, player]);

  const group = React.useMemo(() => {
    if (!markets.length) return null;
    return (
      markets.find((candidate) =>
        candidate.market === market &&
        candidate.line === postedLine &&
        (candidate.period || 'game') === period
      ) ||
      markets.find((candidate) => candidate.market === market && candidate.line === postedLine) ||
      markets.find((candidate) => candidate.market === market) ||
      markets[0]
    );
  }, [markets, market, period, postedLine]);
  const [state, setState] = React.useState<ExplorerState>({ line: 0, side: 'OVER', book: null });

  React.useEffect(() => {
    if (!group) return;
    setState({ line: group.line, side: 'OVER', book: null });
    setSection('overview');
  }, [group?.key, group?.line]);

  React.useEffect(() => {
    if (!group) { setPrediction(null); return; }
    const controller = new AbortController();
    setLoadingPrediction(true);
    fetchPlayerPrediction(group, controller.signal)
      .then(setPrediction)
      .catch(() => setPrediction({ available: false, code: 'MODEL_FEED_UNAVAILABLE' }))
      .finally(() => setLoadingPrediction(false));
    return () => controller.abort();
  }, [group?.key]);

  React.useEffect(() => {
    if (!group) return;
    const controller = new AbortController();
    setLoadingResearch(true);
    fetchResearch(group, state.side, controller.signal, { detail: true })
      .then(setResearch)
      .catch(() => setResearch(null))
      .finally(() => setLoadingResearch(false));
    return () => controller.abort();
    // The game sample is the same for Over and Under; line/side changes are
    // recalculated client-side so they do not create extra provider requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.key]);

  function selectMarket(next: PropGroup) {
    const search = new URLSearchParams({
      sport: next.sport,
      player: next.player,
      market: next.market,
      line: String(next.line),
      period: next.period || 'game',
    });
    router.replace(`/research?${search}`, { scroll: false });
  }

  function selectSection(next: PlayerSection) {
    setSection(next);
    requestAnimationFrame(() => {
      document.getElementById(`player-${next}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function toggleFavourite(key: string) {
    setFavourites((prev) => {
      const next = prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key];
      try {
        localStorage.setItem(FAVOURITES_KEY, JSON.stringify(next));
      } catch {
        /* a followed prop is a per-device convenience, never required */
      }
      return next;
    });
  }

  if (checking) {
    return (
      <Shell>
        <Skeleton className="mt-4 h-40 rounded-[var(--radius-lg)]" />
      </Shell>
    );
  }
  if (!account) {
    return (
      <Shell>
        <SignInPanel onSignedIn={setAccount} />
      </Shell>
    );
  }
  if (!player) {
    return (
      <Shell>
        <Empty
          title="Pick a prop to research"
          body="Open any card on the board and its markets, history, splits and book prices land here."
        />
      </Shell>
    );
  }
  if (loadingBoard && !group) {
    return (
      <Shell>
        <Skeleton className="mt-4 h-40 rounded-[var(--radius-lg)]" />
        <Skeleton className="mt-4 h-12 rounded-full" />
        <Skeleton className="mt-4 h-[460px] rounded-[var(--radius)]" />
      </Shell>
    );
  }
  if (!group) {
    return (
      <Shell>
        <Empty
          title="That prop is no longer posted"
          body={error || 'The market may have settled or been pulled from the board.'}
        />
      </Shell>
    );
  }

  const club = teamFor(group.team);
  const rawTeam = String(group.team || '').trim();
  const fallbackClubKey = rawTeam.toUpperCase().replace(/[^A-Z]/g, '');
  const teamLabel = rawTeam
    ? (club.name === fallbackClubKey ? rawTeam : club.name)
    : (group.position ? `${group.sport} · ${group.position}` : group.sport);
  const kickoff = shortTime(group.startsAt);
  const games = playedGames(research);
  const favourite = favourites.includes(group.key);

  return (
    <Shell>
      <PlayerSectionNav active={section} onSelect={selectSection} />

      <section id="player-props" className="player-section-anchor player-section-block">
        <div className="player-section-heading">
          <div>
            <span className="player-section-kicker">Prop markets</span>
            <h2>Choose the number you want to research.</h2>
          </div>
          <span className="player-section-count">{markets.length} market{markets.length === 1 ? '' : 's'}</span>
        </div>
        <div className="rail player-market-rail" role="tablist" aria-label="Markets for this player">
          {markets.map((candidate) => {
            const active = candidate.key === group.key;
            return (
              <button
                key={candidate.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => selectMarket(candidate)}
                className={cn(
                  'flex min-h-11 flex-none items-center gap-2 rounded-full border px-4',
                  'text-[length:var(--fs-xs)] font-semibold whitespace-nowrap',
                  'transition-[color,background-color,border-color,transform] duration-200 ease-[var(--ease-out)] active:scale-[.97]',
                  active
                    ? 'border-transparent bg-[var(--accent)] text-[var(--accent-ink)]'
                    : 'border-[var(--line)] bg-[var(--surface)] text-[var(--text-2)] hover:border-[var(--line-strong)] hover:text-[var(--text)]',
                )}
              >
                {marketDisplayLabel(candidate.market, candidate.player, candidate.marketId, candidate.sport)}
                <span className={cn('num', active ? 'opacity-80' : 'text-[var(--text-3)]')}>
                  {candidate.line}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section id="player-trends" className="player-section-anchor player-section-block">
        <div className="player-section-heading">
          <div>
            <span className="player-section-kicker">Interactive research</span>
            <h2>Move the line. Change the side. Recalculate instantly.</h2>
          </div>
          <span className="player-section-count">Verified source fallback</span>
        </div>
        <Reveal>
          <CardPanel className="player-explorer-panel p-4 sm:p-5">
            <div id="player-overview" className="player-research-summary player-section-anchor">
              <span className="player-research-avatar relative flex-none">
                <PlayerAvatar
                  name={group.player}
                  sport={group.sport}
                  team={group.team}
                  providerPlayerId={group.providerPlayerId}
                  size={52}
                />
                {group.team && (
                  <span
                    aria-hidden="true"
                    className="player-research-team-mark"
                    style={{ background: club.c1 }}
                  >
                    {group.team.slice(0, 3)}
                  </span>
                )}
              </span>
              <div className="min-w-0">
                <div className="player-research-name-row">
                  <h1>{group.player}</h1>
                  <span>{group.sport}</span>
                </div>
                <p className="player-research-meta">
                  <span>{teamLabel}</span>
                  <span aria-hidden="true">·</span>
                  <span>{group.matchup}</span>
                  {kickoff && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{kickoff}</span>
                    </>
                  )}
                </p>
              </div>
            </div>
            <ModelSignal group={group} prediction={prediction} loading={loadingPrediction} />
            <PropExplorer
              group={group}
              games={games}
              loading={loadingResearch}
              unavailableReason={
                research && research.available === false
                  ? research.message || 'No verified game log is available for this player and market yet.'
                  : null
              }
              leagueTeams={research?.leagueTeams || []}
              state={state}
              onState={setState}
              favourite={favourite}
              onFavourite={() => toggleFavourite(group.key)}
            />
          </CardPanel>
        </Reveal>

      </section>

      <section id="player-splits" className="player-section-anchor player-section-block">
        <div className="player-section-heading">
          <div>
            <span className="player-section-kicker">Context splits</span>
            <h2>See where the current line has actually worked.</h2>
          </div>
          <span className="player-section-count">{state.side} {state.line}</span>
        </div>
        <SplitSummary
          games={games}
          group={group}
          line={state.line}
          side={state.side}
          loading={loadingResearch}
        />
      </section>

      <section className="player-detail-grid mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,.85fr)] lg:items-start">
        <div className="min-w-0">
          <Reveal>
            <GameLog
              games={games}
              line={state.line}
              market={marketDisplayLabel(group.market, group.player, group.marketId, group.sport)}
              loading={loadingResearch}
            />
          </Reveal>
        </div>
        <div className="min-w-0">
          <Reveal>
            <BookPrices group={group} />
          </Reveal>
        </div>
      </section>
    </Shell>
  );
}

function ModelSignal({ group, prediction, loading }: { group: PropGroup; prediction: ModelPrediction | null; loading: boolean }) {
  if (loading) return <Skeleton className="mt-3 h-[88px] rounded-[var(--radius)]" />;
  const ev: ExpectedValueSelection | null = expectedValueFor(group, prediction || undefined);
  const projection = prediction?.available && Number.isFinite(prediction.projection) ? Number(prediction.projection) : null;
  const over = prediction?.available && Number.isFinite(Number(prediction.probabilityOver)) ? Number(prediction.probabilityOver) : null;
  const under = prediction?.available && Number.isFinite(Number(prediction.probabilityUnder)) ? Number(prediction.probabilityUnder) : null;
  const pct = (value: number | null) => value === null ? '—' : `${(value <= 1 ? value * 100 : value).toFixed(1)}%`;
  const source = ev ? expectedValueSourceLabel(ev) : prediction?.available ? 'Verified model probability' : 'Verified model unavailable';
  return <section className="mt-3 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--surface-2)] p-3" aria-label="Oblige model prediction">
    <div className="flex items-center justify-between gap-3"><div><span className="text-[length:var(--fs-micro)] font-bold uppercase tracking-[.1em] text-[var(--text-3)]">Oblige model</span><div className="mt-1 text-[length:var(--fs-xs)] text-[var(--text-3)]">{source}</div></div>{prediction?.engine ? <span className="text-[length:var(--fs-micro)] text-[var(--text-3)]">{prediction.engine}</span> : null}</div>
    <div className="mt-3 grid grid-cols-4 gap-2 text-center">
      <div><span className="block text-[length:var(--fs-micro)] text-[var(--text-3)]">Projection</span><strong className="num">{projection === null ? '—' : projection.toFixed(1)}</strong></div>
      <div><span className="block text-[length:var(--fs-micro)] text-[var(--text-3)]">Over</span><strong className="num">{pct(over)}</strong></div>
      <div><span className="block text-[length:var(--fs-micro)] text-[var(--text-3)]">Under</span><strong className="num">{pct(under)}</strong></div>
      <div title={ev ? expectedValueSourceLabel(ev) || undefined : undefined}><span className="block text-[length:var(--fs-micro)] text-[var(--text-3)]">Best EV</span><strong className="num" data-positive={ev && ev.ev > 0 ? 'true' : 'false'}>{ev ? `${ev.side === 'OVER' ? 'O' : 'U'} ${ev.ev >= 0 ? '+' : ''}${ev.ev.toFixed(1)}%` : '—'}</strong></div>
    </div>
  </section>;
}

function PlayerSectionNav({
  active,
  onSelect,
}: {
  active: PlayerSection;
  onSelect: (section: PlayerSection) => void;
}) {
  return (
    <nav className="player-section-nav" aria-label="Player analysis sections">
      {PLAYER_SECTIONS.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-pressed={active === item.id}
          onClick={() => onSelect(item.id)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}

function SplitSummary({
  games,
  group,
  line,
  side,
  loading,
}: {
  games: ReturnType<typeof playedGames>;
  group: PropGroup;
  line: number;
  side: Side;
  loading: boolean;
}) {
  if (loading) {
    return <Skeleton className="h-[116px] rounded-[var(--radius)]" />;
  }

  const rows = sortRecentFirst(playable(games));
  const home = computeWindow(rows.filter((game) => game.isHome === true), line, side, 'home', 'Home');
  const away = computeWindow(rows.filter((game) => game.isHome === false), line, side, 'away', 'Away');
  const h2h = headToHead(rows, group.opponent, line, side);
  const splits = [home, away, h2h || computeWindow([], line, side, 'h2h', 'H2H')];

  return (
    <div className="player-split-grid">
      {splits.map((split) => {
        const rate = split.hitRate;
        const tone = rate === null ? 'none' : rate >= 60 ? 'pos' : rate < 45 ? 'neg' : 'mid';
        return (
          <article key={split.id} className="player-split-card" data-tone={tone}>
            <div className="player-split-topline">
              <span>{split.label}</span>
              <span className="num">{split.games ? `${split.hits}/${split.games}` : 'No sample'}</span>
            </div>
            <strong className="num">{rate === null ? '—' : `${rate}%`}</strong>
            <div className="player-split-meta">
              <span>{split.average === null ? 'Average unavailable' : `Avg ${split.average}`}</span>
              {split.id === 'h2h' && group.opponent ? <span>vs {group.opponent}</span> : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const returnToBoard = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }
    router.push('/board');
  };

  return (
    <div className="player-app-shell mx-auto w-full max-w-[var(--maxw)] px-4 pt-5 pb-20 md:px-8">
      <button
        type="button"
        onClick={returnToBoard}
        className="player-back-link inline-flex min-h-10 items-center gap-2 border-0 bg-transparent p-0 text-[length:var(--fs-sm)] text-[var(--text-2)] transition-colors duration-200 ease-[var(--ease-out)] hover:text-[var(--text)]"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Back to board
      </button>
      {children}
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <CardPanel className="mt-4 grid justify-items-center gap-3 py-16 text-center">
      <h1 className="text-[length:var(--fs-md)] normal-case">{title}</h1>
      <p className="max-w-[48ch] text-[length:var(--fs-sm)] text-[var(--text-3)]">{body}</p>
      <Button asChild variant="ghost" size="sm">
        <Link href="/board">Open the board</Link>
      </Button>
    </CardPanel>
  );
}
