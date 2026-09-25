'use client';

import * as React from 'react';
import Link from 'next/link';
import { Activity, Flame, PauseCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { ApiError, fetchLiveMoves } from '@/lib/api';
import type { LiveMove, LiveMovesResponse, LiveMoveType } from '@/lib/types';
import { marketDisplayLabel, odds } from '@/lib/utils';

const REFRESH_MS = 20_000;
const SPORTS = ['All', 'NFL', 'NBA', 'MLB', 'NHL', 'WNBA', 'NCAAF', 'NCAAB'] as const;

const TYPE_STYLE: Record<string, { label: string; tone: string; Icon: typeof Activity }> = {
  line_movement: { label: 'Line move', tone: 'move', Icon: Activity },
  steam: { label: 'Steam', tone: 'steam', Icon: Flame },
  market_suspended: { label: 'Off board', tone: 'off', Icon: PauseCircle },
  resolution: { label: 'Graded', tone: 'graded', Icon: CheckCircle2 },
};

const TONE_CLASS: Record<string, string> = {
  move: 'text-[var(--text-2)]',
  steam: 'text-[var(--accent-2)]',
  off: 'text-[var(--warn)]',
  graded: 'text-[var(--pos)]',
};

const show = (value: unknown) => (value === null || value === undefined || value === '' ? '—' : String(value));
const price = (value: number | null | undefined) => (value === null || value === undefined ? '—' : odds(value));

function ago(value: string | null | undefined) {
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

/** The one piece of information each event type is about, as a short phrase. */
function change(row: LiveMove): React.ReactNode {
  const type = row.type || 'line_movement';
  if (type === 'steam') {
    const up = /up|over|higher/i.test(row.consensusDirection || '');
    return (
      <span className="text-[var(--accent-2)]">
        {up ? '▲' : '▼'} {show(row.booksMoved)}/{show(row.booksQuoting)} books
        <span className="ml-1.5 text-[var(--text-3)]">score {show(row.steamScore)}</span>
      </span>
    );
  }
  if (type === 'market_suspended') {
    return <span className="text-[var(--warn)]">Pulled{row.booksAgreeing ? ` · ${row.booksAgreeing} books` : ''}</span>;
  }
  if (type === 'resolution') {
    const won = /over|won|hit/i.test(row.resolution || '');
    return (
      <span>
        <b className={won ? 'text-[var(--pos)]' : 'text-[var(--text-2)]'}>{show(row.resolution)}</b>
        <span className="ml-1.5 text-[var(--text-3)]">{show(row.actualValue)} vs {show(row.current?.point)}</span>
      </span>
    );
  }
  const from = row.previous?.point, to = row.current?.point;
  const lineMoved = from !== null && from !== undefined && to !== null && to !== undefined && from !== to;
  return (
    <span className="tabular-nums">
      {lineMoved ? (
        <b className={to! > from! ? 'text-[var(--pos)]' : 'text-[var(--neg)]'}>{from} → {to}</b>
      ) : (
        <span className="text-[var(--text-2)]">{show(to)}</span>
      )}
      <span className="ml-1.5 text-[var(--text-3)]">{price(row.previous?.price)} → {price(row.current?.price)}</span>
    </span>
  );
}

/** One event per row: time, type, who and what, the change, and where. */
function MoveRow({ row }: { row: LiveMove }) {
  const type = row.type || 'line_movement';
  const style = TYPE_STYLE[type] || TYPE_STYLE.line_movement;
  const who = row.playerName || [row.awayTeam, row.homeTeam].filter(Boolean).join(' @ ') || 'Market update';
  const market = row.marketDescription || row.marketKey
    ? marketDisplayLabel(row.marketDescription || row.marketKey || '', row.playerName || '', row.marketKey || null, row.sport || '')
    : 'Market';
  const book = row.bookmakerTitle || row.bookmakerKey || (row.books?.length ? `${row.books.length} books` : '');

  return (
    <li className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-baseline gap-x-3 border-b border-[var(--line)] px-3 py-2 text-[13px] sm:grid-cols-[44px_96px_minmax(0,1.3fr)_minmax(0,1fr)_120px_56px] sm:py-1.5">
      <span className="text-[12px] tabular-nums text-[var(--text-3)]">{ago(row.occurredAt || row.receivedAt)}</span>
      <span className={`hidden items-center gap-1 text-[12px] font-bold sm:inline-flex ${TONE_CLASS[style.tone]}`}>
        <style.Icon className="size-3.5" aria-hidden />
        {style.label}
      </span>
      <span className="min-w-0 truncate">
        <b className="font-semibold text-[var(--text)]">{who}</b>
        {row.dfsOddsType && row.dfsOddsType !== 'standard' ? (
          <span className="ml-1.5 rounded-[3px] bg-[var(--surface-2)] px-1 text-[11px] font-bold uppercase text-[var(--text-2)]">{row.dfsOddsType}</span>
        ) : null}
        <span className="ml-1.5 text-[var(--text-2)]">{market}</span>
      </span>
      <span className="col-start-2 row-start-2 min-w-0 truncate text-[12px] sm:col-start-auto sm:row-start-auto sm:text-[13px]">
        <span className={`mr-1.5 inline-flex items-center gap-1 font-bold sm:hidden ${TONE_CLASS[style.tone]}`}>
          <style.Icon className="size-3" aria-hidden />
          {style.label}
        </span>
        {change(row)}
      </span>
      <span className="col-start-3 row-start-1 truncate text-right text-[12px] text-[var(--text-3)] sm:col-start-auto sm:row-start-auto sm:text-left">{book}</span>
      <span className="col-start-3 row-start-2 text-right text-[11px] font-bold text-[var(--text-3)] sm:col-start-auto sm:row-start-auto">{row.sport || ''}</span>
    </li>
  );
}

export function MovesScreen() {
  const [sport, setSport] = React.useState<(typeof SPORTS)[number]>('All');
  const [type, setType] = React.useState<LiveMoveType | 'all'>('all');
  const [player, setPlayer] = React.useState<string | null>(null);
  const [data, setData] = React.useState<LiveMovesResponse | null>(null);
  const [error, setError] = React.useState<{ message: string; auth: boolean } | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetchLiveMoves({ sport: sport === 'All' ? null : sport, type: type === 'all' ? null : type, limit: 160 }, controller.signal)
      .then((value) => {
        setData(value);
        setError(null);
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        const auth = reason instanceof ApiError && reason.status === 401;
        setError({ auth, message: auth ? 'Sign in to view live market moves.' : reason?.message || 'Market moves are temporarily unavailable.' });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [sport, type, tick]);

  // Poll while the tab is visible; a hidden tab should not spend requests.
  React.useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setTick((value) => value + 1);
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  const summary = data?.summary;
  const connected = data?.meta?.connected === true;
  const events = (data?.events || []).filter((row) => !player || row.playerName === player);
  const windowMinutes = summary?.windowMinutes ?? 15;
  const counts: Array<{ id: LiveMoveType; label: string; value: number | undefined }> = [
    { id: 'line_movement', label: 'line moves', value: summary?.lineMovements },
    { id: 'steam', label: 'steam', value: summary?.steam },
    { id: 'market_suspended', label: 'off board', value: summary?.marketSuspensions },
    { id: 'resolution', label: 'graded', value: summary?.resolutions },
  ];

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-4 sm:px-6">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-[20px] font-extrabold tracking-[-.02em] text-[var(--text)]">Market</h1>
        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--text-2)]" role="status">
          <span className={`size-2 rounded-full ${connected ? 'bg-[var(--pos)] shadow-[0_0_0_3px_var(--pos-soft)]' : 'bg-[var(--warn)]'}`} aria-hidden />
          {data ? (connected ? 'Live' : 'Warming up') : 'Connecting…'}
        </span>
        <button
          type="button"
          onClick={() => setTick((value) => value + 1)}
          disabled={loading}
          aria-label="Refresh moves"
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[var(--line-strong)] px-2.5 text-[12px] font-semibold text-[var(--text-2)] hover:text-[var(--text)] disabled:opacity-60"
        >
          <RefreshCw className={`size-3 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          Refresh
        </button>
      </header>

      {/* Counts are also the type filter: one line instead of tiles plus chips. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1 text-[13px]" role="group" aria-label={`Signals in the last ${windowMinutes} minutes`}>
        <button type="button" aria-pressed={type === 'all'} onClick={() => setType('all')}
          className={`rounded-[3px] px-1.5 py-0.5 font-semibold ${type === 'all' ? 'bg-[var(--accent-soft)] text-[var(--text)]' : 'text-[var(--text-2)] hover:text-[var(--text)]'}`}>
          All
        </button>
        {counts.map((item) => (
          <button key={item.id} type="button" aria-pressed={type === item.id} onClick={() => setType(type === item.id ? 'all' : item.id)}
            className={`rounded-[3px] px-1.5 py-0.5 ${type === item.id ? 'bg-[var(--accent-soft)] text-[var(--text)]' : 'text-[var(--text-2)] hover:text-[var(--text)]'}`}>
            <b className="font-bold tabular-nums text-[var(--text)]">{item.value ?? '—'}</b> {item.label}
          </button>
        ))}
        <span className="text-[12px] text-[var(--text-3)]">· last {windowMinutes}m</span>
      </div>

      <nav className="mt-3 flex gap-1 overflow-x-auto border-b border-[var(--line)] [scrollbar-width:none]" aria-label="Sport">
        {SPORTS.map((item) => (
          <button key={item} type="button" aria-pressed={sport === item} onClick={() => setSport(item)}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-[13px] font-semibold ${sport === item ? 'border-[var(--accent)] text-[var(--text)]' : 'border-transparent text-[var(--text-2)] hover:text-[var(--text)]'}`}>
            {item}
          </button>
        ))}
      </nav>

      {data?.trendingPlayers?.length ? (
        <div className="mt-2 flex items-center gap-2 overflow-x-auto py-1 text-[12px] [scrollbar-width:none]" aria-label="Trending players">
          <span className="shrink-0 font-bold uppercase tracking-[.05em] text-[var(--text-3)]">Trending</span>
          {data.trendingPlayers.map((item) => (
            <button key={`${item.sport}-${item.playerName}`} type="button" aria-pressed={player === item.playerName}
              onClick={() => setPlayer(player === item.playerName ? null : item.playerName)}
              className={`shrink-0 rounded-[3px] px-1.5 py-0.5 ${player === item.playerName ? 'bg-[var(--accent-soft)] text-[var(--text)]' : 'text-[var(--text)] hover:bg-[var(--surface-2)]'}`}>
              {item.playerName} <span className="tabular-nums text-[var(--text-3)]">{item.signals}</span>
            </button>
          ))}
          {player ? <button type="button" onClick={() => setPlayer(null)} className="shrink-0 text-[var(--accent)]">Clear</button> : null}
        </div>
      ) : null}

      <section className="mt-2" aria-live="polite">
        {error ? (
          <div className="rounded-[10px] border border-dashed border-[var(--line-strong)] p-6 text-center">
            <p className="text-sm font-bold text-[var(--text)]">{error.message}</p>
            {error.auth ? (
              <Link href="/account" className="mt-3 inline-block rounded-[6px] bg-[var(--accent-fill)] px-4 py-2 text-xs font-bold text-[var(--accent-ink)]">Sign in</Link>
            ) : null}
          </div>
        ) : !data ? (
          <ul className="rounded-[10px] border border-[var(--line)]">
            {Array.from({ length: 10 }, (_, index) => (
              <li key={index} className="flex h-9 items-center gap-3 border-b border-[var(--line)] px-3 last:border-b-0">
                <span className="h-2.5 w-8 rounded bg-[var(--surface-2)]" /><span className="h-2.5 w-40 rounded bg-[var(--surface-2)]" /><span className="ml-auto h-2.5 w-16 rounded bg-[var(--surface-2)]" />
              </li>
            ))}
          </ul>
        ) : events.length ? (
          <ul className="overflow-hidden rounded-[10px] border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface)_55%,transparent)] [&>li:last-child]:border-b-0">
            {events.map((row, index) => <MoveRow key={row.id || index} row={row} />)}
          </ul>
        ) : (
          <div className="rounded-[10px] border border-dashed border-[var(--line-strong)] p-6 text-center">
            <p className="text-sm font-bold text-[var(--text)]">No matching signals yet</p>
            <p className="mt-1 text-xs text-[var(--text-2)]">
              {connected ? 'The feed is connected; this filter has no recent movement.' : 'The live feed is warming up. Signals appear here as books move.'}
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
