'use client';

import * as React from 'react';
import { RefreshCw } from 'lucide-react';
import type { MatchupPlayer, MatchupResponse, MatchupTeam, PropGroup } from '@/lib/types';
import { fetchMatchup } from '@/lib/api';
import { odds } from '@/lib/utils';

const ESPN_GAME_URL = /^https:\/\/www\.espn\.com\/[a-z0-9-]+\/(?:game|match)\/_\/gameId\/\d+$/;

function expired(value: MatchupResponse | null) {
  if (!value?.available) return false;
  const until = Date.parse(value.expiresAt || '');
  return !Number.isFinite(until) || until <= Date.now();
}

/** `odds(null)` reads as "0"; a missing price must stay a dash. */
function moneyline(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : odds(value);
}

function reportedDate(value: string | null | undefined) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? new Date(time).toLocaleDateString() : 'Date not reported';
}

/** Only an exact provider identity links a report row to this prop's player. */
function ownRow(value: MatchupResponse | null, playerId: string | null, pick: (team: MatchupTeam) => MatchupPlayer[]) {
  if (!value?.available || !playerId || !/^history:[A-Z]+:\d+$/.test(playerId)) return null;
  const rows = (value.teams || []).flatMap(pick).filter((row) => row.playerId === playerId);
  return rows.length === 1 ? rows[0] : null;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="min-w-0 rounded-[10px] border border-[var(--line-strong)] bg-[var(--surface-2)] p-3">
      <h4 className="mb-2 truncate text-[11px] font-black text-white">{title}</h4>
      {children}
    </article>
  );
}

