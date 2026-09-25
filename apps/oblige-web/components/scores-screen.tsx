'use client';

import * as React from 'react';
import { RefreshCw } from 'lucide-react';
import { Scoreboard } from '@/components/scoreboard/scoreboard';
import type { MatchStatus, ScoreboardEvent, SportKey } from '@/components/scoreboard/types';
import { teamLogoUrl } from '@/lib/api';

const API_SPORTS = 'NFL,NBA,SOCCER,NHL,MLB';
const SPORT_MAP: Record<string, SportKey> = {
  NFL: 'nfl',
  NBA: 'nba',
  SOCCER: 'soccer',
  NHL: 'nhl',
  MLB: 'mlb',
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function score(value: unknown): number | string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : value.trim();
  }
  return undefined;
}

function matchStatus(value: unknown): MatchStatus {
  const raw = text(value).toUpperCase();
  if (raw === 'LIVE') return 'live';
  if (raw === 'FINAL') return 'finished';
  return 'scheduled';
}

function formatStart(value: unknown): string {
  const date = new Date(text(value));
  if (!Number.isFinite(date.getTime())) return 'TBD';
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return sameDay ? time : `${date.toLocaleDateString([], { weekday: 'short' })} · ${time}`;
}

function winnerFlags(
  status: MatchStatus,
  awayScore: number | string | undefined,
  homeScore: number | string | undefined,
) {
  if (status !== 'finished') return { away: false, home: false };
  const away = Number(awayScore);
  const home = Number(homeScore);
  if (!Number.isFinite(away) || !Number.isFinite(home) || away === home) return { away: false, home: false };
  return { away: away > home, home: home > away };
}

/**
 * Crests come through the same-origin logo route: the site's CSP blocks
 * third-party images, so a feed's own logo URL would never load. Soccer has
 * no single league directory to match against, so it keeps the feed's URL
 * and the card's initials fallback.
 */
function logoFor(sport: SportKey, name: string, feedLogo: unknown): string | undefined {
  if (sport !== 'soccer' && name) return teamLogoUrl(sport, name);
  return text(feedLogo) || undefined;
}

function adaptGame(raw: unknown): ScoreboardEvent | null {
  const game = object(raw);
  const sport = SPORT_MAP[text(game.sport).toUpperCase()];
  const id = text(game.id || game.gameId);
  if (!sport || !id) return null;

  const status = matchStatus(game.status);
  const awayScore = score(game.awayScore);
  const homeScore = score(game.homeScore);
  const winners = winnerFlags(status, awayScore, homeScore);

  const awayName = text(game.awayName || game.awayTeam) || 'Away';
  const homeName = text(game.homeName || game.homeTeam) || 'Home';
  const awayShort = text(game.awayTeam) || awayName;
  const homeShort = text(game.homeTeam) || homeName;

  const liveDetail =
    text(game.providerStatus)
    || text(game.periodLabel)
    || text(game.clock)
    || 'LIVE';

  return {
    id,
    sport,
    status,
    statusDetail:
      status === 'live'
        ? liveDetail
        : status === 'finished'
          ? 'FT'
          : formatStart(game.startTime),
    awayTeam: {
      id: text(game.awayTeamId) || `${id}:away`,
      name: awayName,
      shortName: awayShort,
      logoUrl: logoFor(sport, awayName, game.awayLogo),
      score: awayScore,
      isWinner: winners.away,
    },
    homeTeam: {
      id: text(game.homeTeamId) || `${id}:home`,
      name: homeName,
      shortName: homeShort,
      logoUrl: logoFor(sport, homeName, game.homeLogo),
      score: homeScore,
      isWinner: winners.home,
    },
    startsAt: text(game.startTime) || undefined,
    venue: text(game.venue) || undefined,
    broadcast: text(game.broadcast) || undefined,
  };
}

function snapshotEvents(payload: unknown): ScoreboardEvent[] {
  const body = object(payload);
  const games = Array.isArray(body.games) ? body.games : [];
  return games.map(adaptGame).filter((event): event is ScoreboardEvent => Boolean(event));
}

export function ScoresScreen() {
  const [events, setEvents] = React.useState<ScoreboardEvent[]>([]);
  const [activeSport, setActiveSport] = React.useState<SportKey>('nfl');
  const [activeFilter, setActiveFilter] = React.useState<'all' | 'live' | 'finished'>('all');
  const [isLoading, setIsLoading] = React.useState(true);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = React.useState<string | null>(null);
  const liveRef = React.useRef(0);

  const load = React.useCallback(async (force = false) => {
    if (force) setIsRefreshing(true);
    try {
      const response = await fetch(
        `/api/live?sports=${API_SPORTS}${force ? '&force=1' : ''}`,
        {
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
          cache: 'no-store',
        },
      );
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error('Scores are temporarily unavailable.');

      const next = snapshotEvents(payload);
      setEvents(next);
      liveRef.current = next.filter((event) => event.status === 'live').length;
      const body = object(payload);
      setFetchedAt(text(body.fetchedAt) || new Date().toISOString());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Scores are temporarily unavailable.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    void load(false);

    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const schedule = () => {
      if (cancelled || document.hidden) return;
      timer = setTimeout(async () => {
        await load(false);
        schedule();
      }, liveRef.current > 0 ? 30_000 : 90_000);
    };

    schedule();

    const onVisibility = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (!document.hidden) {
        void load(false).finally(schedule);
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load]);

  return (
    <div className="mx-auto w-full max-w-[var(--maxw)] px-3 pb-24 pt-4 sm:px-6 sm:pt-6 lg:px-8 lg:pb-12">
      <div className="mx-auto mb-4 flex w-full max-w-5xl items-end justify-between gap-4">
        <div>
          <span className="text-[12px] font-bold uppercase tracking-[.16em] text-[var(--accent)]">Live sports</span>
          <h1 className="mt-1 font-display text-2xl font-black tracking-[-.04em] text-[var(--text)] sm:text-3xl">Scores</h1>
          <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-[var(--text-3)] sm:text-xs">
            Live and recent scores for NFL, NBA, EPL, NHL and MLB.
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={isRefreshing}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-[9px] border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface)_82%,transparent)] px-2.5 text-[12px] font-bold text-[var(--text-2)] transition-colors hover:text-[var(--text)] disabled:opacity-50"
          >
            <RefreshCw className={`size-3.5 ${isRefreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </button>
          <span className="font-mono text-[11px] text-[var(--text-3)]">
            {fetchedAt
              ? `Updated ${new Date(fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
              : 'Connecting…'}
          </span>
        </div>
      </div>

      {error && (
        <div className="mx-auto mb-3 w-full max-w-5xl rounded-[10px] border border-red-500/25 bg-red-500/5 px-3 py-2 text-[12px] text-red-300">
          {error}
        </div>
      )}

      <Scoreboard
        events={events}
        activeSport={activeSport}
        activeFilter={activeFilter}
        onSportChange={setActiveSport}
        onFilterChange={setActiveFilter}
        isLoading={isLoading}
      />
    </div>
  );
}
