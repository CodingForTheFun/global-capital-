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
    <section ref={ref} data-qa="opponent-field" className="mt-2 overflow-hidden rounded-[14px] border border-[#153D5F] bg-[#071321]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[#153D5F] px-3 py-2">
        <Users className="h-4 w-4 text-[#2FAEFF]" aria-hidden />
        <h3 className="min-w-0 truncate text-[12px] font-black text-white">Other players vs {opponent}</h3>
        {field && field.rows.length ? (
          <div className="ml-auto flex flex-wrap gap-1.5">
            <span className="rounded-md border border-[#1E8A5A] bg-[#0E3A2A] px-2 py-0.5 text-[9px] font-black text-[#23E787]">
              {field.hits}/{field.decided} hit {sideWord}
            </span>
            {field.averageDiff !== null ? (
              <span className={
                'rounded-md border px-2 py-0.5 text-[9px] font-black '
                + (field.averageDiff >= 0 ? 'border-[#1E8A5A] bg-[#0E3A2A] text-[#23E787]' : 'border-[#8A1E36] bg-[#3A0E1A] text-[#FF6B7D]')
              }>
                Avg diff {field.averageDiff >= 0 ? '+' : ''}{field.averageDiff}
                {field.averageDiffPct !== null ? ` (${field.averageDiffPct >= 0 ? '+' : ''}${field.averageDiffPct}%)` : ''}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {!visible || (!research && !failed) ? (
        <div className="h-24 animate-pulse bg-[#081421]" aria-label={`Loading other players vs ${opponent}`} />
      ) : failed || !research?.available ? (
        <p className="px-3 py-4 text-[10px] leading-4 text-[#7E97B0]">
          {research?.message || `${opponent}'s verified match history is not available right now.`}
        </p>
      ) : !field ? (
        <p className="px-3 py-4 text-[10px] leading-4 text-[#7E97B0]">
          Other players' {marketLabel.toLowerCase()} weren't returned with {opponent}'s matches, so this comparison isn't available for this market.
          Total games, games won and sets won can always be compared.
        </p>
      ) : !field.rows.length ? (
        <p className="px-3 py-4 text-[10px] leading-4 text-[#7E97B0]">No other verified matches for {opponent} yet.</p>
      ) : (
        <>
          <div className="max-h-[320px] overflow-auto">
            <table className="w-full text-left text-[10px]">
              <thead className="sticky top-0 bg-[#081421] text-[8px] uppercase tracking-wide text-[#66809B]">
                <tr>
                  <th className="px-3 py-1.5 font-bold">Player</th>
                  <th className="px-2 py-1.5 font-bold">Sets</th>
                  <th className="px-3 py-1.5 text-right font-bold">{marketLabel}</th>
                </tr>
              </thead>
              <tbody>
                {field.rows.map((row) => (
                  <tr key={row.gameId} className="border-t border-[#12304C]">
                    <td className="max-w-0 px-3 py-2">
                      <div className="truncate font-bold text-white">{row.player}</div>
                      <div className="text-[9px] text-[#66809B]">{shortDate(row.date)}</div>
                    </td>
                    <td className={
                      'px-2 py-2 font-black tabular-nums '
                      + (row.result === 'W' ? 'text-[#23E787]' : row.result === 'L' ? 'text-[#FF6B7D]' : 'text-[#91A7BE]')
                    }>
                      {row.setScore || '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className={
                        'font-black tabular-nums '
                        + (row.push ? 'text-[#C6D0DE]' : row.hit ? 'text-[#23E787]' : 'text-[#FF6B7D]')
                      }>
                        {row.value}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-[#153D5F] px-3 py-2 text-[9px] leading-4 text-[#55718E]">
            Each value is compared with today's line of {line}, not the line posted for that match. Set scores are shown from the other player's side.
          </p>
        </>
      )}
    </section>
  );
}
