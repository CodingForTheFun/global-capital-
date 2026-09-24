'use client';

import * as React from 'react';
import Link from 'next/link';
import { Activity, Flame, PauseCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { ApiError, fetchLiveMoves } from '@/lib/api';
import type { LiveMove, LiveMovesResponse, LiveMoveType } from '@/lib/types';
import { marketDisplayLabel, odds } from '@/lib/utils';

const REFRESH_MS = 20_000;
const SPORTS = ['All', 'NFL', 'NBA', 'MLB', 'NHL', 'WNBA', 'NCAAF', 'NCAAB'] as const;
const TYPES: Array<{ id: LiveMoveType | 'all'; label: string }> = [
  { id: 'all', label: 'All signals' },
  { id: 'line_movement', label: 'Line moves' },
  { id: 'steam', label: 'Steam' },
  { id: 'market_suspended', label: 'Off board' },
  { id: 'resolution', label: 'Graded' },
];

const TYPE_STYLE: Record<string, { label: string; tone: string; Icon: typeof Activity }> = {
  line_movement: { label: 'Line move', tone: 'text-sky-300 border-sky-400/25 bg-sky-400/10', Icon: Activity },
  steam: { label: 'Steam', tone: 'text-orange-300 border-orange-400/25 bg-orange-400/10', Icon: Flame },
  market_suspended: { label: 'Off board', tone: 'text-rose-300 border-rose-400/25 bg-rose-400/10', Icon: PauseCircle },
  resolution: { label: 'Graded', tone: 'text-emerald-300 border-emerald-400/25 bg-emerald-400/10', Icon: CheckCircle2 },
};

const show = (value: unknown) => (value === null || value === undefined || value === '' ? '—' : String(value));
const price = (value: number | null | undefined) => (value === null || value === undefined ? '—' : odds(value));

function ago(value: string | null | undefined) {
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg bg-slate-950/45 px-2 py-1.5">
      <div className="truncate text-[8px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 truncate text-[11px] font-black tabular-nums text-white">{value}</div>
    </div>
  );
}

function MoveCard({ row }: { row: LiveMove }) {
  const type = row.type || 'line_movement';
  const style = TYPE_STYLE[type] || TYPE_STYLE.line_movement;
  const who = row.playerName || [row.awayTeam, row.homeTeam].filter(Boolean).join(' @ ') || 'Market update';
  const market = row.marketDescription || row.marketKey
    ? marketDisplayLabel(row.marketDescription || row.marketKey || '', row.playerName || '', row.marketKey || null, row.sport || '')
    : 'Market';
  const book = row.bookmakerTitle || row.bookmakerKey || (row.books?.length ? `${row.books.length} books` : 'Market');

  let metrics: React.ReactNode;
  if (type === 'steam') {
    metrics = (
      <>
        <Metric label="Steam" value={show(row.steamScore)} />
        <Metric label="Books" value={`${show(row.booksMoved)} / ${show(row.booksQuoting)}`} />
        <Metric label="Direction" value={show(row.consensusDirection)} />
      </>
    );
  } else if (type === 'market_suspended') {
    metrics = (
      <>
        <Metric label="Status" value="Off board" />
        <Metric label="Books agree" value={show(row.booksAgreeing)} />
        <Metric label="Markets" value={show(row.markets?.length)} />
      </>
    );
  } else if (type === 'resolution') {
    metrics = (
      <>
        <Metric label="Result" value={show(row.resolution)} />
        <Metric label="Actual" value={show(row.actualValue)} />
        <Metric label="Line" value={show(row.current?.point)} />
      </>
    );
  } else {
    metrics = (
      <>
        <Metric label="Line" value={`${show(row.previous?.point)} → ${show(row.current?.point)}`} />
        <Metric label="Price" value={`${price(row.previous?.price)} → ${price(row.current?.price)}`} />
        <Metric label="Move" value={row.priceChangePct === null || row.priceChangePct === undefined ? '—' : `${row.priceChangePct.toFixed(1)}%`} />
      </>
    );
  }

  return (
    <article className="rounded-2xl border border-slate-800 bg-[#0d1420] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-black ${style.tone}`}>
          <style.Icon className="size-3" aria-hidden />
          {style.label}
        </span>
        <span className="text-[9px] font-semibold text-slate-500">
          {row.sport ? `${row.sport} · ` : ''}{ago(row.occurredAt || row.receivedAt)}
        </span>
      </div>
      <h3 className="mt-2 truncate text-sm font-black text-white">
        {who}
        {row.dfsOddsType && row.dfsOddsType !== 'standard' ? (
          <span className="ml-1.5 rounded bg-slate-800 px-1 py-0.5 align-middle text-[8px] font-black uppercase text-slate-300">{row.dfsOddsType}</span>
        ) : null}
      </h3>
      <p className="truncate text-[10px] text-slate-400">{market} · {book}</p>
      <div className="mt-2 grid grid-cols-3 gap-1.5">{metrics}</div>
    </article>
  );
}

