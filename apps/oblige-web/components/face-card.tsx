'use client';

import * as React from 'react';
import { ART, teamFor } from '@/lib/teams';
import { fetchResearch, playedGames } from '@/lib/api';
import { PlayerHeadshot } from '@/components/player-headshot';
import type { GameLogRow, PropGroup } from '@/lib/types';
import { cn, initials, odds, rateTone, shortTime } from '@/lib/utils';
import { Badge, Dot } from '@/components/ui/badge';

/* ------------------------------------------------------------- team scene */

/**
 * The club's own backdrop, behind the player's face. It is one absolutely
 * positioned layer inside the card, so it cannot affect layout and does not
 * move when the card lifts on hover.
 */
export function TeamScene({ team, tall }: { team?: string | null; tall?: boolean }) {
  const club = teamFor(team);
  return (
    <span
      className="facebg"
      data-tall={tall ? 'true' : 'false'}
      aria-hidden="true"
      style={{ ['--t1' as string]: club.c1, ['--t2' as string]: club.c2 }}
    >
      <span className="facebg__band">
        <svg
          viewBox="0 0 400 150"
          preserveAspectRatio="xMinYMax slice"
          focusable="false"
          dangerouslySetInnerHTML={{ __html: ART[club.art] }}
        />
      </span>
    </span>
  );
}

/* ----------------------------------------------------------------- avatar */

/**
 * The headshot comes from the existing artwork route, which already falls back
 * to an initials card when a player has no verified photo. This still handles
 * a failed image load, because a broken icon on a card is worse than initials.
 */
export function PlayerAvatar({
  name,
  sport,
  team,
  providerPlayerId,
  size = 50,
  className,
}: {
  name: string;
  sport: string;
  team?: string | null;
  providerPlayerId?: string | null;
  size?: number;
  className?: string;
}) {
  return (
    <span className={cn('ringavatar', className)} style={{ width: size, height: size }}>
      <span className="relative grid size-full place-items-center overflow-hidden rounded-full bg-[var(--face-surface-2)]">
        <PlayerHeadshot sport={sport} name={name} team={team} providerPlayerId={providerPlayerId}
          className="absolute inset-0 size-full object-cover object-top" />
      </span>
    </span>
  );
}

/**
 * Combo markets previously sent the entire display label to the artwork route,
 * which guarantees an initials fallback for strings such as "A + B". Split the
 * presentation identity only; research/player contracts still receive the
 * original provider label untouched.
 */
function playerNames(label: string) {
  const names = label
    .split(/\s+(?:\+|&|\/)\s+|\s*\+\s*/g)
    .map((name) => name.trim())
    .filter(Boolean);
  return names.length > 1 ? names.slice(0, 2) : [label];
}

export function PlayerPortraits({
  name,
  sport,
  team,
  providerPlayerId,
  size = 52,
}: {
  name: string;
  sport: string;
  team?: string | null;
  providerPlayerId?: string | null;
  size?: number;
}) {
  const names = playerNames(name);
  if (names.length === 1) {
    return (
      <PlayerAvatar
        name={name}
        sport={sport}
        team={team}
        providerPlayerId={providerPlayerId}
        size={size}
      />
    );
  }
  return (
    <span className="player-portrait-stack" aria-label={`${names.join(' and ')} portraits`}>
      {names.map((playerName, index) => (
        <PlayerAvatar
          key={`${playerName}-${index}`}
          name={playerName}
          sport={sport}
          team={index === 0 ? team : null}
          providerPlayerId={index === 0 ? providerPlayerId : null}
          size={size}
        />
      ))}
    </span>
  );
}

/* ------------------------------------------------------------- hit  meter */

export function HitMeter({
  label,
  hits,
  sample,
  rate,
  delay = 0,
}: {
  label: string;
  hits: number | null;
  sample: number | null;
  rate: number | null;
  delay?: number;
}) {
  const [grown, setGrown] = React.useState(false);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setGrown(true), delay + 60);
    return () => window.clearTimeout(timer);
  }, [delay]);

  const tone = rateTone(rate);
  const fill =
    tone === 'neg' ? 'var(--neg)' : tone === 'warn' ? 'var(--warn)' : 'var(--accent)';

  return (
    <div className="grid gap-[7px]">
      <div className="flex items-center justify-between text-[length:var(--fs-micro)] text-[var(--text-3)]">
        <span>{label}</span>
        <span className="num text-[var(--text)]">
          {sample === null || hits === null ? 'No sample' : `${hits}/${sample}`}
          {rate === null ? '' : ` · ${rate}%`}
        </span>
      </div>
      <div className="block h-2 overflow-hidden rounded-full border border-[var(--line)] bg-[var(--surface-3)]">
        <div
          className="block h-full origin-left rounded-full transition-transform duration-[720ms] ease-[var(--ease-out)]"
          style={{
            background: fill,
            transform: `scaleX(${grown && rate !== null ? rate / 100 : 0})`,
            transitionDelay: `${delay}ms`,
          }}
        />
      </div>
    </div>
  );
}

