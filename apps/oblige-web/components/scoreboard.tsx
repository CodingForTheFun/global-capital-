'use client';

import * as React from 'react';
import { Radio, RefreshCw } from 'lucide-react';
import type {
  ScoreboardEvent,
  ScoreboardFilter,
  ScoreboardProps,
  SportKey,
} from '@/lib/scoreboard-types';

const SPORTS: { key: SportKey; label: string }[] = [
  { key: 'nfl', label: 'NFL' },
  { key: 'nba', label: 'NBA' },
  { key: 'soccer', label: 'EPL' },
  { key: 'nhl', label: 'NHL' },
  { key: 'mlb', label: 'MLB' },
];

const FILTERS: ScoreboardFilter[] = ['all', 'live', 'finished'];

type LiveApiGame = {
  id?: string;
  gameId?: string | number;
  sport?: string;
  league?: string;
  status?: string;
  providerStatus?: string | null;
  periodLabel?: string | null;
  clock?: string | null;
  startTime?: string | null;
  homeTeam?: string | null;
  awayTeam?: string | null;
  homeName?: string | null;
  awayName?: string | null;
  homeLogo?: string | null;
  awayLogo?: string | null;
  homeScore?: number | string | null;
  awayScore?: number | string | null;
  venue?: string | null;
  broadcast?: string | null;
};

type LiveApiSnapshot = {
  fetchedAt?: string;
  games?: LiveApiGame[];
};

function apiSport(value: string | undefined): SportKey | null {
  const sport = String(value || '').toUpperCase();
  if (sport === 'NFL') return 'nfl';
  if (sport === 'NBA') return 'nba';
  if (sport === 'MLB') return 'mlb';
  if (sport === 'NHL') return 'nhl';
  if (sport === 'SOCCER') return 'soccer';
  return null;
}

function matchStatus(value: string | undefined): ScoreboardEvent['status'] {
  if (String(value || '').toUpperCase() === 'LIVE') return 'live';
  if (String(value || '').toUpperCase() === 'FINAL') return 'finished';
  return 'scheduled';
}

