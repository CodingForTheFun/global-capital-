'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, TriangleAlert } from 'lucide-react';
import type { PropGroup, ResearchResponse } from '@/lib/types';
import { ApiError, fetchAccount, fetchBoard, fetchPlayerProfile, fetchResearch, fetchWatchlist, peekBoard, updateWatchlist, playedGames, type PlayerProfileResponse, type WatchlistItem } from '@/lib/api';
import { isProfileGroup, playerProps, profileGroup, profileMarkets, profileSupported, samePlayerName, seedLine, type ProfileIdentity } from '@/lib/player-profile';
import { PlayerSearch } from '@/components/player-search';
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
import { PlayerPropResearchCard } from '@/components/player-prop-research-card';

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

function watchlistItemFor(group: PropGroup): WatchlistItem {
  const quote = group.bestOver || group.bestUnder || group.quotes[0] || null;
  const eventId = String(quote?.eventId || group.sportsGameOddsEventId || '').trim() || null;
  return {
    key: group.key,
    sport: group.sport,
    player: group.player,
    market: group.market,
    line: group.line,
    period: group.period || 'game',
    team: group.team,
    opponent: group.opponent,
    propId: group.propId,
    eventId,
    marketId: group.marketId,
    startsAt: group.startsAt,
  };
}

function writeFavouriteFallback(keys: string[]) {
  try {
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify(keys));
  } catch {
    /* Account persistence is primary; local storage is only a resilience fallback. */
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
  const postedLine = params.get('line') !== null && Number.isFinite(lineParam) ? lineParam : null;
  // Opened from player search: live props first, then every market's history.
  const profileMode = params.get('profile') === '1';
  const espnId = (params.get('pid') || '').replace(/\D/g, '').slice(0, 12) || null;
  const teamParam = (params.get('team') || '').slice(0, 90) || null;

  const [account, setAccount] = React.useState<{ id: string; email?: string } | null>(null);
  const [checking, setChecking] = React.useState(true);
  // Opening a prop from the board reuses the board this tab already holds, so
  // the card renders at once instead of downloading the whole sport again.
  const held = React.useMemo(() => (player ? peekBoard(sport)?.groups.filter((candidate) => samePlayerName(candidate.player, player)) || [] : []), [sport, player]);
  const [markets, setMarkets] = React.useState<PropGroup[]>(held);
  const [loadingBoard, setLoadingBoard] = React.useState(!held.length);
  // Which player's board lookup has finished; a profile waits for it so a
  // player with live props never flashes their no-line history first.
  const lookupKey = sport + '|' + player;
  const [boardFor, setBoardFor] = React.useState(held.length ? lookupKey : '');
  const [loadingResearch, setLoadingResearch] = React.useState(true);
  const [error, setError] = React.useState('');
  const [favourites, setFavourites] = React.useState<string[]>([]);
  const [watchlistCsrf, setWatchlistCsrf] = React.useState('');
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
    if (!account) {
      setWatchlistCsrf('');
      return;
    }
    const controller = new AbortController();
    fetchWatchlist(controller.signal)
      .then(({ items, csrfToken }) => {
        if (controller.signal.aborted) return;
        setWatchlistCsrf(csrfToken);
        const remoteKeys = items.map((item) => item.key);
        setFavourites((previous) => {
          const merged = [...new Set([...previous, ...remoteKeys])];
          writeFavouriteFallback(merged);
          return merged;
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setWatchlistCsrf('');
      });
    return () => controller.abort();
  }, [account?.id]);

  React.useEffect(() => {
    if (checking || !account || !player) {
      setLoadingBoard(false);
      return;
    }
    // A board younger than a minute is current enough; skip the re-download.
    const recent = peekBoard(sport, 60_000);
    const mineRecent = recent?.groups.filter((candidate) => samePlayerName(candidate.player, player)) || [];
    if (mineRecent.length) {
      setMarkets(mineRecent);
      setLoadingBoard(false);
      setBoardFor(lookupKey);
      return;
    }
    const controller = new AbortController();
    setLoadingBoard(!held.length);
    setError('');
    fetchBoard(sport, controller.signal)
      .then((board) => {
        // No live prop is not an error: the player's profile still opens.
        setMarkets(board.groups.filter((candidate) => samePlayerName(candidate.player, player)));
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 401) {
          setAccount(null);
          return;
        }
        setError(cause instanceof Error ? cause.message : 'The board is unavailable.');
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setLoadingBoard(false);
        setBoardFor(lookupKey);
      });
    return () => controller.abort();
  }, [checking, account, sport, player]);

  // Position, team and next game for a player opened from search.
  const [profile, setProfile] = React.useState<PlayerProfileResponse | null>(null);
  const profileKey = espnId && profileSupported(sport) ? sport + ':' + espnId : '';
  const [profileFor, setProfileFor] = React.useState('');
  React.useEffect(() => {
    setProfile(null);
    if (!account || !player || !profileKey || !espnId) return;
    let live = true;
    fetchPlayerProfile(sport, espnId)
      .then((value) => { if (live) setProfile(value.available ? value : null); })
      .finally(() => { if (live) setProfileFor(profileKey); });
    return () => { live = false; };
  }, [account, player, sport, espnId, profileKey]);
  const profileSettled = !profileKey || profileFor === profileKey;
  // From search, only the searched player's team's props count as theirs.
  const liveMarkets = React.useMemo(
    () => (profileMode ? playerProps(markets, player, profile?.player ? [profile.player.team, profile.player.teamName] : [teamParam]) : markets),
    [profileMode, markets, player, teamParam, profile],
  );

  const identity = React.useMemo<ProfileIdentity>(() => ({
    sport,
    name: player,
    espnId,
    team: profile?.player?.team || teamParam || liveMarkets[0]?.team || null,
    position: profile?.player?.position || liveMarkets[0]?.position || null,
    nextGame: profile?.nextGame || null,
  }), [sport, player, espnId, profile, teamParam, liveMarkets]);

  // A player with no live prop, or opened as a profile, gets every market the
  // card can read for their role. A market with a live prop keeps its prop.
  const showProfile = Boolean(account && player) && boardFor === lookupKey && (profileMode ? profileSettled : !markets.length);
  const [research, setResearch] = React.useState<ResearchResponse | null>(null);
  const [researchKey, setResearchKey] = React.useState('');
  const baseGroups = React.useMemo(() => {
    // From search, the board decides nothing until the player's team is known.
    if (!showProfile) return profileMode ? [] : markets;
    const liveLabels = new Set(liveMarkets.map((candidate) => marketDisplayLabel(candidate.market, candidate.player, candidate.marketId, candidate.sport)));
    const keys = profileMarkets(sport, identity.position);
    if (market && !keys.includes(market) && !liveMarkets.length) keys.unshift(market);
    const extra = keys
      .filter((key) => !liveLabels.has(marketDisplayLabel(key, player, key, sport)))
      .map((key) => profileGroup(identity, key, null));
    return [...liveMarkets, ...extra];
  }, [showProfile, profileMode, markets, liveMarkets, sport, identity, market, player]);

  const picked = React.useMemo(() => {
    if (!baseGroups.length) return null;
    return (
      baseGroups.find((candidate) =>
        candidate.market === market &&
        candidate.line === postedLine &&
        (candidate.period || 'game') === period
      ) ||
      baseGroups.find((candidate) => candidate.market === market && candidate.line === postedLine) ||
      baseGroups.find((candidate) => candidate.market === market) ||
      baseGroups[0]
    );
  }, [baseGroups, market, period, postedLine]);
  // With no posted line, the target starts at the player's recent median,
  // read from this market's own verified history once it arrives.
  const seed = picked && isProfileGroup(picked) && researchKey === picked.key ? seedLine(research?.gameLog) : null;
  const group = React.useMemo(
    () => (picked && isProfileGroup(picked) ? { ...picked, line: seed ?? picked.line } : picked),
    [picked, seed],
  );
  const markets_ = React.useMemo(
    () => (group && isProfileGroup(group) ? baseGroups.map((candidate) => (candidate.key === group.key ? group : candidate)) : baseGroups),
    [baseGroups, group],
  );
  const [state, setState] = React.useState<ExplorerState>({ line: 0, side: 'OVER', book: null });

  React.useEffect(() => {
    if (!group) return;
    setState({ line: group.line, side: 'OVER', book: null });
    setSection('overview');
  }, [group?.key, group?.line]);

  // A searched player's history waits for their team and next game, so the
  // one research request carries the full identity.
  const researchReady = Boolean(group && player && account) && !(group && isProfileGroup(group) && !profileSettled);
  React.useEffect(() => {
    if (!group || !researchReady) return;
    const controller = new AbortController();
    const key = group.key;
    setLoadingResearch(true);
    fetchResearch(group, state.side, controller.signal, { detail: true, noLine: isProfileGroup(group) })
      .then((value) => { setResearch(value); setResearchKey(key); })
      .catch(() => { if (!controller.signal.aborted) { setResearch(null); setResearchKey(key); } })
      .finally(() => { if (!controller.signal.aborted) setLoadingResearch(false); });
    return () => controller.abort();
    // The game sample is the same for Over and Under; line/side changes are
    // recalculated client-side so they do not create extra provider requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.key, researchReady]);

  function selectMarket(next: PropGroup) {
    const search = new URLSearchParams({
      sport: next.sport,
      player,
      market: next.market,
      period: next.period || 'game',
    });
    if (!isProfileGroup(next)) search.set('line', String(next.line));
    if (showProfile) search.set('profile', '1');
    if (espnId) search.set('pid', espnId);
    if (teamParam) search.set('team', teamParam);
    router.replace(`/research?${search}`, { scroll: false });
  }

  function selectSection(next: PlayerSection) {
    setSection(next);
    requestAnimationFrame(() => {
      document.getElementById(`player-${next}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function toggleFavourite(target: PropGroup) {
    const key = target.key;
    const saving = !favourites.includes(key);
    const optimistic = saving
      ? [...new Set([...favourites, key])]
      : favourites.filter((item) => item !== key);
    setFavourites(optimistic);
    writeFavouriteFallback(optimistic);

    if (!watchlistCsrf) return;
    updateWatchlist(
      saving ? 'upsert' : 'remove',
      saving ? { item: watchlistItemFor(target) } : { key },
      watchlistCsrf,
    )
      .then((items) => {
        const remoteKeys = items.map((item) => item.key);
        const fallbackKeys = readFavourites();
        const merged = [...new Set([...fallbackKeys, ...remoteKeys])];
        setFavourites(merged);
        writeFavouriteFallback(merged);
      })
      .catch(() => {
        // Keep the optimistic local copy. A later signed-in view rehydrates the
        // server watchlist and the star remains useful even during storage faults.
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
        <PlayerSearch />
      </Shell>
    );
  }
  if ((loadingBoard || boardFor !== lookupKey || (profileMode && !profileSettled)) && !group) {
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
          title={`No live props for ${player}`}
          body={error || (profileSupported(sport)
            ? 'Their history could not be matched to a league player. Try searching for them by name.'
            : `${sport} history is read from posted props, and ${player} has none posted right now.`)}
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
      <PropEntrance id={group.key}>
      <PlayerPropResearchCard
        group={group}
        markets={markets_}
        noPostedLine={isProfileGroup(group)}
        research={research}
        loading={loadingResearch}
        state={state}
        onState={setState}
        favourite={favourite}
        onFavourite={() => toggleFavourite(group)}
        onMarket={selectMarket}
      />
      </PropEntrance>
    </Shell>
  );

}

/** Entrance styles for opening a prop; one is picked at random each time. */
const ENTRANCES = ['rise', 'zoom', 'slide', 'flip', 'focus', 'swing'] as const;

/**
 * Plays a randomly chosen entrance whenever a different prop opens. The
 * animation is CSS only (transform, opacity, filter) and is switched off for
 * people who ask their device for reduced motion.
 */
function PropEntrance({ id, children }: { id: string; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const last = React.useRef<string | null>(null);
  React.useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const choices = ENTRANCES.filter((name) => name !== last.current);
    const next = choices[Math.floor(Math.random() * choices.length)];
    last.current = next;
    // Restart the animation without remounting the card (its state survives).
    node.removeAttribute('data-entrance');
    void node.offsetWidth;
    node.setAttribute('data-entrance', next);
  }, [id]);
  return <div ref={ref} className="prop-entrance">{children}</div>;
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
