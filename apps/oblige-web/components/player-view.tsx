'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import type { PropGroup, ResearchResponse } from '@/lib/types';
import { ApiError, fetchAccount, fetchBoard, fetchResearch, playedGames } from '@/lib/api';
import { computeWindow, headToHead, playable, sortRecentFirst, type Side } from '@/lib/analytics';
import { researchHref, playerMarkets, selectedProp, optionalNumber, bookKey, historyMessage } from '@/lib/prop-route';
import { teamFor } from '@/lib/teams';
import { cn, odds, shortTime } from '@/lib/utils';
import { Badge, Dot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CardPanel } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PlayerAvatar, TeamScene } from '@/components/face-card';
import { BookPrices } from '@/components/book-prices';
import { GameLog } from '@/components/research';
import { PropExplorer, type ExplorerState } from '@/components/prop-explorer';
import { PropModelContext } from '@/components/prop-model-context';
import { SignInPanel } from '@/components/sign-in';
import { Reveal } from '@/components/motion';

const FAVOURITES_KEY = 'oblige-followed';
type PlayerSection = 'overview' | 'props' | 'trends' | 'splits';
const PLAYER_SECTIONS: { id: PlayerSection; label: string }[] = [{ id: 'overview', label: 'Overview' }, { id: 'props', label: 'Props' }, { id: 'trends', label: 'Trends' }, { id: 'splits', label: 'Splits' }];
function readFavourites(): string[] {
  try { const parsed: unknown = JSON.parse(localStorage.getItem(FAVOURITES_KEY) || '[]'); return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []; } catch { return []; }
}