function Rows({ head, rows }: { head: [string, string, string]; rows: Array<[React.ReactNode, React.ReactNode, React.ReactNode]> }) {
  return (
    <div className="max-h-64 overflow-auto">
      <table className="w-full text-left text-[12px]">
        <thead className="sticky top-0 bg-[var(--surface-2)] text-[11px] uppercase tracking-wide text-[var(--text-3)]">
          <tr>{head.map((label) => <th key={label} className="py-1 pr-2 font-bold">{label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((cells, index) => (
            <tr key={index} className="border-t border-[var(--line)] align-top text-[var(--text-2)]">
              {cells.map((cell, column) => <td key={column} className="py-1.5 pr-2">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] leading-relaxed text-[var(--text-3)]">{children}</p>;
}

export function GameContext({ group }: { group: PropGroup }) {
  const [value, setValue] = React.useState<MatchupResponse | null>(null);
  const [revision, setRevision] = React.useState(0);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetchMatchup(group, controller.signal)
      .then(setValue)
      .catch(() => {
        if (!controller.signal.aborted) setValue({ available: false, message: 'Game context could not load. Try again shortly.' });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // The key captures player, market and line; the event fields decide the game.
  }, [group.key, group.homeTeam, group.awayTeam, group.startsAt, revision]); // eslint-disable-line react-hooks/exhaustive-deps

  const stale = expired(value);
  const ready = value?.available === true && !stale;
  const teams = ready ? value.teams || [] : [];
  const injury = ownRow(value, group.providerPlayerId, (team) => team.injuries?.rows || []);
  const starter = ownRow(value, group.providerPlayerId, (team) => team.lineup?.starters || []);
  const prediction = value?.prediction;
  const predictionReady = ready && prediction?.available === true
    && Date.parse(prediction.expiresAt || '') > Date.now()
    && Date.parse(value?.gameStartTime || '') > Date.now();
  const sourceUrl = ready && ESPN_GAME_URL.test(value?.sourceUrl || '') ? value?.sourceUrl : null;

  return (
    <section className="rounded-[10px] border border-[var(--line-strong)] bg-[var(--surface-2)] p-3 sm:p-4" aria-label="Game context" aria-busy={loading}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-black text-white">Game Context</h3>
          <p className="mt-0.5 text-[12px] text-[var(--text-3)]">Injuries, lineups and conditions for {group.matchup}</p>
        </div>
        <button
          type="button"
          onClick={() => setRevision((current) => current + 1)}
          disabled={loading}
          aria-label="Refresh game context"
          className="inline-flex min-h-9 items-center gap-1.5 rounded-[6px] border border-[var(--line-strong)] bg-[var(--surface)] px-2.5 text-[12px] font-bold text-white transition hover:border-[var(--line-strong)] disabled:cursor-wait disabled:opacity-60"
        >
          <RefreshCw className={`size-3 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          {loading ? 'Loading' : 'Refresh'}
        </button>
      </div>

      {!value ? (
        <Muted>Loading verified game context…</Muted>
      ) : !ready ? (
        <Muted>{stale ? 'This game context has expired. Refresh to check the latest report.' : value.message || 'Game context is unavailable for this game.'}</Muted>
      ) : (
        <div className="grid gap-3">
          {(injury || starter) && (
            <div className="flex flex-wrap gap-2" role="status">
              {injury && (
                <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[12px] font-black text-amber-300">
                  {group.player}: {injury.status}{injury.detail ? ` · ${injury.detail}` : ''}
                </span>
              )}
              {starter && (
                <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-[12px] font-black text-emerald-300">
                  {group.player}: listed starter
                </span>
              )}
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            {teams.map((team) => (
              <Card key={`injuries-${team.side}`} title={`${team.name || 'Team'} injuries`}>
                {!team.injuries?.available ? (
                  <Muted>No current injury report was returned for this team.</Muted>
                ) : !team.injuries.rows?.length ? (
                  <Muted>No players are listed in the returned report. This does not confirm everyone is healthy.</Muted>
                ) : (
                  <Rows
                    head={['Player', 'Status', 'Reported']}
                    rows={team.injuries.rows.map((row) => [
                      <span key="p" className={row.playerId && row.playerId === group.providerPlayerId ? 'font-black text-amber-300' : 'font-semibold text-white'}>
                        {row.playerName}
                        {row.position ? <span className="ml-1 text-[var(--text-3)]">{row.position}</span> : null}
                      </span>,
                      <span key="s">{row.status}{row.detail ? <span className="block text-[var(--text-3)]">{row.detail}</span> : null}</span>,
                      reportedDate(row.reportedAt),
                    ])}
                  />
                )}
              </Card>
            ))}
          </div>

          {teams.every((team) => !team.lineup?.available && !(team.lineup?.starters?.length || team.lineup?.probables?.length)) ? (
            <Muted>Lineups: confirmed starters have not been published for either team.</Muted>
          ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {teams.map((team) => {
              const rows = [...(team.lineup?.starters || []), ...(team.lineup?.probables || [])];
              return (
                <Card key={`lineup-${team.side}`} title={`${team.name || 'Team'} lineup`}>
                  {!team.lineup?.available && <Muted>Confirmed starters have not been published.</Muted>}
                  {rows.length > 0 && (
                    <Rows
                      head={['Player', 'Pos', 'Designation']}
                      rows={rows.map((row) => [
                        <span key="p" className="font-semibold text-white">{row.playerName}</span>,
                        row.position || '—',
                        row.status || '—',
                      ])}
                    />
                  )}
                </Card>
              );
            })}
          </div>
          )}

          <div className="grid gap-2 sm:grid-cols-3">
            <Card title="Pre-game win estimate">
              {predictionReady ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    {teams.map((team) => (
                      <div key={team.side}>
                        <div className="truncate text-[12px] font-bold text-[var(--text-3)]">{team.abbreviation || team.name}</div>
                        <div className="text-xl font-black tabular-nums text-white">
                          {team.side === 'home' ? prediction?.homePercent : prediction?.awayPercent}%
                        </div>
                      </div>
                    ))}
                  </div>
                  {prediction?.note && <p className="mt-2 text-[12px] text-[var(--text-3)]">{prediction.note}</p>}
                </>
              ) : (
                <Muted>{prediction?.message || 'A current pre-game estimate is not available.'}</Muted>
              )}
            </Card>
            <Card title="Game lines">
              {value.odds?.available ? (
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                  {teams.map((team) => (
                    <React.Fragment key={team.side}>
                      <dt className="truncate text-[var(--text-3)]">{team.abbreviation || team.name} ML</dt>
                      <dd className="text-right font-black tabular-nums text-white">
                        {moneyline(team.side === 'home' ? value.odds?.homeMoneyline : value.odds?.awayMoneyline)}
                      </dd>
                    </React.Fragment>
                  ))}
                  <dt className="text-[var(--text-3)]">Spread</dt>
                  <dd className="text-right font-black text-white">{value.odds.spread || '—'}</dd>
                  <dt className="text-[var(--text-3)]">Total</dt>
                  <dd className="text-right font-black tabular-nums text-white">{value.odds.total ?? '—'}</dd>
                </dl>
              ) : (
                <Muted>{value.odds?.message || 'Game odds have not been published for this matchup.'}</Muted>
              )}
            </Card>
            <Card title="Venue and weather">
              <p className="text-[12px] font-semibold text-white">
                {[value.venue?.name, value.venue?.city].filter(Boolean).join(' · ') || 'Venue not reported'}
                {value.venue?.indoor === true ? <span className="ml-1 text-[var(--text-3)]">(indoor)</span> : null}
              </p>
              {value.weather?.available ? (
                <p className="mt-1 text-[12px] text-[var(--text-2)]">
                  <strong className="text-white">{value.weather.temperature}{value.weather.unit}</strong> · {value.weather.note}
                </p>
              ) : (
                <Muted>{value.weather?.message || 'No weather report is available.'}</Muted>
              )}
              <div className="mt-2 grid gap-0.5 text-[12px] text-[var(--text-2)]">
                {teams.map((team) => (
                  <span key={team.side}>
                    {team.abbreviation || team.name}: {team.record || 'Record not reported'}
                    {team.rank ? ` · #${team.rank}` : ''}
                  </span>
                ))}
              </div>
            </Card>
          </div>

          <p className="text-[12px] leading-relaxed text-[var(--text-3)]">
            Team records are not opponent defensive ranks, and injury reports do not establish with/without-player effects.{' '}
            {sourceUrl ? (
              <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="font-bold text-sky-400 hover:underline">
                ESPN game report ↗
              </a>
            ) : (
              'ESPN game report'
            )}
            {value.retrievedAt ? ` · Retrieved ${new Date(value.retrievedAt).toLocaleString()}` : ''}
          </p>
        </div>
      )}
    </section>
  );
}
