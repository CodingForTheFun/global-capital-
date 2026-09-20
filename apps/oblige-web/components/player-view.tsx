'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { PropGroup, ResearchResponse, Side } from '@/lib/types';
import { ApiError, fetchAccount, fetchBoard, fetchResearch, playedGames } from '@/lib/api';
import { groupPlayerCards, playerMarketKey, playerCategories, quotedBooks, postedSelection, playerResearchHref } from '@/lib/player-cards';
import { computeWindow, headToHead, playable, sortRecentFirst } from '@/lib/analytics';
import { legacyPresentation } from '@/lib/legacy-research-presentation';
import { marketName } from '@/lib/market-display';
import { Skeleton } from '@/components/ui/skeleton';
import { GameLog } from '@/components/research';
import { PropExplorer, type ExplorerState } from '@/components/prop-explorer';
import { SignInPanel } from '@/components/sign-in';
import { PlayerAnalysisPage } from '@/components/player-analysis-page';
import { PostedModel } from '@/components/posted-model';
import { QuoteHistory } from '@/components/quote-history';

const FAVOURITES_KEY = 'oblige-followed';
function readFavourites(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(FAVOURITES_KEY) || '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch { return []; }
}

/**
 * The live board emits this legacy URL format. Keep its existing board and
 * research APIs, but render the SAME premium component as canonical links.
 * No fabricated canonical identities or extra provider fetches are introduced.
 */
