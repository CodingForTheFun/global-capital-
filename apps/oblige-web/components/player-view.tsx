'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, TriangleAlert } from 'lucide-react';
import type { PropGroup, ResearchResponse } from '@/lib/types';
import { ApiError, fetchAccount, fetchBoard, fetchResearch, playedGames } from '@/lib/api';
import { teamFor } from '@/lib/teams';
import type { Side } from '@/lib/analytics';
import { cn, odds, shortTime } from '@/lib/utils';
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

/**
 * A market whose number cannot honestly be rebuilt from a full-game box score.
 * The backend refuses to derive these (lib/data-sources/espn/stat-contract.mjs),
 * so they are priced live and carry no history — and this page says so rather
 * than showing an empty chart and letting the reader assume a provider outage.
 */
const DERIVED_MARKET =
  /(?:\b(?:1q|2q|3q|4q|1h|2h)\b)|quarter|first half|second half|first inning|1st inning|fantasy/i;

const FAVOURITES_KEY = 'oblige-followed';

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

  React.useEffect(() => {
    const controller = new AbortController();
    fetchAccount(controller.signal)
      .then(setAccount)
      .finally(() => setChecking(false));
    setFavourites(readFavourites());
    return () => controller.abort();
  }, []);

  /* The board carries the quotes, so it is what turns a URL back into a prop —
     and it also carries every other market this player has posted, which is
     what the market tabs are built from. */
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
      markets.find((candidate) => candidate.market === market && candidate.line === postedLine) ||
      markets.find((candidate) => candidate.market === market) ||
      markets[0]
    );
  }, [markets, market, postedLine]);

  const derived = group ? DERIVED_MARKET.test(group.market) : false;

  const [state, setState] = React.useState<ExplorerState>({ line: 0, side: 'OVER', book: null });

  // A new market is a new line, a new book list and a fresh reading.
  React.useEffect(() => {
    if (!group) return;
    setState({ line: group.line, side: 'OVER', book: null });
  }, [group?.key, group?.line]);

  React.useEffect(() => {
    if (!group) return;
    if (derived) {
      setResearch(null);
      setLoadingResearch(false);
      return;
    }
    const controller = new AbortController();
    setLoadingResearch(true);
    fetchResearch(group, state.side, controller.signal)
      .then(setResearch)
      .catch(() => setResearch(null))
      .finally(() => setLoadingResearch(false));
    return () => controller.abort();
    // The side is part of the request, but the sample it returns is the same
    // set of games either way, so only the group drives a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.key, derived]);

  function selectMarket(next: PropGroup) {
    const search = new URLSearchParams({
      sport: next.sport,
      player: next.player,
      market: next.market,
      line: String(next.line),
    });
    router.replace(`/research?${search}`, { scroll: false });
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
      {/* ---------------------------------------------------------- hero */}
      <Reveal>
        <div className="face mt-4 p-5 md:p-6">
          <TeamScene team={group.team} tall />
          <div className="flex flex-wrap items-center gap-4">
            <span className="relative flex-none">
              <PlayerAvatar
                name={group.player}
                sport={group.sport}
                team={group.team}
                providerPlayerId={group.providerPlayerId}
                size={76}
              />
              {/* the club badge, in that club's own colour */}
              <span
                aria-hidden="true"
                className="absolute -right-1 -bottom-1 grid size-7 place-items-center rounded-full border-2 border-[var(--face-1)] text-[9px] font-extrabold text-white"
                style={{ background: club.c1 }}
              >
                {(group.team || '—').slice(0, 3)}
              </span>
            </span>

            <div className="min-w-0 flex-1">
              <h1
                className="text-[length:var(--fs-xl)] text-balance sm:text-[length:var(--fs-2xl)]"
                style={{ textTransform: 'var(--display-case)' as 'none' }}
              >
                {group.player}
              </h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[length:var(--fs-xs)] text-[var(--face-text-2)] sm:text-[length:var(--fs-sm)]">
                <span className="truncate font-semibold">{club.name}</span>
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

            <div className="flex items-center gap-2">
              {group.live && (
                <Badge variant="live" size="md">
                  <Dot pulse />
                  Live
                </Badge>
              )}
              <Badge size="md">{group.sport}</Badge>
            </div>
          </div>

          {/* best price on the board, at a glance */}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-[var(--face-line)] bg-[color-mix(in_srgb,var(--face-1)_72%,transparent)] p-4">
            <div className="min-w-0">
              <p className="truncate text-[length:var(--fs-sm)] font-semibold">{group.market}</p>
              <p className="text-[length:var(--fs-micro)] text-[var(--face-text-3)]">
                Best of {new Set(group.quotes.map((q) => q.sportsbookKey || q.sportsbook)).size} books
              </p>
            </div>
            <div className="flex items-center gap-4">
              <span className="num text-[length:var(--fs-2xl)] font-bold tracking-tight">
                {group.line}
              </span>
              <span className="grid gap-1 text-right">
                <span className="num text-[length:var(--fs-sm)] font-semibold text-[var(--face-pos)]">
                  O {odds(group.bestOver?.price)}
                </span>
                <span className="num text-[length:var(--fs-sm)] font-semibold text-[var(--face-neg)]">
                  U {odds(group.bestUnder?.price)}
                </span>
              </span>
            </div>
          </div>
        </div>
      </Reveal>

      {/* --------------------------------------------------- market tabs */}
      {markets.length > 1 && (
        <div className="mt-4">
          <div className="rail" role="tablist" aria-label="Markets for this player">
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
                  {candidate.market}
                  <span className={cn('num', active ? 'opacity-80' : 'text-[var(--text-3)]')}>
                    {candidate.line}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ----------------------------------------------------- explorer */}
      <Reveal>
        <CardPanel className="mt-4 p-4 sm:p-5">
          <h2 className="mb-4 text-[length:var(--fs-lg)] tracking-tight normal-case">
            {group.market}
          </h2>
          <PropExplorer
            group={group}
            games={games}
            loading={loadingResearch}
            unavailableReason={
              derived
                ? 'A first-half, quarter or fantasy-score number cannot be rebuilt from a full-game box score, so Oblige does not try. This market is priced live, and every book above is real — there is simply no verified history behind it.'
                : research && research.available === false
                  ? research.message || 'No verified game log is available for this player and market yet.'
                  : null
            }
            state={state}
            onState={setState}
            favourite={favourite}
            onFavourite={() => toggleFavourite(group.key)}
          />
        </CardPanel>
      </Reveal>

      {research?.available === false && !derived && !loadingResearch && (
        <p className="mt-4 flex items-start gap-2 rounded-[var(--radius)] border border-[color-mix(in_srgb,var(--warn)_36%,transparent)] bg-[color-mix(in_srgb,var(--warn)_8%,transparent)] p-3 text-[length:var(--fs-sm)] text-[var(--warn)]">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {research.message || 'No verified history is available for this player and market yet.'}
        </p>
      )}

      {/* ------------------------------------------------ detail columns */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,.8fr)] lg:items-start">
        <div className="min-w-0">
          <Reveal>
            <GameLog
              games={games}
              line={state.line}
              market={group.market}
              loading={loadingResearch && !derived}
            />
          </Reveal>
        </div>
        <div className="min-w-0">
          <Reveal>
            <BookPrices group={group} />
          </Reveal>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[var(--maxw)] px-4 pt-6 pb-16 md:px-8">
      <Link
        href="/board"
        className="inline-flex min-h-10 items-center gap-2 text-[length:var(--fs-sm)] text-[var(--text-2)] transition-colors duration-200 ease-[var(--ease-out)] hover:text-[var(--text)]"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Back to board
      </Link>
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
