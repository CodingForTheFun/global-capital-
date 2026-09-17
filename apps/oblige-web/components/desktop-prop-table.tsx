'use client';

import type { PropGroup } from '@/lib/types';
import { odds, shortTime } from '@/lib/utils';
import { PlayerPortraits, type PropCardStats } from '@/components/face-card';

function booksFor(group: PropGroup) {
  return [...new Set(group.quotes.map((quote) => String(quote.sportsbook || quote.sportsbookKey || '').trim()).filter(Boolean))];
}

function rateLabel(stats: PropCardStats | undefined) {
  if (!stats || stats.rate === null) return '—';
  return `${stats.rate}%`;
}

function rateTone(stats: PropCardStats | undefined) {
  const rate = stats?.rate;
  if (rate === null || rate === undefined) return 'none';
  if (rate >= 60) return 'pos';
  if (rate < 45) return 'neg';
  return 'mid';
}

export function DesktopPropTable({
  groups,
  stats,
  picks,
  onOpen,
  onPick,
}: {
  groups: PropGroup[];
  stats: Record<string, PropCardStats>;
  picks: Record<string, 'OVER' | 'UNDER'>;
  onOpen: (group: PropGroup) => void;
  onPick: (group: PropGroup, side: 'OVER' | 'UNDER') => void;
}) {
  return (
    <section className="desktop-prop-terminal hidden xl:block" aria-label="Desktop prop research table">
      <div className="desktop-prop-terminal__head">
        <div>
          <span>Research terminal</span>
          <strong>{groups.length.toLocaleString()} visible props</strong>
        </div>
        <p>Live provider-backed lines · click a row for deeper player research</p>
      </div>

      <div className="desktop-prop-table-wrap">
        <table className="desktop-prop-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Team</th>
              <th>Opponent</th>
              <th>Stat</th>
              <th>Line</th>
              <th>Over</th>
              <th>Under</th>
              <th>Hit rate</th>
              <th>Books</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const books = booksFor(group);
              const rowStats = stats[group.key];
              const kickoff = shortTime(group.startsAt);
              return (
                <tr key={group.key} onClick={() => onOpen(group)} tabIndex={0} onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onOpen(group);
                  }
                }}>
                  <td>
                    <div className="desktop-player-cell">
                      <PlayerPortraits
                        name={group.player}
                        sport={group.sport}
                        team={group.team}
                        providerPlayerId={group.providerPlayerId}
                        size={38}
                      />
                      <div>
                        <strong>{group.player}</strong>
                        <span>{kickoff || group.sport}</span>
                      </div>
                    </div>
                  </td>
                  <td className="desktop-prop-table__muted">{group.team || '—'}</td>
                  <td className="desktop-prop-table__muted">{group.opponent || '—'}</td>
                  <td><strong>{group.market}</strong></td>
                  <td className="num desktop-prop-table__line">{group.line}</td>
                  <td>
                    <button
                      type="button"
                      data-side="OVER"
                      aria-pressed={picks[group.key] === 'OVER'}
                      disabled={!group.bestOver}
                      onClick={(event) => {
                        event.stopPropagation();
                        onPick(group, 'OVER');
                      }}
                      className="desktop-quote-button"
                    >
                      <span>O</span>
                      <strong className="num">{group.bestOver ? odds(group.bestOver.price) : '—'}</strong>
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      data-side="UNDER"
                      aria-pressed={picks[group.key] === 'UNDER'}
                      disabled={!group.bestUnder}
                      onClick={(event) => {
                        event.stopPropagation();
                        onPick(group, 'UNDER');
                      }}
                      className="desktop-quote-button"
                    >
                      <span>U</span>
                      <strong className="num">{group.bestUnder ? odds(group.bestUnder.price) : '—'}</strong>
                    </button>
                  </td>
                  <td>
                    <span className="desktop-hit-rate num" data-tone={rateTone(rowStats)}>
                      {rateLabel(rowStats)}
                      {rowStats?.sample ? <small>{rowStats.hits}/{rowStats.sample}</small> : null}
                    </span>
                  </td>
                  <td>
                    <div className="desktop-book-stack" title={books.join(', ')}>
                      {books.slice(0, 3).map((book) => <span key={book}>{book}</span>)}
                      {books.length > 3 ? <span>+{books.length - 3}</span> : null}
                      {!books.length ? <span>—</span> : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
