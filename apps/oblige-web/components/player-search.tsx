'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { heldBoardPlayers, searchPlayers, type PlayerSearchResult } from '@/lib/api';
import { profileSupported, samePlayerName } from '@/lib/player-profile';
import { sameTeamLabel } from '@/lib/opponent-options';
import { PlayerAvatar } from '@/components/face-card';

const LEAGUE_LABEL: Record<string, string> = {
  nfl: 'NFL', 'college-football': 'College football', nba: 'NBA', wnba: 'WNBA',
  'mens-college-basketball': 'College basketball', mlb: 'MLB', nhl: 'NHL',
  'usa.1': 'MLS', 'eng.1': 'Premier League', 'uefa.champions': 'Champions League', atp: 'ATP', wta: 'WTA',
};

type Row = {
  key: string;
  name: string;
  sport: string;
  team: string | null;
  league: string;
  espnId: string | null;
  liveProps: number;
};

function hrefFor(row: Row) {
  const params = new URLSearchParams({ sport: row.sport, player: row.name, profile: '1' });
  if (row.espnId) params.set('pid', row.espnId);
  if (row.team) params.set('team', row.team);
  return `/research?${params}`;
}

/**
 * Find any player the research card can read, prop or not. Players with a
 * live prop on a board this tab already holds show first and instantly; the
 * league directory fills in everyone else.
 */
export function PlayerSearch() {
  // A board search that found nobody hands its text over as ?q=.
  const initial = useSearchParams().get('q') || '';
  const [query, setQuery] = React.useState(initial.slice(0, 60));
  const [results, setResults] = React.useState<PlayerSearchResult[]>([]);
  const [status, setStatus] = React.useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const input = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => { input.current?.focus(); }, []);

  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setStatus('idle');
      return;
    }
    const controller = new AbortController();
    setStatus('loading');
    const timer = window.setTimeout(() => {
      searchPlayers(q, controller.signal)
        .then((value) => {
          setResults(value.players);
          setStatus(value.ok === false ? 'error' : 'done');
        })
        .catch(() => {
          if (!controller.signal.aborted) setStatus('error');
        });
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const rows = React.useMemo<Row[]>(() => {
    const q = query.trim();
    if (q.length < 2) return [];
    const live = heldBoardPlayers(q);
    const out: Row[] = live.map((player) => ({
      key: 'live:' + player.sport + ':' + player.name,
      name: player.name,
      sport: player.sport,
      team: player.team,
      league: player.sport.toLowerCase(),
      espnId: null,
      liveProps: player.props,
    }));
    for (const player of results) {
      // Same person only when the name and the team agree; same-name players stay apart.
      const held = out.find((row) => row.sport === player.sport && samePlayerName(row.name, player.name) && !row.espnId
        && Boolean(row.team && player.team && sameTeamLabel(row.team, player.team)));
      if (held) {
        // Same person: keep the live count, gain the directory identity and full team name.
        held.espnId = player.id;
        held.league = player.league;
        held.team = player.team;
        continue;
      }
      out.push({ key: player.sport + ':' + player.id, name: player.name, sport: player.sport, team: player.team, league: player.league, espnId: player.id, liveProps: 0 });
    }
    return out;
  }, [query, results]);

  return (
    <div className="mx-auto w-full max-w-[760px]">
      <h1 className="mt-3 text-[22px] font-extrabold tracking-[-.02em] text-[var(--text)] sm:text-[26px]">Search any player</h1>
      <p className="mt-1 text-[13px] text-[var(--text-2)]">
        Every player&apos;s verified history with the same filters as a prop, and their live props when books have them posted.
      </p>

      <label className="relative mt-4 flex h-12 items-center gap-2 rounded-[10px] border border-[var(--line-strong)] bg-[var(--surface)] px-3 focus-within:border-[var(--accent-2)]">
        <Search className="size-5 shrink-0 text-[var(--text-3)]" aria-hidden="true" />
        <span className="sr-only">Player name</span>
        <input
          ref={input}
          type="search"
          inputMode="search"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => setQuery(event.target.value.slice(0, 60))}
          placeholder="Player name, e.g. Brunson"
          className="h-full min-w-0 flex-1 bg-transparent text-[16px] text-[var(--text)] outline-none placeholder:text-[var(--text-3)] [&::-webkit-search-cancel-button]:hidden"
        />
        {query ? (
          <button type="button" aria-label="Clear search" onClick={() => { setQuery(''); input.current?.focus(); }} className="grid size-8 place-items-center rounded-full text-[var(--text-3)] hover:text-[var(--text)]">
            <X className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </label>

      <div aria-live="polite" className="mt-3">
        {rows.length ? (
          <ul className="overflow-hidden rounded-[10px] border border-[var(--line-strong)] bg-[var(--surface)]">
            {rows.map((row) => {
              const readable = row.liveProps > 0 || profileSupported(row.sport);
              return (
                <li key={row.key} className="border-b border-[var(--line)] last:border-b-0">
                  <Link
                    href={hrefFor(row)}
                    data-qa="player-search-result"
                    className="flex min-h-[60px] items-center gap-3 px-3 py-2 transition-colors hover:bg-[var(--surface-2)]"
                  >
                    <span className="size-10 shrink-0 overflow-hidden rounded-full bg-[var(--surface-3)] ring-1 ring-[var(--line-strong)]">
                      <PlayerAvatar name={row.name} sport={row.sport} team={row.team} size={40} className="!size-full" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-bold text-[var(--text)]">{row.name}</span>
                      <span className="block truncate text-[12px] text-[var(--text-2)]">
                        {[row.team, LEAGUE_LABEL[row.league] || row.sport].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {row.liveProps > 0 ? (
                      <span className="shrink-0 rounded-full bg-[var(--pos-soft)] px-2 py-0.5 text-[11px] font-black text-[var(--pos)]">
                        {row.liveProps} live {row.liveProps === 1 ? 'prop' : 'props'}
                      </span>
                    ) : !readable ? (
                      <span className="shrink-0 text-[11px] font-semibold text-[var(--text-3)]">History with a posted prop</span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : status === 'loading' ? (
          <p className="px-1 text-[13px] text-[var(--text-3)]">Searching…</p>
        ) : status === 'error' ? (
          <p className="px-1 text-[13px] text-[var(--text-2)]">Player search could not load. Try again shortly.</p>
        ) : status === 'done' ? (
          <p className="px-1 text-[13px] text-[var(--text-2)]">No NFL, NBA, WNBA, MLB, NHL, college, soccer or tennis player matches that name.</p>
        ) : (
          <p className="px-1 text-[13px] text-[var(--text-3)]">Type at least two letters. Works across NFL, NBA, WNBA, MLB, NHL, college, soccer and tennis.</p>
        )}
      </div>
    </div>
  );
}
