'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, TriangleAlert } from 'lucide-react';
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
import { cn, marketDisplayLabel, odds, shortTime } from '@/lib/utils';
import { Badge, Dot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CardPanel } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PlayerAvatar, TeamScene } from '@/components/face-card';
import { BookPrices } from '@/components/book-prices';
import { GameLog } from '@/components/research';
import { PropExplorer, type ExplorerState } from '@/components/prop-explorer';
import { SignInPanel } from '@/components/sign-in';
import { Reveal } from '@/components/motion';
import { PlayerPropDeepDive } from '@/components/player-prop-deep-dive';

const FAVOURITES_KEY = 'oblige-followed';

type PlayerSection = 'overview' | 'props' | 'trends' | 'splits';

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
  const kickoff = shortTime(group.startsAt);
  const games = playedGames(research);
  const favourite = favourites.includes(group.key);

  return (
    <Shell>
      <PlayerPropDeepDive
        group={group}
        markets={markets}
        research={research}
        loading={loadingResearch}
        state={state}
        onState={setState}
        favourite={favourite}
        onFavourite={() => toggleFavourite(group.key)}
        onMarket={selectMarket}
        fullResearch={
          <>
            <CardPanel className="player-explorer-panel p-3 sm:p-4">
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

            {research?.available === false && !loadingResearch ? (
              <p className="flex items-start gap-2 rounded-[var(--radius)] border border-[color-mix(in_srgb,var(--warn)_36%,transparent)] bg-[color-mix(in_srgb,var(--warn)_8%,transparent)] p-3 text-[length:var(--fs-sm)] text-[var(--warn)]">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {research.message || 'No verified history is available for this player and market yet.'}
              </p>
            ) : null}

            <SplitSummary
              games={games}
              group={group}
              line={state.line}
              side={state.side}
              loading={loadingResearch}
            />

            <section className="player-detail-grid grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,.85fr)] lg:items-start">
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
          </>
        }
      />
    </Shell>
  );

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
