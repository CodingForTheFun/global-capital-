'use client';

import * as React from 'react';
import type { PropGroup, Side } from '@/lib/types';
import { bookKey, eventIdFor, optionalNumber } from '@/lib/prop-route';

type Prediction = { available?: boolean; projection?: number; probabilityOver?: number; probabilityUnder?: number; probabilityPush?: number; engine?: string; expiresAt?: string };
const probability = (value: unknown) => { const n = optionalNumber(value); return n !== null && n >= 0 && n <= 1 ? n : null; };

/** This uses the existing model API, not an LLM or historical hit rate as a model. */
export function PropModelContext({ group, side, book, line }: { group: PropGroup; side: Side; book: string | null; line: number }) {
  const quote = book ? group.quotes.find((row) => bookKey(row).toLowerCase() === book.toLowerCase() && row.side?.toUpperCase() === side) : side === 'OVER' ? group.bestOver : group.bestUnder;
  const selectedBook = bookKey(quote);
  const eventId = eventIdFor(group);
  const target = group.providerPlayerId && group.marketId && eventId && selectedBook && group.startsAt && Number.isFinite(Date.parse(group.startsAt)) && line === group.line
    ? { key: 'selected', sport: group.sport, eventId, playerId: group.providerPlayerId, playerName: group.player, marketId: group.marketId, sportsbookKey: selectedBook, gameStartTime: group.startsAt, line, entityType: 'player', live: group.live, isAlternate: false }
    : null;
  const targetKey = JSON.stringify(target);
  const [result, setResult] = React.useState<{ key: string; prediction: Prediction | null; loading: boolean }>({ key: '', prediction: null, loading: false });
  React.useEffect(() => {
    const payload = JSON.parse(targetKey);
    if (!payload) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    let disposed = false;
    setResult({ key: targetKey, prediction: null, loading: true });
    void fetch('/api/props/ml', { method: 'POST', credentials: 'same-origin', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ props: [payload] }) })
      .then(async (response) => { if (!response.ok) throw new Error('Model unavailable'); return response.json(); })
      .then((body) => { if (!disposed) setResult({ key: targetKey, prediction: body?.ok === true ? body.results?.selected || null : null, loading: false }); })
      .catch(() => { if (!disposed) setResult({ key: targetKey, prediction: null, loading: false }); })
      .finally(() => clearTimeout(timer));
    return () => { disposed = true; clearTimeout(timer); controller.abort(); };
  }, [targetKey]);
  const prediction = result.key === targetKey ? result.prediction : null;
  const fresh = !prediction?.expiresAt || Date.parse(prediction.expiresAt) > Date.now();
  const available = prediction?.available === true && fresh;
  const projection = available ? optionalNumber(prediction?.projection) : null;
  const over = available ? probability(prediction?.probabilityOver) : null;
  const under = available ? probability(prediction?.probabilityUnder) : null;
  const push = available ? probability(prediction?.probabilityPush) : null;
  const price = optionalNumber(quote?.price);
  // Never treat PrizePicks' synthetic even-money price as its entry payout.
  const canPrice = !/prizepicks|pick6|sleeper/i.test(selectedBook) && line === group.line && price !== null && Math.abs(price) >= 100;
  const completeDistribution = over !== null && under !== null && push !== null && Math.abs(over + under + push - 1) < 0.001;
  const win = side === 'OVER' ? over : under, loss = side === 'OVER' ? under : over;
  const profit = price !== null ? price > 0 ? price / 100 : 100 / Math.abs(price) : 0;
  const ev = canPrice && completeDistribution && win !== null && loss !== null ? 100 * (win * profit - loss) : null;
  const loading = Boolean(target && (result.key !== targetKey || result.loading));
  return <section className="mt-4 rounded-[var(--radius)] border border-[var(--line)] p-4" aria-label="Selected prop model context">
    <div className="flex flex-wrap justify-between gap-3"><div><span className="text-xs text-[var(--text-3)]">Model estimate</span><p className="num font-semibold">{loading ? 'Loading…' : projection !== null ? projection.toFixed(1) : 'Unavailable'}</p></div><div><span className="text-xs text-[var(--text-3)]">{side} EV · {selectedBook || 'No book selected'}</span><p className="num font-semibold">{ev !== null ? `${ev >= 0 ? '+' : ''}${ev.toFixed(1)}%` : 'Unavailable'}</p></div></div>
    {!loading && <p className="mt-2 text-xs text-[var(--text-3)]">{line !== group.line ? 'Model and book prices apply to the posted line, not a hypothetical research line.' : available ? `Source: ${prediction?.engine || 'Existing model service'}. Estimates are not guarantees.` : 'No verified model estimate is available for this exact player, event, market and line.'}</p>}
  </section>;
}