function gameResult(game: GameLogRow, line: number) {
  const value = Number(game.value);
  if (game.push === true || value === line) return 'push' as const;
  if (game.hit === true || (game.hit == null && value > line)) return 'hit' as const;
  return 'miss' as const;
}

function readableDate(value?: string) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
}

/**
 * Compact, real-observation L10 visualization. Unlike a generic progress bar,
 * every bar is one completed game from the research response. Hover/focus text
 * carries the exact value, opponent, date and minutes without crowding mobile.
 */
function L10GameStrip({
  games,
  line,
  hits,
  sample,
  rate,
}: {
  games: GameLogRow[];
  line: number;
  hits: number | null;
  sample: number | null;
  rate: number | null;
}) {
  const chronological = games.slice(0, 10).reverse();
  const values = chronological.map((game) => Number(game.value)).filter(Number.isFinite);
  const max = Math.max(line, ...values, 1);

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between text-[length:var(--fs-micro)] text-[var(--text-3)]">
        <span>Last 10 games</span>
        <span className="num text-[var(--text)]">
          {sample === null || hits === null ? `${chronological.length} games` : `${hits}/${sample}`}
          {rate === null ? '' : ` · ${rate}%`}
        </span>
      </div>

      <div
        className="grid h-9 grid-cols-10 items-end gap-1 rounded-[9px] border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-3)_72%,transparent)] px-1.5 pt-1.5 pb-1"
        aria-label={`Last ${chronological.length} game results against a line of ${line}`}
      >
        {chronological.map((game, index) => {
          const value = Number(game.value);
          const result = gameResult(game, line);
          const height = Math.max(24, Math.min(100, (value / max) * 100));
          const opponent = game.opponent || 'opponent unavailable';
          const minutes = game.minutes == null ? '' : ` · ${game.minutes} min`;
          const title = `${readableDate(game.date)} · ${opponent} · ${value}${minutes} · ${result}`;
          const background =
            result === 'hit'
              ? 'var(--accent)'
              : result === 'push'
                ? 'var(--warn)'
                : 'color-mix(in srgb, var(--neg) 72%, var(--surface-3))';

          return (
            <span
              key={game.gameId || `${game.date || 'game'}-${index}`}
              className="group relative flex h-full min-w-0 items-end"
              title={title}
              aria-label={title}
            >
              <span
                className="block w-full rounded-[3px] opacity-90 transition-[height,filter,opacity] duration-300 ease-[var(--ease-out)] group-hover:opacity-100 group-hover:brightness-110"
                style={{ height: `${height}%`, background }}
              />
            </span>
          );
        })}
        {Array.from({ length: Math.max(0, 10 - chronological.length) }).map((_, index) => (
          <span
            key={`empty-${index}`}
            className="block h-[24%] rounded-[3px] bg-[color-mix(in_srgb,var(--text)_8%,transparent)]"
            aria-hidden="true"
          />
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- prop card */

export type PropCardStats = {
  hits: number | null;
  sample: number | null;
  rate: number | null;
} | null;

/**
 * Dense mobile-first prop card inspired by the approved reference screens.
 * Every displayed line, book, matchup and percentage is still provider-backed.
 */
export function PropCard({
  group,
  stats,
  loading,
  onOpen,
  onPick,
  picked,
  delay = 0,
}: {
  group: PropGroup;
  stats: PropCardStats;
  loading?: boolean;
  onOpen: (group: PropGroup) => void;
  onPick?: (group: PropGroup, side: 'OVER' | 'UNDER') => void;
  picked?: 'OVER' | 'UNDER' | null;
  delay?: number;
}) {
  const club = teamFor(group.team);
  const kickoff = shortTime(group.startsAt);
  const bookCount = new Set(group.quotes.map((quote) => quote.sportsbookKey || quote.sportsbook).filter(Boolean)).size;
  const [recentGames, setRecentGames] = React.useState<GameLogRow[]>([]);

  React.useEffect(() => {
    setRecentGames([]);
    if (loading || !stats) return;

    const controller = new AbortController();
    fetchResearch(group, 'OVER', controller.signal)
      .then((research) => setRecentGames(playedGames(research).slice(0, 10)))
      .catch(() => setRecentGames([]));
    return () => controller.abort();
  }, [group.key, loading, stats]);

  return (
    <div className="face prop-card-v2">
      <TeamScene team={group.team} />

      <button
        type="button"
        onClick={() => onOpen(group)}
        className="prop-card-v2__open grid w-full text-left"
        aria-label={`Open ${group.player}, ${group.market} ${group.line}`}
      >
        <span className="prop-card-v2__identity flex items-center gap-3">
          <PlayerPortraits
            name={group.player}
            sport={group.sport}
            team={group.team}
            providerPlayerId={group.providerPlayerId}
            size={58}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[length:var(--fs-base)] font-semibold tracking-tight">
              {group.player}
            </span>
            <span className="prop-card-v2__meta mt-0.5 block truncate">
              {club.name} · {group.matchup}{kickoff ? ` · ${kickoff}` : ''}
            </span>
          </span>
          {group.live ? (
            <Badge variant="live">
              <Dot pulse />
              Live
            </Badge>
          ) : (
            <Badge>{group.sport}</Badge>
          )}
        </span>

        <span className="prop-card-v2__market-row border-t border-[var(--line)]">
          <span className="prop-card-v2__market-label min-w-0">
            <span className="truncate">{group.market}</span>
            <span>{bookCount ? `${bookCount} book${bookCount === 1 ? '' : 's'} available` : 'Book unavailable'}</span>
          </span>
          <span className="prop-card-v2__line num shrink-0 font-bold tracking-tight">
            {group.line}
          </span>
        </span>
      </button>

      <div className="prop-card-v2__hit">
        {loading ? (
          <span className="grid gap-[7px]">
            <span className="h-3 w-32 animate-pulse rounded bg-[var(--surface-3)]" />
            <span className="block h-9 animate-pulse rounded-[9px] bg-[var(--surface-3)]" />
          </span>
        ) : recentGames.length ? (
          <L10GameStrip
            games={recentGames}
            line={group.line}
            hits={stats?.hits ?? null}
            sample={stats?.sample ?? null}
            rate={stats?.rate ?? null}
          />
        ) : (
          <HitMeter
            label="L10 hit rate"
            hits={stats?.hits ?? null}
            sample={stats?.sample ?? null}
            rate={stats?.rate ?? null}
            delay={delay + 180}
          />
        )}
      </div>

      <div className="prop-card-v2__quotes grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {(['OVER', 'UNDER'] as const).map((side) => {
          const quote = side === 'OVER' ? group.bestOver : group.bestUnder;
          const isPicked = picked === side;
          const book = String(quote?.sportsbook || quote?.sportsbookKey || 'Unavailable');
          return (
            <button
              key={side}
              type="button"
              data-side={side}
              aria-pressed={isPicked}
              disabled={!quote}
              onClick={() => onPick?.(group, side)}
              className={cn(
                'prop-card-v2__quote flex items-center justify-between px-3',
                'border text-[length:var(--fs-xs)] font-semibold',
                'transition-[border-color,background-color,color,transform] duration-200 ease-[var(--ease-out)]',
                'active:scale-[.98] disabled:pointer-events-none disabled:opacity-40',
              )}
            >
              <span className="min-w-0 text-left">
                <span className="block truncate">{side === 'OVER' ? 'Over' : 'Under'}</span>
                <span className="prop-card-v2__book block max-w-[96px] truncate">{book}</span>
              </span>
              <span className="num shrink-0 text-[var(--text)]">{quote ? odds(quote.price) : '—'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Matches the real card's height so the grid does not jump when data lands. */
export function PropCardSkeleton() {
  return (
    <div className="face prop-card-v2">
      <div className="grid gap-4 p-4">
        <div className="flex items-center gap-3">
          <div className="size-[58px] shrink-0 animate-pulse rounded-[16px] bg-[var(--face-surface-2)]" />
          <div className="grid flex-1 gap-2">
            <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--face-surface-2)]" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-[var(--face-surface-2)]" />
          </div>
        </div>
        <div className="h-8 animate-pulse rounded bg-[var(--face-surface-2)]" />
        <div className="h-9 animate-pulse rounded-[9px] bg-[var(--face-surface-2)]" />
      </div>
      <div className="grid grid-cols-2 gap-2 px-4 pb-4">
        <div className="h-12 animate-pulse rounded-[var(--radius-sm)] bg-[var(--face-surface-2)]" />
        <div className="h-12 animate-pulse rounded-[var(--radius-sm)] bg-[var(--face-surface-2)]" />
      </div>
    </div>
  );
}