function scheduledLabel(startTime: string | null | undefined) {
  if (!startTime) return 'TBD';
  const date = new Date(startTime);
  if (!Number.isFinite(date.getTime())) return 'TBD';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function statusLabel(game: LiveApiGame, status: ScoreboardEvent['status']) {
  if (status === 'finished') return 'FT';
  if (status === 'scheduled') return scheduledLabel(game.startTime);
  return (
    String(game.providerStatus || '').trim()
    || String(game.periodLabel || '').trim()
    || String(game.clock || '').trim()
    || 'LIVE'
  );
}

function winner(side: 'home' | 'away', status: ScoreboardEvent['status'], homeScore: LiveApiGame['homeScore'], awayScore: LiveApiGame['awayScore']) {
  if (status !== 'finished') return false;
  const home = Number(homeScore);
  const away = Number(awayScore);
  if (!Number.isFinite(home) || !Number.isFinite(away) || home === away) return false;
  return side === 'home' ? home > away : away > home;
}

function normalizeGame(game: LiveApiGame): ScoreboardEvent | null {
  const sport = apiSport(game.sport);
  if (!sport) return null;
  const status = matchStatus(game.status);
  const id = String(game.id || game.gameId || '').trim();
  if (!id) return null;

  const homeName = String(game.homeName || game.homeTeam || 'Home').trim();
  const awayName = String(game.awayName || game.awayTeam || 'Away').trim();
  const homeShort = String(game.homeTeam || homeName).trim();
  const awayShort = String(game.awayTeam || awayName).trim();

  return {
    id,
    sport,
    status,
    statusDetail: statusLabel(game, status),
    homeTeam: {
      id: homeShort || homeName,
      name: homeName,
      shortName: homeShort,
      logoUrl: game.homeLogo || undefined,
      score: game.homeScore ?? undefined,
      isWinner: winner('home', status, game.homeScore, game.awayScore),
    },
    awayTeam: {
      id: awayShort || awayName,
      name: awayName,
      shortName: awayShort,
      logoUrl: game.awayLogo || undefined,
      score: game.awayScore ?? undefined,
      isWinner: winner('away', status, game.homeScore, game.awayScore),
    },
    venue: game.venue || undefined,
    broadcast: game.broadcast || undefined,
  };
}

export function ScoresWorkspace() {
  const [events, setEvents] = React.useState<ScoreboardEvent[]>([]);
  const [activeSport, setActiveSport] = React.useState<SportKey>('nfl');
  const [activeFilter, setActiveFilter] = React.useState<ScoreboardFilter>('all');
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = React.useState<string | null>(null);

  const refresh = React.useCallback(async (force = false) => {
    setError(null);
    setLoading(true);
    try {
      const query = new URLSearchParams({
        sports: 'NFL,NBA,SOCCER,NHL,MLB',
        ...(force ? { force: '1' } : {}),
      });
      const response = await fetch('/api/live?' + query.toString(), {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });
      const body = (await response.json().catch(() => null)) as LiveApiSnapshot | null;
      if (!response.ok || !body) throw new Error('Scores are temporarily unavailable.');
      const next = (Array.isArray(body.games) ? body.games : [])
        .map(normalizeGame)
        .filter((event): event is ScoreboardEvent => Boolean(event));
      setEvents(next);
      setUpdatedAt(body.fetchedAt || new Date().toISOString());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Scores are temporarily unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh(false);
  }, [refresh]);

  const liveCount = React.useMemo(
    () => events.filter((event) => event.sport === activeSport && event.status === 'live').length,
    [events, activeSport],
  );

  React.useEffect(() => {
    const delay = liveCount > 0 ? 30_000 : 90_000;
    const timer = window.setInterval(() => void refresh(false), delay);
    return () => window.clearInterval(timer);
  }, [liveCount, refresh]);

  return (
    <div className="mx-auto w-full max-w-[1100px] px-3 pb-24 pt-4 md:px-8 md:pt-8 lg:pb-12">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.16em] text-[var(--accent)]">
            <Radio className="size-3.5" aria-hidden="true" />
            Live scores
          </div>
          <h1 className="mt-2 text-[30px] font-extrabold tracking-[-.045em] text-[var(--text)] md:text-[38px]">
            Scores
          </h1>
          <p className="mt-1 text-[12px] text-[var(--text-3)] md:text-[13px]">
            Live, scheduled and completed games. ESPN first with verified Sportradar fallback.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh(true)}
          disabled={loading}
          className="inline-flex min-h-9 items-center gap-2 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-3 text-[11px] font-semibold text-[var(--text-2)] disabled:opacity-50"
        >
          <RefreshCw className={"size-3.5 " + (loading ? 'animate-spin' : '')} aria-hidden="true" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-[10px] border border-[color-mix(in_srgb,var(--neg)_35%,transparent)] bg-[color-mix(in_srgb,var(--neg)_8%,transparent)] px-3 py-2 text-[11px] text-[var(--neg)]">
          {error}
        </div>
      )}

      <Scoreboard
        events={events}
        activeSport={activeSport}
        activeFilter={activeFilter}
        onSportChange={setActiveSport}
        onFilterChange={setActiveFilter}
        isLoading={loading && events.length === 0}
      />

      <div className="mt-2 text-right text-[10px] text-[var(--text-3)]">
        {updatedAt ? 'Updated ' + new Date(updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Waiting for score feed'}
      </div>
    </div>
  );
}