export function MovesScreen() {
  const [sport, setSport] = React.useState<(typeof SPORTS)[number]>('All');
  const [type, setType] = React.useState<LiveMoveType | 'all'>('all');
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
  const events = data?.events || [];

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-6 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-[-.03em] text-white sm:text-3xl">Live Moves</h1>
          <p className="mt-1 max-w-xl text-xs text-slate-400">
            Line movement, steam and markets coming off the board across sportsbooks, as it happens.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full border px-2.5 py-1 text-[9px] font-black ${connected ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-slate-700 bg-slate-900 text-slate-400'}`}
            role="status"
          >
            {data ? (connected ? 'LIVE' : 'WARMING UP') : '…'}
          </span>
          <button
            type="button"
            onClick={() => setTick((value) => value + 1)}
            disabled={loading}
            aria-label="Refresh moves"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/80 px-2.5 text-[10px] font-bold text-white hover:border-slate-600 disabled:opacity-60"
          >
            <RefreshCw className={`size-3 ${loading ? 'animate-spin' : ''}`} aria-hidden />
            Refresh
          </button>
        </div>
      </header>

      <section className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={`Signals in the last ${summary?.windowMinutes ?? 15} minutes`}>
        {[
          { label: 'Line moves', value: summary?.lineMovements },
          { label: 'Steam', value: summary?.steam },
          { label: 'Off board', value: summary?.marketSuspensions },
          { label: 'Graded', value: summary?.resolutions },
        ].map((item) => (
          <div key={item.label} className="rounded-2xl border border-slate-800 bg-[#0d1420] px-3 py-2.5">
            <div className="text-[9px] font-bold uppercase tracking-wide text-slate-500">{item.label} · {summary?.windowMinutes ?? 15}m</div>
            <div className="mt-1 text-2xl font-black tabular-nums text-white">{item.value ?? '—'}</div>
          </div>
        ))}
      </section>

      <div className="mt-4 flex flex-col gap-2">
        <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Sport">
          {SPORTS.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={sport === item}
              onClick={() => setSport(item)}
              className={`min-h-8 flex-none rounded-full border px-3 text-[10px] font-black ${sport === item ? 'border-sky-400/50 bg-sky-400/15 text-sky-200' : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:text-white'}`}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Signal type">
          {TYPES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={type === item.id}
              onClick={() => setType(item.id)}
              className={`min-h-8 flex-none rounded-full border px-3 text-[10px] font-bold ${type === item.id ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200' : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:text-white'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {data?.trendingPlayers?.length ? (
        <section className="mt-3" aria-label="Trending players">
          <div className="mb-1.5 text-[9px] font-black uppercase tracking-[.16em] text-slate-500">Trending now</div>
          <div className="flex flex-wrap gap-1.5">
            {data.trendingPlayers.map((player) => (
              <span key={`${player.sport}-${player.playerName}`} className="rounded-full border border-slate-800 bg-slate-900/70 px-2.5 py-1 text-[10px] font-bold text-slate-200">
                {player.playerName} <span className="text-slate-500">· {player.signals} signal{player.signals === 1 ? '' : 's'}</span>
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-4" aria-live="polite">
        {error ? (
          <div className="rounded-2xl border border-slate-800 bg-[#0d1420] p-6 text-center">
            <p className="text-sm font-black text-white">{error.message}</p>
            {error.auth ? (
              <Link href="/account" className="mt-3 inline-block rounded-lg bg-emerald-500 px-4 py-2 text-xs font-black text-slate-950">Sign in</Link>
            ) : null}
          </div>
        ) : !data ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="h-32 animate-pulse rounded-2xl border border-slate-800 bg-[#0d1420]" />
            ))}
          </div>
        ) : events.length ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((row, index) => <MoveCard key={row.id || index} row={row} />)}
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-800 bg-[#0d1420] p-6 text-center">
            <p className="text-sm font-black text-white">No matching signals yet</p>
            <p className="mt-1 text-xs text-slate-500">
              {connected ? 'The feed is connected; this filter has no recent movement.' : 'The live feed is warming up. Signals appear here as books move.'}
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
