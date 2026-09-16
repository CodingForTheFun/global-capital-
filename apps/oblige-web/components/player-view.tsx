'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, TriangleAlert } from 'lucide-react';
import type { PropGroup, ResearchResponse } from '@/lib/types';
import {
  ApiError,
  fetchAccount,
  fetchBoard,
  fetchLineHistory,
  fetchResearch,
  playedGames,
} from '@/lib/api';
import { teamFor } from '@/lib/teams';
import { cn, shortTime, signed } from '@/lib/utils';
import { Badge, Dot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CardPanel, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PlayerAvatar } from '@/components/face-card';
import { BookPrices } from '@/components/book-prices';
import { GameLog, PropChart, Splits, StatStrip } from '@/components/research';
import { PropExplorer, type ExplorerState } from '@/components/prop-explorer';
import { SignInPanel } from '@/components/sign-in';
import { Reveal } from '@/components/motion';

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
  const [lineHistory, setLineHistory] = React.useState<Awaited<ReturnType<typeof fetchLineHistory>>>([]);
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
    // Research samples are the same games for either side. The selected side
    // changes the local reading of those games without spending another request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.key, derived]);

  React.useEffect(() => {
    if (!group?.propId) {
      setLineHistory([]);
      return;
    }
    const controller = new AbortController();
    fetchLineHistory(group.propId, controller.signal)
      .then(setLineHistory)
      .catch(() => setLineHistory([]));
    return () => controller.abort();
  }, [group?.propId]);

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
        /* following a prop is a convenience, not a rendering dependency */
      }
      return next;
    });
  }

  if (checking) {
    return (
      <Shell>
        <Skeleton className="mt-4 h-32 rounded-[var(--radius-lg)]" />
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
        <Skeleton className="mt-4 h-32 rounded-[var(--radius-lg)]" />
        <div className="mt-4 grid grid-cols-4 gap-2 md:grid-cols-7">
          {Array.from({ length: 7 }).map((_, index) => (
            <Skeleton key={index} className="h-20 rounded-[var(--radius)]" />
          ))}
        </div>
        <Skeleton className="mt-4 h-[420px] rounded-[var(--radius)]" />
      </Shell>
    );
  }
  if (!group) {
    return (
      <Shell>
        <Empty title="That prop is no longer posted" body={error || 'The market may have settled or been pulled.'} />
      </Shell>
    );
  }

  const club = teamFor(group.team);
  const kickoff = shortTime(group.startsAt);
  const games = playedGames(research);
  const favourite = favourites.includes(group.key);
  const displayLine = state.line === 0 && group.line !== 0 ? group.line : state.line;
  const movement = [...lineHistory]
    .map((point) => ({
      line: Number(point.line),
      time: point.recordedAt || point.capturedAt || '',
      book: point.bookmakerKey || '',
    }))
    .filter((point) => Number.isFinite(point.line))
    .sort((a, b) => Date.parse(a.time || '1970-01-01') - Date.parse(b.time || '1970-01-01'));
  const openLine = movement.length ? movement[0].line : null;
  const lineDelta = openLine === null ? null : displayLine - openLine;

  return (
    <Shell>
      <Reveal>
        <CardPanel className="mt-4 p-5 sm:p-6">
          <div className="grid items-center gap-5 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
            <PlayerAvatar
              name={group.player}
              sport={group.sport}
              team={group.team}
              providerPlayerId={group.providerPlayerId}
              size={78}
            />

            <div className="min-w-0">
              <h1 className="font-display text-[length:var(--fs-2xl)] tracking-tight normal-case">
                {group.player}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[length:var(--fs-sm)] text-[var(--text-3)]">
                <Badge>{group.sport}</Badge>
                {group.team && <span>{group.team}</span>}
                {group.team && <span aria-hidden="true">·</span>}
                <span>{group.matchup}</span>
                {kickoff && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{kickoff}</span>
                  </>
                )}
                {group.live && (
                  <Badge variant="live">
                    <Dot pulse /> Live
                  </Badge>
                )}
              </div>
            </div>

            <div className="border-t border-[var(--line)] pt-4 text-left sm:border-0 sm:pt-0 sm:text-right">
              <div className="text-[length:var(--fs-micro)] font-medium uppercase tracking-[.14em] text-[var(--text-3)]">
                {group.market}
              </div>
              <div className="num mt-1 text-[length:var(--fs-2xl)] font-bold tracking-tight">{displayLine}</div>
              {lineDelta !== null && lineDelta !== 0 && (
                <div className={cn('num mt-1 text-[length:var(--fs-xs)]', lineDelta > 0 ? 'text-[var(--pos)]' : 'text-[var(--neg)]')}>
                  {lineDelta > 0 ? '▲' : '▼'} {Math.abs(lineDelta).toFixed(1)} since open
                </div>
              )}
            </div>
          </div>
        </CardPanel>
      </Reveal>

      <StatStrip research={research} line={displayLine} loading={loadingResearch && !derived} />

      {research?.available === false && !derived && !loadingResearch && (
        <p className="mt-4 flex items-start gap-2 rounded-[var(--radius)] border border-[color-mix(in_srgb,var(--warn)_36%,transparent)] bg-[color-mix(in_srgb,var(--warn)_8%,transparent)] p-3 text-[length:var(--fs-sm)] text-[var(--warn)]">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {research.message || 'No verified history is available for this player and market yet.'}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(330px,.95fr)] lg:items-start">
        <div className="min-w-0">
          <Reveal>
            <PropChart
              games={games}
              line={displayLine}
              side={state.side}
              market={group.market}
              loading={loadingResearch && !derived}
            />
          </Reveal>
          <Reveal delay={60}>
            <GameLog
              games={games}
              line={displayLine}
              market={group.market}
              loading={loadingResearch && !derived}
            />
          </Reveal>
        </div>

        <div className="min-w-0">
          <Reveal>
            <BookPrices group={group} />
          </Reveal>
          <Reveal delay={60}>
            <LineMovement points={movement} currentLine={displayLine} />
          </Reveal>
          <Reveal delay={100}>
            <Splits research={research} />
          </Reveal>
        </div>
      </div>

      <Reveal>
        <CardPanel className="mt-4 p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[length:var(--fs-lg)] tracking-tight normal-case">Research controls</h2>
              <p className="mt-1 text-[length:var(--fs-xs)] text-[var(--text-3)]">
                Adjust the line, side, sportsbook and filters without changing the verified sample.
              </p>
            </div>
          </div>

          {markets.length > 1 && (
            <div className="rail mb-4" role="tablist" aria-label="Markets for this player">
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
                      'flex min-h-10 flex-none items-center gap-2 rounded-full border px-4',
                      'text-[length:var(--fs-xs)] font-semibold whitespace-nowrap',
                      active
                        ? 'border-transparent bg-[var(--accent)] text-[var(--accent-ink)]'
                        : 'border-[var(--line)] bg-[var(--surface)] text-[var(--text-2)]',
                    )}
                  >
                    {candidate.market}
                    <span className="num opacity-75">{candidate.line}</span>
                  </button>
                );
              })}
            </div>
          )}

          <PropExplorer
            group={group}
            games={games}
            loading={loadingResearch}
            unavailableReason={
              derived
                ? 'This market cannot be rebuilt honestly from a full-game box score, so Oblige keeps the live price but does not invent historical results.'
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
    </Shell>
  );
}

