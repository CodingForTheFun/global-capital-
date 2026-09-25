'use client';

import * as React from 'react';
import { Users } from 'lucide-react';
import type { PropGroup, ResearchResponse, Side } from '@/lib/types';
import { fetchResearch } from '@/lib/api';
import { opponentField } from '@/lib/opponent-field';

const shortDate = (value: string | null) => {
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) return '—';
  const date = new Date(time);
  return date.getMonth() + 1 + '/' + date.getDate();
};

/**
 * Other players' results against today's opponent, read from the opponent's
 * own verified match history. It loads only when scrolled into view, so a
 * page view that never reaches it costs no extra history request.
 */
export function OpponentField({
  group,
  opponent,
  line,
  side,
  marketLabel,
}: {
  group: PropGroup;
  opponent: string;
  line: number;
  side: Side;
  marketLabel: string;
}) {
  const ref = React.useRef<HTMLElement>(null);
  const [visible, setVisible] = React.useState(false);
  const [research, setResearch] = React.useState<ResearchResponse | null>(null);
  const [failed, setFailed] = React.useState(false);
  // The board refreshes the prop object; only its identity should refetch.
  const latestGroup = React.useRef(group);
  latestGroup.current = group;

  React.useEffect(() => {
    const node = ref.current;
    if (!node || visible) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '240px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  React.useEffect(() => {
    if (!visible || !opponent) return;
    const controller = new AbortController();
    setResearch(null);
    setFailed(false);
    // The opponent's own history for the same market. Identity fields that
    // belong to this player are cleared so they cannot pin the wrong person.
    const current = latestGroup.current;
    const opponentGroup: PropGroup = {
      ...current,
      key: current.key + '::field',
      propId: null,
      player: opponent,
      providerPlayerId: null,
      sportsGameOddsPlayerId: null,
      team: null,
      position: null,
      opponent: current.player,
    };
    fetchResearch(opponentGroup, 'OVER', controller.signal)
      .then(setResearch)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [visible, opponent, group.key]);

  const field = React.useMemo(
    () => (research?.available ? opponentField(research.gameLog || [], research.statKind, group.player, line, side) : null),
    [research, group.player, line, side],
  );
  const sideWord = side === 'UNDER' ? 'Under' : 'Over';

  return (
    <section ref={ref} data-qa="opponent-field" className="mt-2 overflow-hidden rounded-[10px] border border-[var(--line-strong)] bg-[var(--surface-2)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line-strong)] px-3 py-2">
        <Users className="h-4 w-4 text-[var(--accent-2)]" aria-hidden />
        <h3 className="min-w-0 truncate text-[12px] font-black text-white">Other players vs {opponent}</h3>
        {field && field.rows.length ? (
          <div className="ml-auto flex flex-wrap gap-1.5">
            <span className="rounded-[3px] border border-[var(--line-strong)] bg-[var(--pos-soft)] px-2 py-0.5 text-[12px] font-black text-[var(--pos)]">
              {field.hits}/{field.decided} hit {sideWord}
            </span>
            {field.averageDiff !== null ? (
              <span className={
                'rounded-[3px] border px-2 py-0.5 text-[12px] font-black '
                + (field.averageDiff >= 0 ? 'border-[var(--line-strong)] bg-[var(--pos-soft)] text-[var(--pos)]' : 'border-[var(--line-strong)] bg-[var(--neg-soft)] text-[var(--neg)]')
              }>
                Avg diff {field.averageDiff >= 0 ? '+' : ''}{field.averageDiff}
                {field.averageDiffPct !== null ? ` (${field.averageDiffPct >= 0 ? '+' : ''}${field.averageDiffPct}%)` : ''}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {!visible || (!research && !failed) ? (
        <div className="h-24 animate-pulse bg-[var(--surface-2)]" aria-label={`Loading other players vs ${opponent}`} />
      ) : failed || !research?.available ? (
        <p className="px-3 py-4 text-[12px] leading-4 text-[var(--text-2)]">
          {research?.message || `${opponent}'s verified match history is not available right now.`}
        </p>
      ) : !field ? (
        <p className="px-3 py-4 text-[12px] leading-4 text-[var(--text-2)]">
          Other players' {marketLabel.toLowerCase()} weren't returned with {opponent}'s matches, so this comparison isn't available for this market.
          Total games, games won and sets won can always be compared.
        </p>
      ) : !field.rows.length ? (
        <p className="px-3 py-4 text-[12px] leading-4 text-[var(--text-2)]">No other verified matches for {opponent} yet.</p>
      ) : (
        <>
          <div className="max-h-[320px] overflow-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="sticky top-0 bg-[var(--surface-2)] text-[11px] uppercase tracking-wide text-[var(--text-2)]">
                <tr>
                  <th className="px-3 py-1.5 font-bold">Player</th>
                  <th className="px-2 py-1.5 font-bold">Sets</th>
                  <th className="px-3 py-1.5 text-right font-bold">{marketLabel}</th>
                </tr>
              </thead>
              <tbody>
                {field.rows.map((row) => (
                  <tr key={row.gameId} className="border-t border-[var(--line-strong)]">
                    <td className="max-w-0 px-3 py-2">
                      <div className="truncate font-bold text-white">{row.player}</div>
                      <div className="text-[12px] text-[var(--text-2)]">{shortDate(row.date)}</div>
                    </td>
                    <td className={
                      'px-2 py-2 font-black tabular-nums '
                      + (row.result === 'W' ? 'text-[var(--pos)]' : row.result === 'L' ? 'text-[var(--neg)]' : 'text-[var(--text-2)]')
                    }>
                      {row.setScore || '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className={
                        'font-black tabular-nums '
                        + (row.push ? 'text-[var(--text)]' : row.hit ? 'text-[var(--pos)]' : 'text-[var(--neg)]')
                      }>
                        {row.value}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-[var(--line-strong)] px-3 py-2 text-[12px] leading-4 text-[var(--text-3)]">
            Each value is compared with today's line of {line}, not the line posted for that match. Set scores are shown from the other player's side.
          </p>
        </>
      )}
    </section>
  );
}
