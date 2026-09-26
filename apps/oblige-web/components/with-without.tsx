'use client';

import * as React from 'react';
import { Users } from 'lucide-react';
import { ApiError, fetchTeammates, type TeammatesResponse } from '@/lib/api';
import { WITH_WITHOUT_SPORTS, espnEventId, teammateOptions, withWithoutSplit, type SplitSide } from '@/lib/with-without';
import type { GameLogRow } from '@/lib/types';

const SMALL_SAMPLE = 3;
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

function Side({ label, value, line, over }: { label: string; value: SplitSide; line: number; over: boolean }) {
  const rate = value.games ? Math.round((value.hits / value.games) * 100) : null;
  return (
    <div className="min-w-0 rounded-[8px] border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5">
      <div className="text-[11px] font-black uppercase tracking-[.05em] text-[var(--text-3)]">{label}</div>
      {value.games ? (
        <>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-[20px] font-black tabular-nums text-white">{rate}%</span>
            <span className="text-[12px] font-bold tabular-nums text-[var(--text-2)]">{value.hits}/{value.games} {over ? 'over' : 'under'} {line}</span>
          </div>
          <div className="mt-0.5 text-[12px] text-[var(--text-2)]">Avg <b className="tabular-nums text-white">{value.average}</b></div>
          {value.games < SMALL_SAMPLE ? <div className="mt-1 text-[11px] font-bold text-[var(--warn,#f5b041)]">Small sample</div> : null}
        </>
      ) : (
        <div className="mt-1 text-[12px] text-[var(--text-3)]">No games</div>
      )}
    </div>
  );
}

/**
 * The player's results with and without a chosen teammate, from the
 * participation recorded in each exact game's box score.
 */
export function WithWithout({ sport, team, player, playerId, games, line, side }: {
  sport: string;
  team: string | null;
  player: string;
  playerId: string | null;
  games: GameLogRow[];
  line: number;
  side: 'OVER' | 'UNDER';
}) {
  const upper = sport.toUpperCase();
  // The most recent 40 verified games; the server finds each one on ESPN.
  const rows = React.useMemo(() => games
    .filter((game) => game.gameId && game.date && text(game.opponentName || game.opponent))
    .slice(0, 40)
    .map((game) => ({ key: String(game.gameId), date: String(game.date), opponent: text(game.opponentName || game.opponent), espnId: espnEventId(game.gameId, upper) })), [games, upper]);
  const rowsKey = rows.map((row) => row.key).join(',');
  const sentKeys = React.useMemo(() => new Set(rows.map((row) => row.key)), [rows]);
  const selfId = playerId && /^history:[A-Z]+:\d+$/.test(playerId) ? playerId.split(':')[2] : null;
  const [state, setState] = React.useState<{ value: TeammatesResponse | null; error: string | null }>({ value: null, error: null });
  const [chosen, setChosen] = React.useState<string | null>(null);
  const supported = WITH_WITHOUT_SPORTS.has(upper) && Boolean(team) && rows.length > 0;

  React.useEffect(() => {
    if (!supported || !team) return;
    const controller = new AbortController();
    setState({ value: null, error: null });
    fetchTeammates(upper, team, { id: selfId, name: player }, rows, controller.signal)
      .then((value) => { if (!controller.signal.aborted) setState({ value, error: null }); })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState({ value: null, error: error instanceof ApiError && error.status === 401 ? 'Sign in to see with/without splits.' : 'Teammate data could not load. Try again shortly.' });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, upper, team, rowsKey, selfId, player]);

  const boxGames = React.useMemo(() => (state.value?.available ? state.value.games || [] : []), [state.value]);
  const options = React.useMemo(() => teammateOptions(boxGames, { id: selfId, name: player }), [boxGames, selfId, player]);
  const pick = options.find((option) => option.id === chosen) || options[0] || null;
  const split = React.useMemo(
    // Only the games that were sent to be matched count.
    () => (pick ? withWithoutSplit(games.filter((game) => sentKeys.has(String(game.gameId))), boxGames, pick.id, upper, line, side === 'OVER') : null),
    [pick, games, sentKeys, boxGames, upper, line, side],
  );

  if (!supported) return null;

  return (
    <section data-qa="with-without" className="mt-2 overflow-hidden rounded-[10px] border border-[var(--line-strong)] bg-[var(--surface-2)]">
      <div className="flex items-center justify-between border-b border-[var(--line-strong)] px-3 py-2">
        <div className="flex items-center gap-1.5 text-[12px] font-black text-white"><Users className="h-3.5 w-3.5 text-[var(--accent-2)]" />With / Without</div>
        <span className="text-[11px] font-bold text-[var(--accent-2)]">BOX SCORES</span>
      </div>
      <div className="px-3 py-3">
        {state.error ? (
          <p className="text-[12px] text-[var(--text-2)]">{state.error}</p>
        ) : !state.value ? (
          <p className="text-[12px] text-[var(--text-3)]">Loading who played in each game…</p>
        ) : !state.value.available ? (
          <p className="text-[12px] text-[var(--text-2)]">{state.value.message || 'Teammate participation is unavailable for these games.'}</p>
        ) : !options.length || !pick || !split ? (
          <p className="text-[12px] text-[var(--text-2)]">Every teammate in these games either always played or never did, so there is nothing to split on.</p>
        ) : (
          <>
            <label className="flex items-center gap-2 text-[12px] font-bold text-[var(--text-2)]">
              <span className="shrink-0">Teammate</span>
              <select
                value={pick.id}
                onChange={(event) => setChosen(event.target.value)}
                className="h-9 min-w-0 flex-1 rounded-[6px] border border-[var(--line-strong)] bg-[var(--surface)] px-2 text-[13px] font-bold text-white"
              >
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name} · missed {option.missed}{option.minutes !== null ? ` · ${option.minutes} min` : ''}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <Side label={`With ${pick.name.split(' ').slice(-1)[0]}`} value={split.with} line={line} over={side === 'OVER'} />
              <Side label={`Without ${pick.name.split(' ').slice(-1)[0]}`} value={split.without} line={line} over={side === 'OVER'} />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-3)]">
              {player}&apos;s {split.with.games + split.without.games} games with {pick.name} on the team, split by whether {pick.name} played.
              {split.notListed ? ` ${pick.name} was not on the team for ${split.notListed} more.` : ''}
              {split.noBoxScore ? ` ${split.noBoxScore} game${split.noBoxScore === 1 ? '' : 's'} could not be matched to a box score.` : ''}
              {' '}Other lineup changes are not controlled for.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
