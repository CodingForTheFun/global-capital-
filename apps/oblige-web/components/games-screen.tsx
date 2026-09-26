'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronDown, ExternalLink, RefreshCw } from 'lucide-react';
import { ApiError, fetchBoard, peekBoard, teamLogoUrl } from '@/lib/api';
import { GAME_SPORTS, contextSport, liveGame, newsForGame, orderGames, propsForGame, type LiveGame } from '@/lib/games';
import { marketDisplayLabel, odds } from '@/lib/utils';
import { GameContext } from '@/components/game-context';
import type { PropGroup } from '@/lib/types';

type Article = { id: string; headline: string; description: string | null; sourceUrl: string | null; source: string; published: string | null };

const ALL_SPORTS = GAME_SPORTS.map((row) => row.id).join(',');
const PROPS_SHOWN = 12;

function startLabel(value: string | null) {
  const date = new Date(value || '');
  if (!Number.isFinite(date.getTime())) return 'Time TBD';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return sameDay ? time : `${date.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

function researchHref(group: PropGroup) {
  const params = new URLSearchParams({ sport: group.sport, player: group.player, market: group.market, line: String(group.line), period: group.period || 'game' });
  return `/research?${params}`;
}

function Crest({ game, side }: { game: LiveGame; side: 'home' | 'away' }) {
  const name = side === 'home' ? game.homeName : game.awayName;
  const short = side === 'home' ? game.homeTeam : game.awayTeam;
  const [failed, setFailed] = React.useState(false);
  // Crests come through the same-origin logo route; soccer has no single
  // directory to match against, so it keeps initials.
  if (game.sport === 'SOCCER' || failed) {
    return <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--surface-3)] text-[10px] font-black text-[var(--text-2)]">{short.slice(0, 3)}</span>;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={teamLogoUrl(game.sport, name)} alt="" width={28} height={28} loading="lazy" onError={() => setFailed(true)} className="size-7 shrink-0 object-contain" />;
}

function TeamLine({ game, side }: { game: LiveGame; side: 'home' | 'away' }) {
  const value = side === 'home' ? game.homeScore : game.awayScore;
  const other = side === 'home' ? game.awayScore : game.homeScore;
  const won = game.status === 'FINAL' && typeof value === 'number' && typeof other === 'number' && value > other;
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Crest game={game} side={side} />
      <span className={`min-w-0 flex-1 truncate text-[14px] ${won ? 'font-black text-[var(--text)]' : 'font-semibold text-[var(--text-2)]'}`}>
        {side === 'home' ? game.homeName : game.awayName}
      </span>
      {game.status !== 'SCHEDULED' && value !== null ? (
        <span className={`font-mono text-[16px] tabular-nums ${won || game.status === 'LIVE' ? 'font-black text-[var(--text)]' : 'text-[var(--text-2)]'}`}>{value}</span>
      ) : null}
    </div>
  );
}

function GameProps({ game, sport }: { game: LiveGame; sport: string }) {
  const [state, setState] = React.useState<{ groups: PropGroup[] | null; message: string | null; auth?: boolean }>(() => {
    const held = peekBoard(sport, 60_000);
    return { groups: held ? held.groups : null, message: null };
  });

  React.useEffect(() => {
    if (state.groups) return;
    const controller = new AbortController();
    fetchBoard(sport, controller.signal)
      .then((board) => setState({ groups: board.groups, message: null }))
      .catch((reason) => {
        if (controller.signal.aborted) return;
        const auth = reason instanceof ApiError && reason.status === 401;
        setState({ groups: [], auth, message: auth ? 'Sign in to see posted props.' : 'Props could not load. Try again shortly.' });
      });
    return () => controller.abort();
  }, [sport, state.groups]);

  const matched = React.useMemo(() => propsForGame(state.groups || [], game), [state.groups, game]);

  return (
    <section className="rounded-[10px] border border-[var(--line-strong)] bg-[var(--surface-2)] p-3 sm:p-4" aria-label="Posted props">
      <h3 className="text-sm font-black text-[var(--text)]">Posted props</h3>
      {!state.groups ? (
        <p className="mt-1 text-[12px] text-[var(--text-3)]">Loading props…</p>
      ) : state.message ? (
        <p className="mt-1 text-[12px] text-[var(--text-3)]">
          {state.message}{' '}
          {state.auth ? <Link href="/account" className="font-bold text-[var(--accent-2)]">Sign in</Link> : null}
        </p>
      ) : !matched.length ? (
        <p className="mt-1 text-[12px] text-[var(--text-3)]">No props are posted for this game right now.</p>
      ) : (
        <>
          <ul className="mt-2 divide-y divide-[var(--line)]">
            {matched.slice(0, PROPS_SHOWN).map((group) => (
              <li key={group.key}>
                <Link href={researchHref(group)} className="flex min-h-11 items-center gap-3 py-1.5 hover:bg-[var(--surface-3)]">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold text-[var(--text)]">{group.player}</span>
                    <span className="block truncate text-[12px] text-[var(--text-3)]">{marketDisplayLabel(group.market, group.player, group.marketId, group.sport)}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-mono text-[13px] font-black tabular-nums text-[var(--text)]">{group.line}</span>
                    {group.bestOver?.price != null ? <span className="block font-mono text-[11px] tabular-nums text-[var(--text-3)]">o {odds(group.bestOver.price)}</span> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {matched.length > PROPS_SHOWN ? (
            <Link href="/board" className="mt-2 inline-block text-[12px] font-bold text-[var(--accent-2)]">
              {matched.length - PROPS_SHOWN} more on the board →
            </Link>
          ) : null}
        </>
      )}
    </section>
  );
}

function GameNews({ game, articles }: { game: LiveGame; articles: Article[] | null }) {
  const matched = React.useMemo(() => newsForGame(articles || [], game).slice(0, 5), [articles, game]);
  return (
    <section className="rounded-[10px] border border-[var(--line-strong)] bg-[var(--surface-2)] p-3 sm:p-4" aria-label="News">
      <h3 className="text-sm font-black text-[var(--text)]">In the news</h3>
      {!articles ? (
        <p className="mt-1 text-[12px] text-[var(--text-3)]">Loading news…</p>
      ) : !matched.length ? (
        <p className="mt-1 text-[12px] text-[var(--text-3)]">No recent story names either team in full.</p>
      ) : (
        <ul className="mt-2 grid gap-2">
          {matched.map((article) => (
            <li key={article.id} className="text-[13px]">
              {article.sourceUrl ? (
                <a href={article.sourceUrl} target="_blank" rel="noopener noreferrer" className="font-bold text-[var(--text)] hover:underline">
                  {article.headline} <ExternalLink className="inline size-3 text-[var(--text-3)]" aria-hidden />
                </a>
              ) : (
                <span className="font-bold text-[var(--text)]">{article.headline}</span>
              )}
              <span className="block text-[11px] text-[var(--text-3)]">{article.source}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function GameRow({ game, open, onToggle, articles }: { game: LiveGame; open: boolean; onToggle: () => void; articles: Article[] | null }) {
  const context = contextSport(game);
  const status = game.status === 'LIVE'
    ? <span className="inline-flex items-center gap-1 text-[12px] font-black text-[var(--neg)]"><i className="size-1.5 rounded-full bg-current" />{game.providerStatus || 'Live'}</span>
    : game.status === 'FINAL'
      ? <span className="text-[12px] font-bold text-[var(--text-3)]">{game.providerStatus || 'Final'}</span>
      : <span className="text-[12px] font-bold text-[var(--text-2)]">{startLabel(game.startTime)}</span>;
  return (
    <li className="border-b border-[var(--line)] last:border-b-0" data-qa="game-row">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-[var(--surface-2)] sm:px-4">
        <span className="grid min-w-0 flex-1 gap-1.5">
          <TeamLine game={game} side="away" />
          <TeamLine game={game} side="home" />
        </span>
        <span className="flex w-[92px] shrink-0 flex-col items-end gap-1 text-right">
          {status}
          {game.sport === 'SOCCER' && game.league ? <span className="text-[11px] text-[var(--text-3)]">{game.league}</span> : null}
          {game.broadcast && game.status !== 'FINAL' ? <span className="max-w-full truncate text-[11px] text-[var(--text-3)]">{game.broadcast}</span> : null}
        </span>
        <ChevronDown className={`size-4 shrink-0 text-[var(--text-3)] transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open ? (
        <div className="grid gap-3 px-3 pb-4 sm:px-4" data-qa="game-detail">
          {context && game.startTime ? (
            <GameContext game={{ sport: context, eventId: game.gameId, homeTeam: game.homeTeam, awayTeam: game.awayTeam, startsAt: game.startTime, matchup: `${game.awayTeam} @ ${game.homeTeam}` }} />
          ) : null}
          <div className="grid gap-3 lg:grid-cols-2">
            <GameProps game={game} sport={game.sport} />
            <GameNews game={game} articles={articles} />
          </div>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Every game on one screen: score or start, then, opened, the verified game
 * context, the props posted for it and the news that names a team.
 */
export function GamesScreen() {
  const [games, setGames] = React.useState<LiveGame[]>([]);
  const [sport, setSport] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<{ auth: boolean; message: string } | null>(null);
  const [fetchedAt, setFetchedAt] = React.useState<string | null>(null);
  const [news, setNews] = React.useState<Record<string, Article[]>>({});
  const liveCount = React.useRef(0);

  const load = React.useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    try {
      const response = await fetch(`/api/live?sports=${ALL_SPORTS}${force ? '&force=1' : ''}`, { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } });
      const body = await response.json().catch(() => null) as { games?: unknown[]; fetchedAt?: string } | null;
      if (response.status === 401) throw Object.assign(new Error('Sign in to see games.'), { auth: true });
      if (!response.ok) throw new Error('Games are temporarily unavailable.');
      const next = orderGames((Array.isArray(body?.games) ? body.games : []).map(liveGame).filter((game): game is LiveGame => Boolean(game)));
      setGames(next);
      liveCount.current = next.filter((game) => game.status === 'LIVE').length;
      setFetchedAt(body?.fetchedAt || new Date().toISOString());
      setError(null);
    } catch (reason) {
      setError({ auth: Boolean((reason as { auth?: boolean })?.auth), message: reason instanceof Error ? reason.message : 'Games are temporarily unavailable.' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    void load(false);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const schedule = () => {
      if (cancelled || document.hidden) return;
      timer = setTimeout(async () => { await load(false); schedule(); }, liveCount.current > 0 ? 30_000 : 90_000);
    };
    schedule();
    const onVisibility = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (!document.hidden) void load(false).finally(schedule);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { cancelled = true; if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, [load]);

  const counts = React.useMemo(() => {
    const next: Record<string, { all: number; live: number }> = {};
    for (const game of games) {
      const row = next[game.sport] || (next[game.sport] = { all: 0, live: 0 });
      row.all += 1;
      if (game.status === 'LIVE') row.live += 1;
    }
    return next;
  }, [games]);

  // Default to the first sport with a live game, else the first with any game.
  const active = sport
    || GAME_SPORTS.find((row) => counts[row.id]?.live)?.id
    || GAME_SPORTS.find((row) => counts[row.id]?.all)?.id
    || GAME_SPORTS[0].id;
  const visible = games.filter((game) => game.sport === active);
  const newsKey = active.toLowerCase();

  // News for the open game's sport, loaded once per sport per visit.
  const openGame = visible.find((game) => game.id === open) || null;
  React.useEffect(() => {
    if (!openGame || news[newsKey]) return;
    const controller = new AbortController();
    fetch('/api/news?sport=' + encodeURIComponent(newsKey), { credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: { accept: 'application/json' } })
      .then((response) => response.ok ? response.json() : { articles: [] })
      .then((body: { articles?: Article[] }) => setNews((current) => ({ ...current, [newsKey]: Array.isArray(body.articles) ? body.articles : [] })))
      .catch(() => { if (!controller.signal.aborted) setNews((current) => ({ ...current, [newsKey]: [] })); });
    return () => controller.abort();
  }, [openGame, newsKey, news]);

  return (
    <div className="mx-auto w-full max-w-[var(--maxw)] px-3 pb-24 pt-4 sm:px-6 sm:pt-6 lg:px-8 lg:pb-12">
      <div className="mx-auto mb-4 flex w-full max-w-5xl items-end justify-between gap-4">
        <div>
          <span className="text-[12px] font-bold uppercase tracking-[.16em] text-[var(--accent)]">Slate</span>
          <h1 className="mt-1 font-display text-2xl font-black tracking-[-.04em] text-[var(--text)] sm:text-3xl">Games</h1>
          <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-[var(--text-3)] sm:text-xs">
            Scores, then open a game for injuries, lineups, lines, its posted props and news.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <button type="button" onClick={() => void load(true)} disabled={refreshing} className="inline-flex min-h-8 items-center gap-1.5 rounded-[9px] border border-[var(--line)] bg-[var(--surface)] px-2.5 text-[12px] font-bold text-[var(--text-2)] transition-colors hover:text-[var(--text)] disabled:opacity-50">
            <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </button>
          <span className="font-mono text-[11px] text-[var(--text-3)]">
            {fetchedAt ? `Updated ${new Date(fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Connecting…'}
          </span>
        </div>
      </div>

      <div className="mx-auto w-full max-w-5xl">
        <nav aria-label="Sport" className="-mx-3 mb-3 flex gap-1.5 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
          {GAME_SPORTS.map((row) => {
            const count = counts[row.id];
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => { setSport(row.id); setOpen(null); }}
                aria-pressed={active === row.id}
                className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] font-bold transition-colors ${active === row.id ? 'border-[var(--accent-2)] bg-[var(--accent-fill)] text-[var(--accent-ink)]' : 'border-[var(--line)] text-[var(--text-2)] hover:text-[var(--text)]'}`}
              >
                {row.label}
                {count?.live ? <i className="size-1.5 rounded-full bg-[var(--neg)]" aria-label={`${count.live} live`} /> : null}
                {count?.all ? <span className="font-mono text-[11px] opacity-70">{count.all}</span> : null}
              </button>
            );
          })}
        </nav>

        {error ? (
          <div className="rounded-[10px] border border-[var(--line-strong)] bg-[var(--surface)] px-4 py-6 text-center">
            <p className="text-[13px] text-[var(--text-2)]">{error.message}</p>
            {error.auth ? <Link href="/account" className="mt-3 inline-block rounded-[6px] bg-[var(--accent-fill)] px-4 py-2 text-xs font-bold text-[var(--accent-ink)]">Sign in</Link> : null}
          </div>
        ) : loading ? (
          <p className="px-1 text-[13px] text-[var(--text-3)]">Loading games…</p>
        ) : !visible.length ? (
          <p className="px-1 text-[13px] text-[var(--text-3)]">No games in the last day or the next three.</p>
        ) : (
          <ul className="overflow-hidden rounded-[10px] border border-[var(--line-strong)] bg-[var(--surface)]">
            {visible.map((game) => (
              <GameRow key={game.id} game={game} open={open === game.id} onToggle={() => setOpen(open === game.id ? null : game.id)} articles={news[newsKey] || null} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