function LineMovement({
  points,
  currentLine,
}: {
  points: { line: number; time: string; book: string }[];
  currentLine: number;
}) {
  const shown = points.slice(-6).reverse();
  return (
    <CardPanel className="mt-4">
      <CardHeader>
        <CardTitle>Line movement</CardTitle>
        <span className="text-[length:var(--fs-xs)] text-[var(--text-3)]">Since open</span>
      </CardHeader>
      {!shown.length ? (
        <p className="py-7 text-center text-[length:var(--fs-sm)] text-[var(--text-3)]">
          No verified line history is available for this prop yet.
        </p>
      ) : (
        <div className="grid gap-2">
          {shown.map((point, index) => {
            const label = index === shown.length - 1 ? 'Open' : index === 0 ? 'Latest' : 'Move';
            const when = point.time ? shortTime(point.time) : '';
            const delta = point.line - currentLine;
            return (
              <div
                key={`${point.time}-${point.line}-${index}`}
                className="flex items-center justify-between gap-4 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)] px-3 py-3"
              >
                <div className="min-w-0 text-[length:var(--fs-xs)] text-[var(--text-3)]">
                  <span>{label}</span>
                  {when && <span> · {when}</span>}
                  {point.book && <span> · {point.book}</span>}
                </div>
                <div className="num shrink-0 font-semibold">
                  {point.line}
                  {delta !== 0 && (
                    <span className={cn('ml-2 text-[length:var(--fs-micro)]', delta < 0 ? 'text-[var(--pos)]' : 'text-[var(--neg)]')}>
                      {signed(point.line - currentLine)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </CardPanel>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[var(--maxw)] px-4 pt-4 pb-16 md:px-8">
      <Link
        href="/board"
        className="inline-flex min-h-9 items-center gap-2 text-[length:var(--fs-xs)] text-[var(--text-3)] transition-colors duration-200 hover:text-[var(--text)]"
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