export function PlayerView() {
  const router = useRouter();
  const params = useSearchParams();
  const sport = params.get('sport') || 'NFL';
  const player = params.get('player') || '';
  const market = params.get('market') || '';
  const lineRaw = params.get('line');
  const postedLine = lineRaw !== null && lineRaw.trim() !== '' && Number.isFinite(Number(lineRaw)) ? Number(lineRaw) : null;
  const cardKey = params.get('card') || '';
  const categoryKey = params.get('category') || '';
  const selectedBook = params.get('book') || null;
  const [resolvedCardKey, setResolvedCardKey] = React.useState(cardKey);
  const [account, setAccount] = React.useState<{ id: string; email?: string } | null>(null);
  const [checking, setChecking] = React.useState(true);
  const [markets, setMarkets] = React.useState<PropGroup[]>([]);
  const [research, setResearch] = React.useState<ResearchResponse | null>(null);
  const [loadedResearchIdentity, setLoadedResearchIdentity] = React.useState('');
  const [loadingBoard, setLoadingBoard] = React.useState(true);
  const [loadingResearch, setLoadingResearch] = React.useState(true);
  const [error, setError] = React.useState('');
  const [researchError, setResearchError] = React.useState('');
  const [retry, setRetry] = React.useState(0);
  const [favourites, setFavourites] = React.useState<string[]>([]);
  const [state, setState] = React.useState<ExplorerState>({ line: 0, side: 'OVER', book: null });

  React.useEffect(() => {
    const controller = new AbortController();
    void fetchAccount(controller.signal)
      .then(value => { if (!controller.signal.aborted) setAccount(value); })
      .finally(() => { if (!controller.signal.aborted) setChecking(false); });
    setFavourites(readFavourites());
    return () => controller.abort();
  }, []);

  React.useEffect(() => {
    if (checking || !account || !player) return;
    const controller = new AbortController();
    setLoadingBoard(true);
    setError('');
    void fetchBoard(sport, controller.signal)
      .then(board => {
        if (controller.signal.aborted) return;
        const cards = groupPlayerCards(board.groups);
        const selected = cardKey ? cards.find(card => card.key === cardKey || card.aliases?.includes(cardKey)) : cards.find(card => card.variants.some(candidate => candidate.player === player || candidate.quotes.some(quote => quote.playerName === player)));
        const mine = selected?.variants || [];
        setResolvedCardKey(selected?.key || cardKey);
        if (!mine.length) setError(`${player} is not on the ${sport} board right now.`);
        setMarkets(mine);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 401) { setAccount(null); return; }
        setError(cause instanceof Error ? cause.message : 'The board is unavailable.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoadingBoard(false); });
    return () => controller.abort();
  }, [checking, account, sport, player, cardKey]);

  const categories = React.useMemo(() => playerCategories(markets), [markets]);
  const group = React.useMemo(() => postedSelection(markets, categoryKey, selectedBook, postedLine, market), [markets, categoryKey, selectedBook, postedLine, market]);
  const categoryVariants = React.useMemo(() => group ? markets.filter(candidate => playerMarketKey(candidate) === playerMarketKey(group)) : [], [markets, group]);
  const allBooks = React.useMemo(() => quotedBooks(categoryVariants), [categoryVariants]);
  const researchIdentity = group ? JSON.stringify([resolvedCardKey, playerMarketKey(group)]) : '';
  const presentation = React.useMemo(() => group ? legacyPresentation(categories, group, playerMarketKey(group), resolvedCardKey, state.side) : null, [categories, group, resolvedCardKey, state.side]);

  React.useEffect(() => {
    if (group) setState(previous => ({ line: group.line, side: previous.side, book: selectedBook }));
  }, [group?.key, group?.line, selectedBook]);

  React.useEffect(() => {
    if (!group || !account) return;
    const controller = new AbortController();
    setLoadingResearch(true); setResearch(null); setResearchError('');
    void fetchResearch(group, state.side, controller.signal)
      .then(value => {
        if (controller.signal.aborted) return;
        setResearch(value); setResearchError(''); setLoadedResearchIdentity(researchIdentity);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 401) { setAccount(null); return; }
        setResearch(null); setLoadedResearchIdentity(researchIdentity);
        setResearchError(cause instanceof Error ? cause.message : 'Historical research could not load. Try again shortly.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoadingResearch(false); });
    return () => controller.abort();
    // Preserve the existing exact-category sample cache. Books, line and side
    // only recalculate in-browser and must not trigger additional history calls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [researchIdentity, retry, account]);

  function choose(category: string, book: string | null, line: number | null) {
    const variants = markets.filter(candidate => playerMarketKey(candidate) === category);
    const next = postedSelection(variants, category, book, line);
    if (next) router.replace(playerResearchHref(next, resolvedCardKey, book), { scroll: false });
  }
  function selectCategory(category: string) {
    const variants = markets.filter(candidate => playerMarketKey(candidate) === category);
    const keepBook = selectedBook && quotedBooks(variants).some(book => book.key === selectedBook.toLowerCase() || book.label === selectedBook) ? selectedBook : null;
    choose(category, keepBook, postedLine);
  }
  function toggleFavourite(key: string) {
    setFavourites(previous => {
      const next = previous.includes(key) ? previous.filter(item => item !== key) : [...previous, key];
      try { localStorage.setItem(FAVOURITES_KEY, JSON.stringify(next)); } catch { /* optional per-device preference */ }
      return next;
    });
  }

  if (checking) return <Shell><Skeleton className="mt-4 h-40 rounded-xl"/></Shell>;
  if (!account) return <Shell><SignInPanel onSignedIn={setAccount}/></Shell>;
  if (!player) return <Shell><Empty title="Pick a prop to research" body="Open a player on the board to see all their stats, history and book prices."/></Shell>;
  if (loadingBoard && !group) return <Shell><Skeleton className="mt-4 h-40 rounded-xl"/><Skeleton className="mt-4 h-72 rounded-xl"/></Shell>;
  if (!group) return <Shell><Empty title="That prop is no longer posted" body={error || 'The market may have settled or been pulled from the board.'}/></Shell>;
  if (!presentation?.market || !presentation.selected) return <Shell><Empty title="This quote is unavailable" body="No verifiable sportsbook selection is attached to this prop. Choose another posted market from the board."/></Shell>;

  const activeResearch = loadedResearchIdentity === researchIdentity ? research : null;
  const activeError = loadedResearchIdentity === researchIdentity ? researchError : '';
  const pending = loadingResearch || loadedResearchIdentity !== researchIdentity;
  const unavailable = activeError || (activeResearch?.available === false ? activeResearch.message || 'No verified game log is available for this exact market.' : null);
  const games = unavailable ? [] : playedGames(activeResearch);
  const displayGroup = { ...group, market: marketName(presentation.market) };
  const favourite = favourites.includes(group.key);
  const normalizedBook = selectedBook ? allBooks.find(book => book.key === selectedBook.toLowerCase() || book.label === selectedBook)?.key || selectedBook : null;

  return <PlayerAnalysisPage
    analysis={{group: displayGroup, history: activeResearch, line: state.line, loading: pending, unavailable}}
    routeKind="legacy-board-premium-v2"
    player={presentation.player} market={presentation.market} selected={presentation.selected}
    team={group.team} matchupLabel={group.matchup}
    side={state.side} favourite={favourite} canFollow
    allowBestPrices bookSelection={normalizedBook}
    onCategory={selectCategory}
    onBook={book => choose(playerMarketKey(group), book || null, group.line)}
    onLine={line => choose(playerMarketKey(group), selectedBook, line)}
    onOffer={offer => {
      setState(previous => ({ line: offer.line ?? group.line, book: offer.book, side: offer.side || previous.side }));
      choose(playerMarketKey(group), offer.book, offer.line);
    }}
    onFavourite={() => toggleFavourite(group.key)}
    research={<>
      <PropExplorer group={displayGroup} games={games} loading={pending} unavailableReason={unavailable} currentOpponent={activeResearch?.matchup?.opponent ?? group.opponent} season={activeResearch?.season} hideBookFilter state={state} onState={setState} favourite={favourite} onFavourite={() => toggleFavourite(group.key)}/>
      {!pending && unavailable && <button type="button" onClick={() => setRetry(value => value + 1)}>Retry history</button>}
    </>}
    supporting={!pending && !unavailable && games.length > 0 ? <SplitSummary games={games} group={displayGroup} line={state.line} side={state.side}/> : null}
    model={<PostedModel group={group} side={state.side} book={presentation.selected.book} researchLine={state.line}/>}
    quoteHistory={<QuoteHistory group={group} side={presentation.selected.side || state.side} book={presentation.selected.book}/>}
    gameLog={<GameLog games={games} line={state.line} market={displayGroup.market} loading={pending}/>}
  />;
}

function SplitSummary({ games, group, line, side }: { games: ReturnType<typeof playedGames>; group: PropGroup; line: number; side: Side }) {
  const rows = sortRecentFirst(playable(games));
  const home = computeWindow(rows.filter(game => game.isHome === true), line, side, 'home', 'Home');
  const away = computeWindow(rows.filter(game => game.isHome === false), line, side, 'away', 'Away');
  const h2h = headToHead(rows, group.opponent, line, side);
  const splits = [home, away, h2h || computeWindow([], line, side, 'h2h', 'H2H')];
  return <><h2 style={{fontSize: 14, marginBottom: 12}}>Supporting context</h2><div style={{display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10}}>{splits.map(split => <article key={split.id} style={{minWidth: 0}}>
    <p style={{fontSize: 11, color: '#a6b6cf'}}>{split.label}</p>
    <strong style={{display: 'block', fontSize: 22, margin: '5px 0', color: split.hitRate === null ? '#8c9db8' : split.hitRate >= 60 ? '#26ddb1' : split.hitRate < 45 ? '#f16986' : '#f2f6fe'}}>{split.hitRate === null ? '—' : `${split.hitRate}%`}</strong>
    <p style={{fontSize: 10, color: '#a6b6cf'}}>{split.average === null ? 'Average unavailable' : `Avg ${split.average}`}</p>
    <p style={{fontSize: 10, color: '#8c9db8', marginTop: 4}}>{split.games ? `${split.hits}/${split.games} games` : 'No sample'}</p>
  </article>)}</div></>;
}
function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-[var(--maxw)] px-4 pt-4 pb-24 md:px-8"><Link href="/board" className="inline-flex min-h-11 items-center text-sm text-[var(--text-2)]">Back to props</Link>{children}</div>;
}
function Empty({ title, body }: { title: string; body: string }) {
  return <section className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6"><h1 className="text-xl normal-case">{title}</h1><p className="mt-3 text-sm text-[var(--text-2)]">{body}</p><Link href="/board" className="mt-4 inline-flex min-h-11 items-center text-sm text-[var(--accent)]">Open the board</Link></section>;
}
