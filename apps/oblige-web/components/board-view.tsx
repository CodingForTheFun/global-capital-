'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Search, TriangleAlert } from 'lucide-react';
import type { BoardMeta, PropGroup } from '@/lib/types';
import { ApiError, fetchAccount, fetchBoard, fetchResearch, windowOf } from '@/lib/api';
import { cn, pctValue } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PropCard, PropCardSkeleton, type PropCardStats } from '@/components/face-card';
import { Reveal } from '@/components/motion';
import { SignInPanel } from '@/components/sign-in';

const SPORTS = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'WNBA', 'SOCCER'];
const SORTS = [
  { id: 'hit', label: 'Hit rate' },
  { id: 'line', label: 'Line' },
  { id: 'name', label: 'A–Z' },
] as const;

type SortId = (typeof SORTS)[number]['id'];

/** Enough cards to fill a tall screen without asking the research route for
 *  hundreds of histories nobody scrolled to. */
const PAGE_SIZE = 24;

export function BoardView() {
  const router = useRouter();
  const [account, setAccount] = React.useState<{ id: string; email?: string } | null>(null);
  const [checking, setChecking] = React.useState(true);

  const [sport, setSport] = React.useState('NFL');
  const [groups, setGroups] = React.useState<PropGroup[]>([]);
  const [meta, setMeta] = React.useState<BoardMeta>({});
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [nonce, setNonce] = React.useState(0);

  const [query, setQuery] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [sort, setSort] = React.useState<SortId>('line');
  const [shown, setShown] = React.useState(PAGE_SIZE);
  const [picks, setPicks] = React.useState<Record<string, 'OVER' | 'UNDER'>>({});

  /** Hit rates arrive per card from the research route, so the board renders
   *  immediately and each card fills in as its history lands. */
  const [stats, setStats] = React.useState<Record<string, PropCardStats>>({});

  React.useEffect(() => {
    const controller = new AbortController();
    fetchAccount(controller.signal)
      .then(setAccount)
      .finally(() => setChecking(false));
    return () => controller.abort();
  }, []);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim().toLowerCase()), 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  React.useEffect(() => {
    if (checking || !account) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20000);
    setLoading(true);
    setError('');
    fetchBoard(sport, controller.signal)
      .then((board) => {
        setGroups(board.groups);
        setMeta(board.meta);
        setShown(PAGE_SIZE);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) {
          setError('The prop board took too long to respond. Try again.');
          return;
        }
        if (cause instanceof ApiError && cause.status === 401) {
          setAccount(null);
          return;
        }
        setError(cause instanceof Error ? cause.message : 'The live prop board is unavailable.');
      })
      .finally(() => {
        window.clearTimeout(timer);
        setLoading(false);
      });
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [checking, account, sport, nonce]);

  const visible = React.useMemo(() => {
    const filtered = debounced
      ? groups.filter((group) =>
          `${group.player} ${group.market} ${group.matchup}`.toLowerCase().includes(debounced),
        )
      : groups;
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sort === 'name') return a.player.localeCompare(b.player);
      if (sort === 'line') return b.line - a.line;
      // Only reached when the reader asks for it. Cards without a history yet
      // sort below the ones that have one, so the top is never a row of blanks.
      const ra = stats[a.key]?.rate ?? -1;
      const rb = stats[b.key]?.rate ?? -1;
      return rb - ra || a.player.localeCompare(b.player);
    });
    return sorted;
  }, [groups, debounced, sort, stats]);

  const page = visible.slice(0, shown);

  /* One hit-rate request per card, ever.
     The keys already asked for live in a ref rather than in state, because
     sorting by hit rate reorders the page as results arrive: keying this
     effect on the page's contents would restart it on every result and abort
     the requests still in flight. The controller is tied to the component's
     life, not to a render. */
  const requested = React.useRef(new Set<string>());
  const inflight = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    inflight.current = controller;
    return () => {
      controller.abort();
      inflight.current = null;
    };
  }, []);

  /* A change of sport is a different board, so previous answers no longer
     apply and the keys are released. */
  React.useEffect(() => {
    requested.current = new Set();
    setStats({});
  }, [sport]);

  const pageKeys = page.map((group) => group.key).join('|');

  React.useEffect(() => {
    const controller = inflight.current;
    if (!controller) return;
    const wanted = page.filter((group) => !requested.current.has(group.key));
    if (!wanted.length) return;
    for (const group of wanted) requested.current.add(group.key);

    const queue = [...wanted];
    // Four at a time: enough to fill a screen quickly, gentle enough that a
    // scroll does not trip the research route's rate limit.
    const worker = async () => {
      while (queue.length && !controller.signal.aborted) {
        const group = queue.shift()!;
        try {
          const research = await fetchResearch(group, 'OVER', controller.signal);
          const last10 = windowOf(research, 'last10', 'l10', 'lastTen');
          const rate = pctValue(last10?.hitRate ?? null);
          const hits = last10?.hits ?? null;
          const sample = last10?.sampleSize ?? last10?.games ?? null;
          if (controller.signal.aborted) return;
          setStats((prev) => ({
            ...prev,
            [group.key]: rate === null && hits === null ? null : { hits, sample, rate },
          }));
        } catch {
          if (!controller.signal.aborted) {
            setStats((prev) => ({ ...prev, [group.key]: null }));
          }
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, wanted.length) }, worker));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKeys]);

  function openPlayer(group: PropGroup) {
    const params = new URLSearchParams({
      sport: group.sport,
      player: group.player,
      market: group.market,
      line: String(group.line),
    });
    router.push(`/research?${params}`);
  }

  if (checking) {
    return (
      <div className="mx-auto w-full max-w-[var(--maxw)] px-4 py-10 md:px-8">
        <div className="grid gap-3 [&>*]:min-w-0 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <PropCardSkeleton key={index} />
          ))}
        </div>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="mx-auto w-full max-w-[var(--maxw)] px-4 py-10 md:px-8">
        <SignInPanel onSignedIn={setAccount} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[var(--maxw)] px-4 pt-6 pb-16 md:px-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[length:var(--fs-xl)]" style={{ textTransform: 'var(--display-case)' as 'none' }}>
            Prop Board
          </h1>
          <p className="mt-1.5 text-[length:var(--fs-sm)] text-[var(--text-3)]">
            {loading
              ? 'Loading the live board…'
              : `${visible.length.toLocaleString()} props in view${
                  meta.sportsbookCount ? ` · ${meta.sportsbookCount} books` : ''
                }`}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setNonce((value) => value + 1)}
          disabled={loading}
        >
          <RefreshCw className={cn('size-4', loading && 'animate-spin')} aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {meta.stale && (
        <p className="mb-4 flex items-center gap-2 rounded-[var(--radius)] border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] p-3 text-[length:var(--fs-sm)] text-[var(--warn)]">
          <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
          These prices are from the last good refresh and may have moved since.
        </p>
      )}

      {/* filter rail */}
      <div
        className={cn(
          '-mx-4 border-b border-[var(--line)] px-4 py-3 md:-mx-8 md:px-8',
          'sticky top-16 z-20 grid gap-3',
          'bg-[color-mix(in_srgb,var(--bg)_92%,transparent)] backdrop-blur-lg',
        )}
      >
        <div className="rail" role="group" aria-label="League">
          {SPORTS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === sport}
              onClick={() => setSport(option)}
              className={cn(
                'flex-none min-h-10 rounded-full border px-4 text-[length:var(--fs-xs)] font-semibold',
                'transition-[color,background-color,border-color,transform] duration-200 ease-[var(--ease-out)] active:scale-[.96]',
                option === sport
                  ? 'border-transparent bg-[var(--accent)] text-[var(--accent-ink)]'
                  : 'border-[var(--line)] bg-[var(--surface)] text-[var(--text-2)] hover:border-[var(--line-strong)] hover:text-[var(--text)]',
              )}
            >
              {option}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="relative flex min-w-[180px] flex-1 items-center">
            <Search
              className="pointer-events-none absolute left-3 size-4 text-[var(--text-3)]"
              aria-hidden="true"
            />
            <span className="sr-only">Search players or markets</span>
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search player or market…"
              autoComplete="off"
              className="pl-9"
            />
          </label>
          {SORTS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={option.id === sort}
              onClick={() => setSort(option.id)}
              className={cn(
                'min-h-10 flex-none rounded-full border px-4 text-[length:var(--fs-xs)] font-semibold',
                'transition-colors duration-200 ease-[var(--ease-out)]',
                option.id === sort
                  ? 'border-transparent bg-[var(--accent)] text-[var(--accent-ink)]'
                  : 'border-[var(--line)] bg-[var(--surface)] text-[var(--text-2)] hover:border-[var(--line-strong)] hover:text-[var(--text)]',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="grid justify-items-center gap-3 py-16 text-center">
          <TriangleAlert className="size-7 text-[var(--warn)]" aria-hidden="true" />
          <h2 className="text-[length:var(--fs-md)] normal-case">{error}</h2>
          <Button variant="ghost" size="sm" onClick={() => setNonce((value) => value + 1)}>
            Try again
          </Button>
        </div>
      ) : loading && !groups.length ? (
        <div className="mt-5 grid gap-3 [&>*]:min-w-0 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <PropCardSkeleton key={index} />
          ))}
        </div>
      ) : !visible.length ? (
        <div className="grid justify-items-center gap-3 py-16 text-center">
          <Search className="size-7 text-[var(--text-3)]" aria-hidden="true" />
          <h2 className="text-[length:var(--fs-md)] normal-case">No props match that filter</h2>
          <p className="max-w-[46ch] text-[length:var(--fs-sm)] text-[var(--text-3)]">
            Try a different league, or clear the search to see everything {sport} has priced.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuery('');
              setSort('line');
            }}
          >
            Clear filters
          </Button>
        </div>
      ) : (
        <>
          <div className="mt-5 grid gap-3 [&>*]:min-w-0 sm:grid-cols-2 xl:grid-cols-3">
            {page.map((group, index) => (
              <Reveal key={group.key} delay={Math.min(index * 40, 300)}>
                <PropCard
                  group={group}
                  stats={stats[group.key] ?? null}
                  loading={!(group.key in stats)}
                  onOpen={openPlayer}
                  onPick={(picked, side) =>
                    setPicks((prev) => ({
                      ...prev,
                      [picked.key]: prev[picked.key] === side ? undefined! : side,
                    }))
                  }
                  picked={picks[group.key] ?? null}
                  delay={Math.min(index * 40, 300)}
                />
              </Reveal>
            ))}
          </div>

          {shown < visible.length && (
            <div className="mt-8 grid justify-items-center gap-2">
              <Button variant="ghost" onClick={() => setShown((value) => value + PAGE_SIZE)}>
                Show {Math.min(PAGE_SIZE, visible.length - shown)} more
              </Button>
              <span className="text-[length:var(--fs-xs)] text-[var(--text-3)]">
                {shown.toLocaleString()} of {visible.length.toLocaleString()}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