export function Scoreboard({
  events,
  activeSport,
  activeFilter,
  onSportChange,
  onFilterChange,
  onSelectMatch,
  isLoading = false,
}: ScoreboardProps) {
  const liveCount = React.useMemo(
    () => events.filter((event) => event.sport === activeSport && event.status === 'live').length,
    [events, activeSport],
  );

  const displayedEvents = React.useMemo(
    () =>
      events
        .filter((event) => event.sport === activeSport)
        .filter((event) => (activeFilter === 'all' ? true : event.status === activeFilter)),
    [events, activeSport, activeFilter],
  );

  return (
    <section className="w-full overflow-hidden rounded-[14px] border border-[var(--line)] bg-[#0f1115] text-neutral-200 shadow-[0_14px_38px_rgba(0,0,0,.24)]">
      <div className="flex flex-col gap-2.5 border-b border-neutral-800 bg-[#14171d] px-3 py-2.5 md:flex-row md:items-center md:justify-between md:px-4">
        <div className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SPORTS.map((sport) => (
            <button
              key={sport.key}
              type="button"
              onClick={() => onSportChange(sport.key)}
              aria-pressed={activeSport === sport.key}
              className={[
                'shrink-0 rounded px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors',
                activeSport === sport.key
                  ? 'border border-neutral-700/60 bg-neutral-800 text-white'
                  : 'text-neutral-400 hover:bg-neutral-800/40 hover:text-neutral-200',
              ].join(' ')}
            >
              {sport.label}
            </button>
          ))}
        </div>

        <div className="flex w-max items-center gap-1 rounded border border-neutral-800/80 bg-[#0b0d10] p-0.5">
          {FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => onFilterChange(filter)}
              className={[
                'relative flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-medium capitalize transition-colors',
                activeFilter === filter ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-neutral-200',
              ].join(' ')}
            >
              {filter === 'live' && (
                <span className={'h-1.5 w-1.5 rounded-full ' + (liveCount > 0 ? 'bg-red-500 animate-pulse' : 'bg-neutral-600')} />
              )}
              <span>{filter}</span>
              {filter === 'live' && liveCount > 0 && (
                <span className="font-mono text-[10px] font-bold text-red-400">{liveCount}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="divide-y divide-neutral-800/60">
        {isLoading ? (
          <div className="py-12 text-center font-mono text-[11px] tracking-wide text-neutral-500">UPDATING FEED...</div>
        ) : displayedEvents.length === 0 ? (
          <div className="py-12 text-center text-[11px] text-neutral-500">
            {activeFilter === 'live' ? 'No games currently in play.' : 'No games in this view.'}
          </div>
        ) : (
          displayedEvents.map((event) => <MatchRow key={event.id} event={event} onSelect={onSelectMatch} />)
        )}
      </div>
    </section>
  );
}

function TeamMark({ team }: { team: ScoreboardEvent['homeTeam'] }) {
  if (team.logoUrl) {
    return <img src={team.logoUrl} alt="" className="h-4 w-4 shrink-0 object-contain opacity-90" />;
  }
  return (
    <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-neutral-800 text-[6px] font-bold text-neutral-400">
      {team.shortName.slice(0, 2).toUpperCase()}
    </span>
  );
}

function MatchRow({ event, onSelect }: { event: ScoreboardEvent; onSelect?: (id: string) => void }) {
  const { status, statusDetail, homeTeam, awayTeam, venue, broadcast } = event;
  const isLive = status === 'live';
  const isFinished = status === 'finished';
  const hasScore = homeTeam.score !== undefined && awayTeam.score !== undefined;

  return (
    <button
      type="button"
      onClick={() => onSelect?.(event.id)}
      className="group grid w-full grid-cols-[62px_minmax(0,1fr)_54px_minmax(0,1fr)] items-center px-2.5 py-2.5 text-left transition hover:bg-[#151921] md:grid-cols-[80px_minmax(0,1fr)_64px_minmax(0,1fr)_100px] md:px-4"
    >
      <div className="min-w-0">
        {isLive ? (
          <span className="flex items-center gap-1 truncate font-mono text-[10px] font-bold text-red-500">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500 animate-pulse" />
            {statusDetail}
          </span>
        ) : isFinished ? (
          <span className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">FT</span>
        ) : (
          <span className="font-mono text-[10px] text-neutral-400">{statusDetail}</span>
        )}
      </div>

      <div className="flex min-w-0 items-center justify-end gap-1.5 pr-2 md:gap-2 md:pr-3">
        <span className={'truncate text-right text-[10px] md:text-xs ' + (awayTeam.isWinner ? 'font-semibold text-white' : 'text-neutral-300')}>
          {awayTeam.name}
        </span>
        <TeamMark team={awayTeam} />
      </div>

      <div className="flex items-center justify-center">
        <div className="w-12 rounded border border-neutral-800 bg-[#0a0c0f] py-1 text-center font-mono text-[9px] tracking-wider md:w-14 md:text-xs">
          {hasScore && (isLive || isFinished) ? (
            <span className={isLive ? 'font-bold text-emerald-400' : 'text-neutral-200'}>
              {awayTeam.score} - {homeTeam.score}
            </span>
          ) : (
            <span className="text-[9px] text-neutral-500">VS</span>
          )}
        </div>
      </div>

      <div className="flex min-w-0 items-center justify-start gap-1.5 pl-2 md:gap-2 md:pl-3">
        <TeamMark team={homeTeam} />
        <span className={'truncate text-[10px] md:text-xs ' + (homeTeam.isWinner ? 'font-semibold text-white' : 'text-neutral-300')}>
          {homeTeam.name}
        </span>
      </div>

      <div className="hidden min-w-0 text-right md:block">
        <span className="block truncate text-[9px] text-neutral-500">{venue || broadcast || ''}</span>
      </div>
    </button>
  );
}
