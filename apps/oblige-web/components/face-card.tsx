'use client';

import * as React from 'react';
import { ART, teamFor } from '@/lib/teams';
import { artworkUrl } from '@/lib/api';
import type { PropGroup } from '@/lib/types';
import { cn, initials, odds, rateTone } from '@/lib/utils';
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
  const [failed, setFailed] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);

  return (
    <span className={cn('ringavatar', className)} style={{ width: size, height: size }}>
      <span
        className={cn(
          'relative grid size-full place-items-center overflow-hidden rounded-full',
          'bg-[var(--face-surface-2)]',
        )}
      >
        <span className="text-[length:var(--fs-sm)] font-bold text-[var(--face-text-3)]" aria-hidden="true">
          {initials(name)}
        </span>
        {!failed && (
          // eslint-disable-next-line @next/next/no-img-element -- the artwork
          // route streams bytes from a same-origin proxy, so the optimizer has
          // nothing to add and would only add a second hop.
          <img
            src={artworkUrl(sport, name, team, providerPlayerId)}
            alt=""
            width={size}
            height={size}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={cn(
              'absolute inset-0 size-full object-cover object-top transition-opacity duration-300 ease-[var(--ease-out)]',
              loaded ? 'opacity-100' : 'opacity-0',
            )}
          />
        )}
      </span>
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

/* -------------------------------------------------------------- prop card */

export type PropCardStats = {
  hits: number | null;
  sample: number | null;
  rate: number | null;
} | null;

/**
 * A player card. It keeps one identity in every direction — dark, lit, with a
 * gradient ring — so a player reads the same on the dark board and the light
 * one, and the club backdrop tells you who they play for before you read a
 * word.
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

  return (
    <div className="face">
      <TeamScene team={group.team} />

      <button
        type="button"
        onClick={() => onOpen(group)}
        className="grid w-full gap-4 p-4 text-left"
        aria-label={`Open ${group.player}, ${group.market} ${group.line}`}
      >
        <span className="flex items-center gap-3">
          <PlayerAvatar
            name={group.player}
            sport={group.sport}
            team={group.team}
            providerPlayerId={group.providerPlayerId}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[length:var(--fs-base)] font-semibold tracking-tight">
              {group.player}
            </span>
            <span className="mt-0.5 block truncate text-[length:var(--fs-xs)] text-[var(--text-3)]">
              {club.name} · {group.matchup}
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

        <span className="flex items-baseline justify-between gap-3 border-t border-[var(--line)] pt-3">
          <span className="min-w-0 truncate text-[length:var(--fs-sm)] text-[var(--text-2)]">
            {group.market}
          </span>
          <span className="num shrink-0 text-[length:var(--fs-xl)] font-bold tracking-tight">
            {group.line}
          </span>
        </span>

        {loading ? (
          <span className="grid gap-[7px]">
            <span className="h-3 w-32 animate-pulse rounded bg-[var(--surface-3)]" />
            <span className="block h-2 animate-pulse rounded-full bg-[var(--surface-3)]" />
          </span>
        ) : (
          <HitMeter
            label="Last 10 · hit rate"
            hits={stats?.hits ?? null}
            sample={stats?.sample ?? null}
            rate={stats?.rate ?? null}
            delay={delay + 180}
          />
        )}
      </button>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 px-4 pb-4">
        {(['OVER', 'UNDER'] as const).map((side) => {
          const quote = side === 'OVER' ? group.bestOver : group.bestUnder;
          const isPicked = picked === side;
          return (
            <button
              key={side}
              type="button"
              aria-pressed={isPicked}
              disabled={!quote}
              onClick={() => onPick?.(group, side)}
              className={cn(
                'flex min-h-11 items-center justify-between rounded-[var(--radius-sm)] px-3',
                'border text-[length:var(--fs-xs)] font-semibold',
                'transition-[border-color,background-color,color,transform] duration-200 ease-[var(--ease-out)]',
                'active:scale-[.98] disabled:opacity-40 disabled:pointer-events-none',
                isPicked
                  ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent)]'
                  : 'border-[var(--line)] bg-[var(--surface-2)] text-[var(--text-2)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]',
              )}
            >
              <span className="truncate">{side === 'OVER' ? 'Over' : 'Under'}</span>
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
    <div className="face">
      <div className="grid gap-4 p-4">
        <div className="flex items-center gap-3">
          <div className="size-[50px] shrink-0 animate-pulse rounded-full bg-[var(--face-surface-2)]" />
          <div className="grid flex-1 gap-2">
            <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--face-surface-2)]" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-[var(--face-surface-2)]" />
          </div>
        </div>
        <div className="h-8 animate-pulse rounded bg-[var(--face-surface-2)]" />
        <div className="h-2 animate-pulse rounded-full bg-[var(--face-surface-2)]" />
      </div>
      <div className="grid grid-cols-2 gap-2 px-4 pb-4">
        <div className="h-11 animate-pulse rounded-[var(--radius-sm)] bg-[var(--face-surface-2)]" />
        <div className="h-11 animate-pulse rounded-[var(--radius-sm)] bg-[var(--face-surface-2)]" />
      </div>
    </div>
  );
}