export function PlayerView() {
  const router = useRouter(), params = useSearchParams();
  const sport = params.get('sport') || 'NFL', player = params.get('player') || '';
  const playerId = params.get('providerPlayerId') || '', eventId = params.get('eventId') || '', startsAt = params.get('gameStartTime') || '';
  const scopeKey = JSON.stringify([sport, player, playerId, eventId, startsAt]);
  const [account, setAccount] = React.useState<{ id: string; email?: string } | null>(null);
  const [checking, setChecking] = React.useState(true);
  const [board, setBoard] = React.useState<{ scope: string; groups: PropGroup[] }>({ scope: '', groups: [] });
  const [researchResult, setResearchResult] = React.useState<{ key: string; data: ResearchResponse | null }>({ key: '', data: null });
  const [loadingBoard, setLoadingBoard] = React.useState(true);
  const [loadingResearch, setLoadingResearch] = React.useState(true);
  const [error, setError] = React.useState('');
  const [researchError, setResearchError] = React.useState('');
  const [retry, setRetry] = React.useState(0);
  const [favourites, setFavourites] = React.useState<string[]>([]);
  const [section, setSection] = React.useState<PlayerSection>('overview');
  const [state, setState] = React.useState<ExplorerState>({ line: 0, side: 'OVER', book: null });
  const requestedSide: Side = params.get('side') === 'UNDER' ? 'UNDER' : 'OVER';
  const requestedBook = (params.get('book') || '').toLowerCase() || null;
  const researchLine = optionalNumber(params.get('researchLine'));

  React.useEffect(() => {
    const controller = new AbortController();
    fetchAccount(controller.signal).then((value) => { if (!controller.signal.aborted) setAccount(value); }).finally(() => { if (!controller.signal.aborted) setChecking(false); });
    setFavourites(readFavourites());
    return () => controller.abort();
  }, []);
  React.useEffect(() => {
    if (checking || !account || !player) { setLoadingBoard(false); return; }
    const controller = new AbortController();
    setLoadingBoard(true); setError('');
    fetchBoard(sport, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      setBoard({ scope: scopeKey, groups: value.groups });
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof ApiError && cause.status === 401) { setAccount(null); return; }
      setError(cause instanceof Error ? cause.message : 'The board is unavailable.');
      setBoard({ scope: scopeKey, groups: [] });
    }).finally(() => { if (!controller.signal.aborted) setLoadingBoard(false); });
    return () => controller.abort();
  }, [checking, account, sport, player, scopeKey]);
  const markets = React.useMemo(() => board.scope === scopeKey ? playerMarkets(board.groups, params) : [], [board, scopeKey, params]);
  const group = React.useMemo(() => selectedProp(markets, params), [markets, params]);
  const requestedBookAvailable = !requestedBook || Boolean(group?.quotes.some((quote) => bookKey(quote).toLowerCase() === requestedBook));
  React.useEffect(() => {
    if (!group) return;
    setState({ line: researchLine ?? group.line, side: requestedSide, book: requestedBookAvailable ? requestedBook : null });
  }, [group?.key, group?.line, researchLine, requestedSide, requestedBook, requestedBookAvailable]);
  React.useEffect(() => { setSection('overview'); }, [group?.key]);
  React.useEffect(() => {
    if (!group) return;
    const controller = new AbortController();
    setLoadingResearch(true); setResearchError('');
    setResearchResult({ key: group.key, data: null });
    // Raw results are independent of the selected line/side. Recalculate the
    // same verified sample locally; switching controls does not widen polling.
    fetchResearch(group, 'OVER', controller.signal).then((data) => {
      if (!controller.signal.aborted) setResearchResult({ key: group.key, data });
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof ApiError && cause.status === 401) { setAccount(null); return; }
      setResearchError(cause instanceof Error ? cause.message : 'Historical research could not load.');
    }).finally(() => { if (!controller.signal.aborted) setLoadingResearch(false); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.key, retry]);
  const research = group && researchResult.key === group.key ? researchResult.data : null;
  const games = research?.available === false ? [] : playedGames(research);
  const historyPending = loadingResearch || Boolean(group && researchResult.key !== group.key);
  const unavailableReason = historyPending ? null : historyMessage(researchError || (research?.available === false ? research.message : null)) || (!games.length ? 'No verified completed-game values were returned for this exact market. Live offers remain available below.' : null);
  function selectMarket(next: PropGroup) { router.replace(researchHref(next, state.side, state.book), { scroll: false }); }
  function updateState(next: ExplorerState) {
    setState(next);
    const query = new URLSearchParams(params.toString());
    query.set('side', next.side);
    if (next.book) query.set('book', next.book); else query.delete('book');
    if (group && next.line !== group.line) query.set('researchLine', String(next.line)); else query.delete('researchLine');
    router.replace(`/research?${query}`, { scroll: false });
  }
  function selectSection(next: PlayerSection) { setSection(next); requestAnimationFrame(() => document.getElementById(`player-${next}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }
  function toggleFavourite(key: string) {
    setFavourites((previous) => { const next = previous.includes(key) ? previous.filter((item) => item !== key) : [...previous, key]; try { localStorage.setItem(FAVOURITES_KEY, JSON.stringify(next)); } catch {} return next; });
  }
  if (checking) return <Shell><Skeleton className="mt-4 h-40 rounded-[var(--radius-lg)]" /></Shell>;
  if (!account) return <Shell><SignInPanel onSignedIn={setAccount} /></Shell>;
  if (!player) return <Shell><Empty title="Pick a prop to research" body="Open a prop on the board to see its markets, history and book prices here." /></Shell>;
  if ((loadingBoard || board.scope !== scopeKey) && !group) return <Shell><Skeleton className="mt-4 h-40 rounded-[var(--radius-lg)]" /><Skeleton className="mt-4 h-[460px] rounded-[var(--radius)]" /></Shell>;
  if (!group) return <Shell><Empty title="That exact prop is no longer posted" body={error || 'The selected line may have moved, settled or been removed. Return to the board to choose a current offer; no different market has been substituted.'} /></Shell>;
  const club = teamFor(group.team), kickoff = shortTime(group.startsAt), favourite = favourites.includes(group.key);
  const canShowSplits = !unavailableReason && games.length > 0;
  return <Shell>
    <section id="player-overview" className="player-section-anchor"><Reveal><div className="face player-cinematic-hero mt-4 p-5 md:p-6">
      <TeamScene team={group.team} tall />
      <div className="player-identity-row flex flex-wrap items-center gap-4"><span className="relative flex-none"><PlayerAvatar name={group.player} sport={group.sport} team={group.team} providerPlayerId={group.providerPlayerId} size={82} /></span><div className="min-w-0 flex-1"><div className="mb-2 flex flex-wrap items-center gap-2"><Badge size="md">{group.sport}</Badge>{group.live && <Badge variant="live" size="md"><Dot pulse />Live</Badge>}</div><h1 className="text-[length:var(--fs-xl)] text-balance sm:text-[length:var(--fs-2xl)]" style={{ textTransform: 'var(--display-case)' as 'none' }}>{group.player}</h1><p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[length:var(--fs-xs)] text-[var(--face-text-2)] sm:text-[length:var(--fs-sm)]"><span className="truncate font-semibold">{group.team ? club.name : group.sport}</span><span aria-hidden="true">·</span><span>{group.matchup}</span>{kickoff && <><span aria-hidden="true">·</span><span>{kickoff}</span></>}</p></div></div>
      <div className="player-line-glance mt-5 grid gap-3 rounded-[var(--radius)] border border-[var(--face-line)] p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div className="min-w-0"><p className="truncate text-[length:var(--fs-sm)] font-semibold">{group.market}</p><p className="mt-1 text-[length:var(--fs-micro)] text-[var(--face-text-3)]">{new Set(group.quotes.map((quote) => bookKey(quote)).filter(Boolean)).size} books · Posted line</p></div><div className="flex items-center justify-between gap-5 sm:justify-end"><span className="num text-[length:var(--fs-2xl)] font-bold tracking-tight">{group.line}</span><span className="grid gap-1 text-right"><span className="num text-[length:var(--fs-sm)] font-semibold text-[var(--face-pos)]">O {odds(group.bestOver?.price)}</span><span className="num text-[length:var(--fs-sm)] font-semibold text-[var(--face-neg)]">U {odds(group.bestUnder?.price)}</span></span></div></div>
    </div></Reveal></section>
    <nav className="player-section-nav" aria-label="Player analysis sections">{PLAYER_SECTIONS.filter((item) => item.id !== 'splits' || canShowSplits).map((item) => <button key={item.id} type="button" aria-pressed={section === item.id} onClick={() => selectSection(item.id)}>{item.label}</button>)}</nav>
    <section id="player-props" className="player-section-anchor player-section-block"><div className="player-section-heading"><div><span className="player-section-kicker">Prop markets</span><h2>Choose the number you want to research.</h2></div><span className="player-section-count">{markets.length} posted lines</span></div><div className="rail player-market-rail" role="tablist" aria-label="Markets for this player and event">{markets.map((candidate) => <button key={candidate.key} type="button" role="tab" aria-selected={candidate.key === group.key} onClick={() => selectMarket(candidate)} className={cn('flex min-h-11 flex-none items-center gap-2 rounded-full border px-4 text-[length:var(--fs-xs)] font-semibold whitespace-nowrap', candidate.key === group.key ? 'border-transparent bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--surface)] text-[var(--text-2)]')}>{candidate.market}<span className="num">{candidate.line}</span></button>)}</div></section>
    <section id="player-trends" className="player-section-anchor player-section-block"><div className="player-section-heading"><div><span className="player-section-kicker">Interactive research</span><h2>Move the line. Change the side. Recalculate instantly.</h2></div></div><Reveal><CardPanel className="player-explorer-panel p-4 sm:p-5"><PropExplorer group={group} games={games} loading={historyPending} unavailableReason={unavailableReason} state={state} onState={updateState} favourite={favourite} onFavourite={() => toggleFavourite(group.key)} />{researchError && !historyPending && <Button type="button" variant="ghost" size="sm" onClick={() => setRetry((value) => value + 1)}>Retry history request</Button>}</CardPanel></Reveal></section>
    {!requestedBookAvailable && <p className="mt-3 text-sm text-[var(--text-3)]">The linked book no longer quotes this line. The book selector now shows available comparisons.</p>}
    <PropModelContext group={group} side={state.side} book={state.book} line={state.line} />
    {canShowSplits && <section id="player-splits" className="player-section-anchor player-section-block"><div className="player-section-heading"><div><span className="player-section-kicker">Context splits</span><h2>Results within the returned verified sample.</h2></div><span className="player-section-count">{state.side} {state.line}</span></div><SplitSummary games={games} group={group} line={state.line} side={state.side} loading={historyPending} /></section>}
    <section className="player-detail-grid player-section-block">{!unavailableReason && <div className="min-w-0"><Reveal><GameLog games={games} line={state.line} market={group.market} loading={historyPending} /></Reveal></div>}<div className="min-w-0"><Reveal><BookPrices group={group} /></Reveal></div></section>
  </Shell>;
}
function SplitSummary({ games, group, line, side, loading }: { games: ReturnType<typeof playedGames>; group: PropGroup; line: number; side: Side; loading: boolean }) {
  if (loading) return <Skeleton className="h-[116px] rounded-[var(--radius)]" />;
  const rows = sortRecentFirst(playable(games));
  const home = computeWindow(rows.filter((game) => game.isHome === true), line, side, 'home', 'Home');
  const away = computeWindow(rows.filter((game) => game.isHome === false), line, side, 'away', 'Away');
  const h2h = headToHead(rows, group.opponent, line, side);
  const splits = [home, away, h2h].filter((value): value is NonNullable<typeof value> => Boolean(value && value.games > 0));
  if (!splits.length) return <p className="text-sm text-[var(--text-3)]">No verified venue or head-to-head split is available in this sample.</p>;
  return <div className="player-split-grid">{splits.map((split) => <article key={split.id} className="player-split-card" data-tone={split.hitRate === null ? 'none' : split.hitRate >= 60 ? 'pos' : split.hitRate < 45 ? 'neg' : 'mid'}><div className="player-split-topline"><span>{split.label}</span><span className="num">{split.hits}/{split.games}</span></div><strong className="num">{split.hitRate === null ? '—' : `${split.hitRate}%`}</strong><div className="player-split-meta"><span>{split.average === null ? 'Average unavailable' : `Avg ${split.average}`}</span>{split.id === 'h2h' && group.opponent ? <span>vs {group.opponent}</span> : null}</div></article>)}</div>;
}
function Shell({ children }: { children: React.ReactNode }) { return <div className="player-app-shell mx-auto w-full max-w-[var(--maxw)] px-4 pt-5 pb-[calc(7rem+env(safe-area-inset-bottom))] md:px-8 md:pb-20"><Link href="/board" className="player-back-link inline-flex min-h-10 items-center gap-2 text-[length:var(--fs-sm)] text-[var(--text-2)]"><ChevronLeft className="size-4" aria-hidden="true" />Back to board</Link>{children}</div>; }
function Empty({ title, body }: { title: string; body: string }) { return <CardPanel className="mt-4 grid justify-items-center gap-3 py-16 text-center"><h1 className="text-[length:var(--fs-md)] normal-case">{title}</h1><p className="max-w-[48ch] text-[length:var(--fs-sm)] text-[var(--text-3)]">{body}</p><Button asChild variant="ghost" size="sm"><Link href="/board">Open the board</Link></Button></CardPanel>; }
