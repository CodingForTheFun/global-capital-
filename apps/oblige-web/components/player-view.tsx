'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ChevronLeft, TriangleAlert } from 'lucide-react';
import type { PropGroup, ResearchResponse, Side } from '@/lib/types';
import { ApiError, fetchAccount, fetchBoard, fetchResearch, playedGames } from '@/lib/api';
import { teamFor } from '@/lib/teams';
import { cn, shortTime } from '@/lib/utils';
import { Badge, Dot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CardPanel } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PlayerAvatar, TeamScene } from '@/components/face-card';
import { BookPrices } from '@/components/book-prices';
import { GameLog, PropChart, Splits, StatStrip } from '@/components/research';
import { SignInPanel } from '@/components/sign-in';
import { Reveal } from '@/components/motion';

/**
 * One player's full picture: who they are, the market being researched, the
 * history behind the number and every book pricing it.
 *
 * The player is addressed entirely through the URL, so a card on the board, a
 * bookmark and a link someone pastes into a chat all open the same page.
 */
export function PlayerView() {
  const params = useSearchParams();
  const sport = params.get('sport') || 'NFL';
  const player = params.get('player') || '';
  const market = params.get('market') || '';
  const lineParam = Number(params.get('line'));
  const line = Number.isFinite(lineParam) ? lineParam : null;

  const [account, setAccount] = React.useState<{ id: string; email?: string } | null>(null);
  const [checking, setChecking] = React.useState(true);
  const [group, setGroup] = React.useState<PropGroup | null>(null);
  const [research, setResearch] = React.useState<ResearchResponse | null>(null);
  const [side, setSide] = React.useState<Side>('OVER');
  const [loadingBoard, setLoadingBoard] = React.useState(true);
  const [loadingResearch, setLoadingResearch] = React.useState(true);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    const controller = new AbortController();
    fetchAccount(controller.signal)
      .then(setAccount)
      .finally(() => setChecking(false));
    return () => controller.abort();
  }, []);

  /* The board carries the quotes, so it is what turns a URL back into a prop. */
  React.useEffect(() => {
    if (checking || !account || !player || !market || line === null) {
      setLoadingBoard(false);
      return;
    }
    const controller = new AbortController();
    setLoadingBoard(true);
    setError('');
    fetchBoard(sport, controller.signal)
      .then((board) => {
        const found =
          board.groups.find(
            (candidate) =>
              candidate.player === player &&
              candidate.market === market &&
              candidate.line === line,
          ) || board.groups.find((candidate) => candidate.player === player) || null;
        if (!found) setError(`${player} is not on the ${sport} board right now.`);
        setGroup(found);
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
  }, [checking, account, sport, player, market, line]);

  React.useEffect(() => {
    if (!group) return;
    const controller = new AbortController();
    setLoadingResearch(true);
    fetchResearch(group, side, controller.signal)
      .then(setResearch)
      .catch(() => setResearch(null))
      .finally(() => setLoadingResearch(false));
    return () => controller.abort();
  }, [group, side]);

  if (checking) {
    return (
      <Shell>
        <Skeleton className="h-36 rounded-[var(--radius-lg)]" />
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

  if (!player || !market || line === null) {
    return (
      <Shell>
        <Empty
          title="Pick a prop to research"
          body="Open any card on the board and its full history, splits and book prices land here."
        />
      </Shell>
    );
  }

  if (loadingBoard && !group) {
    return (
      <Shell>
        <Skeleton className="h-36 rounded-[var(--radius-lg)]" />
        <div className="mt-4 grid grid-cols-4 gap-2 md:grid-cols-7">
          {Array.from({ length: 7 }).map((_, index) => (
            <Skeleton key={index} className="h-20 rounded-[var(--radius)]" />
          ))}
        </div>
        <Skeleton className="mt-4 h-[300px] rounded-[var(--radius)]" />
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
  const games = playedGames(research);
  const kickoff = shortTime(group.startsAt);

  return (
    <Shell>
      {/* identity */}
      <Reveal>
        <div className="face mt-4 grid items-center gap-4 p-5 md:grid-cols-[auto_minmax(0,1fr)_auto] md:p-6">
          <TeamScene team={group.team} tall />
          <PlayerAvatar
            name={group.player}
            sport={group.sport}
            team={group.team}
            providerPlayerId={group.providerPlayerId}
            size={84}
            className="row-start-1"
          />
          <div className="col-start-2 row-start-1 min-w-0">
            <h1
              className="text-[length:var(--fs-xl)] text-balance sm:text-[length:var(--fs-2xl)]"
              style={{ textTransform: 'var(--display-case)' as 'none' }}
            >
              {group.player}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[length:var(--fs-xs)] text-[var(--text-3)] sm:text-[length:var(--fs-sm)]">
              <Badge>{group.sport}</Badge>
              <span className="truncate">{club.name}</span>
              <span aria-hidden="true">·</span>
              <span className="truncate">{group.matchup}</span>
              {kickoff && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{kickoff}</span>
                </>
              )}
              {group.live && (
                <Badge variant="live">
                  <Dot pulse />
                  Live
                </Badge>
              )}
            </div>
          </div>
          <div className="col-span-full flex flex-wrap items-baseline gap-2 border-t border-[var(--line)] pt-4 md:col-start-3 md:row-start-1 md:grid md:justify-items-end md:gap-1 md:border-0 md:pt-0 md:text-right">
            <span className="text-[length:var(--fs-micro)] uppercase tracking-[.1em] text-[var(--text-3)]">
              {group.market}
            </span>
            <span className="num text-[length:var(--fs-2xl)] font-bold tracking-tight">{group.line}</span>
          </div>
        </div>
      </Reveal>

      {/* which side is being judged */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Side"
          className="flex overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-[var(--surface-2)]"
        >
          {(['OVER', 'UNDER'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={side === option}
              onClick={() => setSide(option)}
              className={cn(
                'min-h-11 px-5 text-[length:var(--fs-sm)] font-bold tracking-wide',
                'transition-[color,background-color,box-shadow] duration-200 ease-[var(--ease-out)]',
                'first:border-r first:border-[var(--line)]',
                side !== option && 'text-[var(--text-3)] hover:text-[var(--text)]',
                side === option && option === 'OVER' &&
                  'text-[var(--pos)] bg-[color-mix(in_srgb,var(--pos)_14%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--pos)_55%,transparent)]',
                side === option && option === 'UNDER' &&
                  'text-[var(--neg)] bg-[color-mix(in_srgb,var(--neg)_14%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--neg)_55%,transparent)]',
              )}
            >
              {option}
            </button>
          ))}
        </div>
        <span className="text-[length:var(--fs-xs)] text-[var(--text-3)]">
          Every number below is read against {side.toLowerCase()} {group.line}.
        </span>
      </div>

      {research && research.available === false && !loadingResearch && (
        <p className="mt-4 flex items-start gap-2 rounded-[var(--radius)] border border-[color-mix(in_srgb,var(--warn)_36%,transparent)] bg-[color-mix(in_srgb,var(--warn)_8%,transparent)] p-3 text-[length:var(--fs-sm)] text-[var(--warn)]">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {research.message || 'No verified history is available for this player and market yet.'}
        </p>
      )}

      <StatStrip research={research} line={group.line} loading={loadingResearch} />

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,.8fr)] lg:items-start">
        <div className="min-w-0">
          <Reveal>
            <PropChart
              games={games}
              line={group.line}
              side={side}
              market={group.market}
              loading={loadingResearch}
            />
          </Reveal>
          <Reveal delay={60}>
            <GameLog games={games} line={group.line} market={group.market} loading={loadingResearch} />
          </Reveal>
        </div>
        <div className="min-w-0">
          <Reveal>
            <BookPrices group={group} />
          </Reveal>
          <Reveal delay={60}>
            <Splits research={research} />
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
