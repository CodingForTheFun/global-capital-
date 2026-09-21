'use client';

import React, { useMemo } from 'react';
import type { ScoreboardEvent, ScoreboardProps, SportKey } from './types';

const SPORTS: { key: SportKey; label: string }[] = [
  { key: 'nfl', label: 'NFL' },
  { key: 'nba', label: 'NBA' },
  { key: 'soccer', label: 'EPL' },
  { key: 'nhl', label: 'NHL' },
  { key: 'mlb', label: 'MLB' },
];

export function Scoreboard({
  events,
  activeSport,
  activeFilter,
  onSportChange,
  onFilterChange,
  onSelectMatch,
  isLoading = false,
}: ScoreboardProps) {
  const liveCount = useMemo(
    () => events.filter((event) => event.sport === activeSport && event.status === 'live').length,
    [events, activeSport],
  );

  const displayedEvents = useMemo(
    () =>
      events
        .filter((event) => event.sport === activeSport)
        .filter((event) => (activeFilter === 'all' ? true : event.status === activeFilter)),
    [events, activeSport, activeFilter],
  );

  return (
    <section className="mx-auto w-full max-w-5xl overflow-hidden rounded-[18px] border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] text-[var(--text)] shadow-[0_20px_70px_rgba(0,0,0,.22)]">
      <div className="flex flex-col gap-2.5 border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--bg-deep)_88%,transparent)] px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SPORTS.map((sport) => (
            <button
              key={sport.key}
              type="button"
              onClick={() => onSportChange(sport.key)}
              aria-pressed={activeSport === sport.key}
              className={[
                'shrink-0 rounded-[9px] border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[.08em] transition-colors',
                activeSport === sport.key
                  ? 'border-[color-mix(in_srgb,var(--accent)_38%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--text)]'
                  : 'border-transparent text-[var(--text-3)] hover:border-[var(--line)] hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)] hover:text-[var(--text-2)]',
              ].join(' ')}
            >
              {sport.label}
            </button>
          ))}
        </div>

        <div className="flex w-fit items-center gap-0.5 rounded-[9px] border border-[var(--line)] bg-[var(--bg-deep)] p-0.5">
          {(['all', 'live', 'finished'] as const).map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => onFilterChange(filter)}
              aria-pressed={activeFilter === filter}
              className={[
                'flex min-h-7 items-center gap-1.5 rounded-[7px] px-2.5 text-[11px] font-semibold capitalize transition-colors',
                activeFilter === filter
                  ? 'bg-[color-mix(in_srgb,var(--text)_9%,transparent)] text-[var(--text)] shadow-sm'
                  : 'text-[var(--text-3)] hover:text-[var(--text-2)]',
              ].join(' ')}
            >
              {filter === 'live' && (
                <span
                  aria-hidden="true"
                  className={[
                    'size-1.5 rounded-full',
                    liveCount > 0 ? 'bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,.08)]' : 'bg-[var(--text-3)]',
                  ].join(' ')}
                />
              )}
              <span>{filter}</span>
              {filter === 'live' && liveCount > 0 && (
                <span className="font-mono text-[10px] font-bold text-red-400">{liveCount}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="divide-y divide-[color-mix(in_srgb,var(--line)_72%,transparent)]">
        {isLoading ? (
          <div className="py-14 text-center font-mono text-[11px] tracking-[.08em] text-[var(--text-3)]">
            UPDATING FEED...
          </div>
        ) : displayedEvents.length === 0 ? (
          <div className="py-14 text-center text-[12px] text-[var(--text-3)]">
            {activeFilter === 'live'
              ? 'No games currently in play.'
              : activeFilter === 'finished'
                ? 'No recent finals for this sport.'
                : 'No scheduled fixtures in the current window.'}
          </div>
        ) : (
          displayedEvents.map((event) => (
            <MatchRow key={event.id} event={event} onSelect={onSelectMatch} />
          ))
        )}
      </div>
    </section>
  );
}

function TeamMark({
  logoUrl,
  name,
}: {
  logoUrl?: string;
  name: string;
}) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        className="size-[18px] shrink-0 object-contain opacity-90"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="grid size-[18px] shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--text)_7%,transparent)] text-[6px] font-black text-[var(--text-3)]"
    >
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function MatchRow({
  event,
  onSelect,
}: {
  event: ScoreboardEvent;
  onSelect?: (id: string) => void;
}) {
  const { status, statusDetail, homeTeam, awayTeam, venue, broadcast } = event;
  const isLive = status === 'live';
  const isFinished = status === 'finished';
  const hasScore = awayTeam.score !== undefined && homeTeam.score !== undefined;

  return (
    <button
      type="button"
      onClick={() => onSelect?.(event.id)}
      disabled={!onSelect}
      className={[
        'group grid w-full grid-cols-[64px_minmax(0,1fr)_54px_minmax(0,1fr)] items-center px-2.5 py-2.5 text-left transition-colors',
        'sm:grid-cols-[80px_minmax(0,1fr)_64px_minmax(0,1fr)_100px] sm:px-4',
        onSelect ? 'cursor-pointer hover:bg-[color-mix(in_srgb,var(--text)_4%,transparent)]' : 'cursor-default',
      ].join(' ')}
    >
      <div className="min-w-0">
        {isLive ? (
          <span className="flex items-center gap-1 truncate font-mono text-[10px] font-bold text-red-400">
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-red-500" />
            {statusDetail || 'LIVE'}
          </span>
        ) : isFinished ? (
          <span className="text-[10px] font-semibold uppercase tracking-[.08em] text-[var(--text-3)]">FT</span>
        ) : (
          <span className="truncate font-mono text-[10px] text-[var(--text-3)]">{statusDetail}</span>
        )}
      </div>

      <div className="flex min-w-0 items-center justify-end gap-1.5 pr-2 text-right sm:gap-2 sm:pr-3">
        <span
          className={[
            'truncate text-[11px]',
            awayTeam.isWinner ? 'font-bold text-[var(--text)]' : 'text-[var(--text-2)]',
          ].join(' ')}
        >
          {awayTeam.name}
        </span>
        <TeamMark logoUrl={awayTeam.logoUrl} name={awayTeam.shortName || awayTeam.name} />
      </div>

      <div className="flex items-center justify-center">
        <div
          className={[
            'w-[50px] rounded-[7px] border border-[var(--line)] bg-[var(--bg-deep)] px-1 py-1 text-center font-mono text-[10px] font-bold tracking-tight sm:w-[58px]',
            isLive ? 'text-emerald-400' : hasScore ? 'text-[var(--text)]' : 'text-[var(--text-3)]',
          ].join(' ')}
        >
          {hasScore ? (
            <span>{awayTeam.score} - {homeTeam.score}</span>
          ) : (
            <span className="text-[9px]">VS</span>
          )}
        </div>
      </div>

      <div className="flex min-w-0 items-center justify-start gap-1.5 pl-2 sm:gap-2 sm:pl-3">
        <TeamMark logoUrl={homeTeam.logoUrl} name={homeTeam.shortName || homeTeam.name} />
        <span
          className={[
            'truncate text-[11px]',
            homeTeam.isWinner ? 'font-bold text-[var(--text)]' : 'text-[var(--text-2)]',
          ].join(' ')}
        >
          {homeTeam.name}
        </span>
      </div>

      <div className="hidden min-w-0 text-right sm:block">
        <span className="block truncate text-[9px] text-[var(--text-3)]">{venue || broadcast || ''}</span>
      </div>
    </button>
  );
}
