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
                    liveCount > 0
                      ? 'animate-pulse bg-[var(--pos)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--pos)_18%,transparent)]'
                      : 'bg-[var(--text-3)]',
                  ].join(' ')}
                />
              )}
              <span>{filter}</span>
              {filter === 'live' && liveCount > 0 && (
                <span className="font-mono text-[10px] font-bold text-[var(--pos)]">{liveCount}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2.5 p-2.5 sm:p-3">
        {isLoading ? (
          <div className="py-12 text-center font-mono text-[11px] tracking-[.08em] text-[var(--text-3)]">
            UPDATING FEED...
          </div>
        ) : displayedEvents.length === 0 ? (
          <div className="py-12 text-center text-[12px] text-[var(--text-3)]">
            {activeFilter === 'live'
              ? 'No games currently in play.'
              : activeFilter === 'finished'
                ? 'No recent finals for this sport.'
                : 'No scheduled fixtures in the current window.'}
          </div>
        ) : (
          displayedEvents.map((event) => (
            <MatchCard key={event.id} event={event} onSelect={onSelectMatch} />
          ))
        )}
      </div>
    </section>
  );
}

/**
 * A team's mark at a size a thumb can resolve.
 *
 * The fallback tint is derived from the abbreviation rather than a brand
 * palette: the feed carries no team colours, and inventing one per club would
 * put a wrong colour next to a real logo. A stable hue per abbreviation keeps
 * two teams in the same card distinguishable without claiming to be official.
 */
function TeamMark({ logoUrl, label }: { logoUrl?: string; label: string }) {
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => { setFailed(false); }, [logoUrl]);

  if (logoUrl && !failed) {
    return (
      <img
        src={logoUrl}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="size-6 shrink-0 object-contain"
      />
    );
  }

  let hue = 0;
  for (const character of label) hue = (hue * 31 + character.charCodeAt(0)) % 360;

  return (
    <span
      aria-hidden="true"
      style={{
        backgroundColor: `color-mix(in srgb, hsl(${hue} 58% 52%) 20%, transparent)`,
        color: `hsl(${hue} 58% 68%)`,
      }}
      className="grid size-6 shrink-0 place-items-center rounded-full text-[9px] font-black tracking-tight"
    >
      {label.slice(0, 3).toUpperCase()}
    </span>
  );
}

/**
 * Split a pre-game status into the day and the time.
 *
 * The card shows a status on the header and a value on the away row, and a
 * scheduled game would otherwise put the same "Today · 7:15 PM" in both, a few
 * pixels apart. The day goes in the header and the clock beside the team, so
 * each slot carries something the other does not.
 */
function splitStart(statusDetail: string) {
  const parts = statusDetail.split('·').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return { day: parts[0], time: parts.slice(1).join(' · ') };
  // `formatStart` omits the day for a game later today.
  return { day: 'Today', time: statusDetail };
}

/** "Sep 21" for the card header, omitted when the feed gave no kick-off. */
function shortDate(startsAt?: string) {
  if (!startsAt) return '';
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * One team's line in a card.
 *
 * The name is allowed to wrap to a second line rather than truncate. Fitting
 * both clubs and a score across one row is what forced the truncation this
 * replaces, and a shortened name is only used where the feed supplies a real
 * abbreviation.
 */
function TeamLine({
  team,
  trailing,
  emphasis,
}: {
  team: { name: string; shortName: string; logoUrl?: string };
  trailing: React.ReactNode;
  emphasis: 'win' | 'loss' | 'neutral';
}) {
  const nameTone =
    emphasis === 'win'
      ? 'text-[var(--text)] font-semibold'
      : emphasis === 'loss'
        ? 'text-[var(--text-3)] font-normal'
        : 'text-[var(--text-2)] font-medium';

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <TeamMark logoUrl={team.logoUrl} label={team.shortName || team.name} />
        <span className={`text-sm leading-tight ${nameTone}`}>{team.name}</span>
      </div>
      {trailing}
    </div>
  );
}

function MatchCard({
  event,
  onSelect,
}: {
  event: ScoreboardEvent;
  onSelect?: (id: string) => void;
}) {
  const { status, statusDetail, homeTeam, awayTeam, startsAt, venue, broadcast } = event;
  const isLive = status === 'live';
  const isFinished = status === 'finished';
  const hasScore = awayTeam.score !== undefined && homeTeam.score !== undefined;
  const date = shortDate(startsAt);
  const upcoming = !isLive && !isFinished;
  const start = upcoming ? splitStart(statusDetail) : null;

  // Before kick-off there is no winner to emphasise and no score to show, so
  // both teams read level and the score column carries the start time instead.
  const emphasisFor = (isWinner?: boolean) =>
    !isFinished ? 'neutral' : isWinner ? 'win' : 'loss';

  const scoreFor = (value: number | string | undefined, isWinner?: boolean) => {
    if (!hasScore) return null;
    const tone = isLive
      ? 'text-[var(--pos)] font-bold'
      : isFinished && isWinner
        ? 'text-[var(--text)] font-bold'
        : isFinished
          ? 'text-[var(--text-3)] font-normal'
          : 'text-[var(--text-2)] font-semibold';
    return <span className={`shrink-0 text-base tabular-nums ${tone}`}>{value}</span>;
  };

  const Wrapper = onSelect ? 'button' : 'div';

  return (
    <Wrapper
      {...(onSelect ? { type: 'button' as const, onClick: () => onSelect(event.id) } : {})}
      className={[
        'flex w-full flex-col gap-2 rounded-xl border p-3.5 text-left transition-colors',
        'border-[var(--line)] bg-[color-mix(in_srgb,var(--surface)_70%,transparent)]',
        onSelect ? 'cursor-pointer hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)]' : '',
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[color-mix(in_srgb,var(--line)_60%,transparent)] pb-1.5">
        {isLive ? (
          <span className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-[var(--pos)]">
            <span aria-hidden="true" className="size-1.5 shrink-0 animate-pulse rounded-full bg-[var(--pos)]" />
            {statusDetail || 'LIVE'}
          </span>
        ) : (
          <span className="truncate text-xs font-medium tracking-wide text-[var(--text-3)]">
            {isFinished ? 'FINAL' : start?.day}
          </span>
        )}
        {date && <span className="shrink-0 text-[11px] text-[var(--text-3)]">{date}</span>}
      </div>

      <div className="flex flex-col gap-2">
        <TeamLine
          team={awayTeam}
          emphasis={emphasisFor(awayTeam.isWinner)}
          trailing={
            scoreFor(awayTeam.score, awayTeam.isWinner)
            ?? <span className="shrink-0 text-xs font-medium text-[var(--text-2)]">{start?.time}</span>
          }
        />
        <TeamLine
          team={homeTeam}
          emphasis={emphasisFor(homeTeam.isWinner)}
          trailing={scoreFor(homeTeam.score, homeTeam.isWinner) ?? <span aria-hidden="true" className="shrink-0" />}
        />
      </div>

      {(venue || broadcast) && (
        <div className="truncate text-[11px] text-[var(--text-3)]">{venue || broadcast}</div>
      )}
    </Wrapper>
  );
}
