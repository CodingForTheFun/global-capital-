import { getJson } from './api';
import { finiteNumber, isDfs, quotePeriod, quoteVariant } from './prop-signals';
import type { PropGroup, PropRow } from './types';

export type MarketReference = {
  projection: number | null; ev: number | null; book: string | null; side: string | null;
  booksContributing: number | null; updatedAt: string | null; expiresAt: number; reason?: string;
};
type Row = Record<string, unknown>;
type Target = { sport: string; event: string; market: string; player: string; playerId: string | null; quote: PropRow };
const text = (value: unknown) => String(value ?? '').trim();
const name = (value: unknown) => text(value).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.filter(row => row && typeof row === 'object') : [];
export const referenceQuote = (group: PropGroup) => {
  const candidates = [group.bestOver, group.bestUnder, ...group.quotes].filter((row): row is PropRow => Boolean(row));
  return candidates.find(row => !isDfs(row) && finiteNumber(row.price) !== null && finiteNumber(row.price) !== 0) || candidates[0];
};
export function referenceKey(group: PropGroup): string {
  const quote = referenceQuote(group);
  return JSON.stringify([group.key, quote?.sportsbookKey, quote?.side, quote?.price,
    quote?.proplineEventId || (quote?.provider === 'propline' ? quote.providerEventId : null),
    quote?.proplinePlayerId || (quote?.provider === 'propline' ? quote.providerPlayerId : null)]);
}
export function referenceTarget(group: PropGroup, quote = referenceQuote(group)): Target | null {
  const event = text(quote?.proplineEventId || (quote?.provider === 'propline' ? quote.providerEventId : ''));
  const market = text(quote?.marketId || group.marketId);
  const periodInLabel = /(?:^|[\s_·])(?:[1-4][HQ]|[HQ][1-4]|half|quarter|inning|period)(?:$|[\s_·])/i.test(`${group.market} ${market}`);
  if (!event || !/^[a-zA-Z0-9:_-]{1,160}$/.test(event) || !/^[a-zA-Z0-9_]{1,120}$/.test(market) || group.period || quotePeriod(quote) || periodInLabel || quoteVariant(quote) !== 'standard' || quote?.conflict || group.live || !group.startsAt || !Number.isFinite(Date.parse(group.startsAt)) || Date.parse(group.startsAt) <= Date.now()) return null;
  return { sport: group.sport, event, market, player: group.player, playerId: text(quote?.proplinePlayerId || (quote?.provider === 'propline' ? quote.providerPlayerId : '')) || null, quote };
}
const absent = (reason: string, now = Date.now()): MarketReference => ({ projection: null, ev: null, book: null, side: null, booksContributing: null, updatedAt: null, expiresAt: now + 60000, reason });
/** Market estimates are reference data. They never become historical hit rates or trained-model forecasts. */
export function marketReferenceFrom(group: PropGroup, projectionData: unknown, evData: unknown, now = Date.now()): MarketReference {
  const target = referenceTarget(group);
  if (!target) return absent('No verified PropLine reference for this exact selection.', now);
  const samePlayer = (row: Row) => target.playerId && row.playerId ? text(row.playerId) === target.playerId : name(row.playerName) === name(target.player);
  const exactMarket = (row: Row) => name(row.marketKey) === name(target.market) && samePlayer(row);
  const projections = rows((projectionData as Row)?.redacted === true ? [] : (projectionData as Row)?.projections).filter(row => row.redacted !== true && exactMarket(row) && finiteNumber(row.projection) !== null);
  const projection = projections.length && new Set(projections.map(row => finiteNumber(row.projection))).size === 1 ? projections[0] : null;
  const price = finiteNumber(target.quote.price);
  const plays = isDfs(target.quote) || price === null ? [] : rows((evData as Row)?.redacted === true ? [] : (evData as Row)?.plays).filter(row => row.redacted !== true && exactMarket(row)
    && finiteNumber(row.line) === group.line && name(row.bookmakerKey) === name(target.quote.sportsbookKey)
    && name(row.side) === name(target.quote.side) && finiteNumber(row.price) === price && finiteNumber(row.evPercent) !== null);
  const exact = plays.length && new Set(plays.map(row => finiteNumber(row.evPercent))).size === 1 ? plays[0] : null;
  return {
    projection: finiteNumber(projection?.projection), ev: finiteNumber(exact?.evPercent),
    book: exact ? text(exact.bookmakerKey) : null, side: exact ? text(exact.side) : null,
    booksContributing: finiteNumber(projection?.booksContributing), updatedAt: text(exact?.updatedAt || projection?.updatedAt) || null,
    expiresAt: now + 60000,
    ...(projection || exact ? {} : { reason: 'PropLine has not returned a reference for this exact selection.' }),
  };
}

const cache = new Map<string, { expires: number; value: unknown }>();
async function insight(kind: string, target: { sport: string; event: string }, markets: string, signal?: AbortSignal): Promise<{ expires: number; value: unknown }> {
  const path = `/api/apex/propline?${new URLSearchParams({ kind, sport: target.sport, eventId: target.event, markets })}`;
  const cached = cache.get(path);
  if (cached && cached.expires > Date.now()) return cached;
  const body = await getJson<{ available?: boolean; data?: unknown }>(path, signal, 20000, 25000);
  const value = body.available ? body.data : null;
  const entry = { expires: Date.now() + 60000, value };
  if (value) {
    if (cache.size >= 128) cache.delete(cache.keys().next().value!);
    cache.set(path, entry);
  }
  return entry;
}
/** Visible-page reads only: two cached endpoints per native event, with two workers and no polling. */
export async function fetchMarketReferences(groups: PropGroup[], signal?: AbortSignal, onResults?: (values: Record<string, MarketReference>) => void): Promise<Record<string, MarketReference>> {
  const results: Record<string, MarketReference> = {}, events = new Map<string, { target: Target; groups: PropGroup[] }>();
  for (const group of groups.slice(0, 60)) {
    const target = referenceTarget(group);
    if (!target) { results[referenceKey(group)] = absent('No verified PropLine reference for this exact selection.'); continue; }
    const key = JSON.stringify([target.sport, target.event]);
    const event = events.get(key) || { target, groups: [] }; event.groups.push(group); events.set(key, event);
  }
  if (signal?.aborted) return {};
  if (Object.keys(results).length) onResults?.({ ...results });
  const queue = [...events.values()];
  async function worker() {
    while (queue.length && !signal?.aborted) {
      const job = queue.shift()!;
      const markets = [...new Set(job.groups.map(group => referenceTarget(group)!.market))].sort().join(',');
      const response = await Promise.allSettled([insight('projections', job.target, markets, signal), insight('ev', job.target, markets, signal)]);
      if (signal?.aborted) return;
      const data = response.map(value => value.status === 'fulfilled' ? value.value.value : null);
      const expires = Math.min(Date.now() + 60000, ...response.flatMap(value => value.status === 'fulfilled' ? [value.value.expires] : []));
      const batch = Object.fromEntries(job.groups.map(group => [referenceKey(group), { ...marketReferenceFrom(group, data[0], data[1]), expiresAt: expires }]));
      Object.assign(results, batch); onResults?.(batch);
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, queue.length) }, worker));
  return signal?.aborted ? {} : results;
}

export type QuoteHistoryPoint = { at: string; line: number; price: number | null; liquidity: number | null };
export function historyTarget(group: PropGroup, quote: PropRow | null | undefined) {
  const event = text(quote?.proplineEventId || (quote?.provider === 'propline' ? quote.providerEventId : ''));
  const outcome = text(quote?.proplineOutcomeId || (quote?.provider === 'propline' ? quote.providerOutcomeId : ''));
  const market = text(quote?.marketId || group.marketId);
  if (!event || !outcome || !/^[a-zA-Z0-9:_-]{1,160}$/.test(event) || !/^[a-zA-Z0-9_]{1,120}$/.test(market) || !quote?.sportsbookKey || !quote.side || quote.conflict) return null;
  return { sport: group.sport, event, outcome, market, book: quote.sportsbookKey, side: quote.side };
}
export function exactHistory(data: unknown, target: NonNullable<ReturnType<typeof historyTarget>>): QuoteHistoryPoint[] {
  if ((data as Row)?.redacted === true) return [];
  return rows((data as Row)?.points).filter(row => row.redacted !== true && text(row.outcomeId) === target.outcome
    && name(row.marketKey) === name(target.market) && name(row.bookmakerKey) === name(target.book)
    && name(row.side) === name(target.side) && finiteNumber(row.line) !== null && Number.isFinite(Date.parse(text(row.at))))
    .map(row => ({ at: text(row.at), line: finiteNumber(row.line)!, price: finiteNumber(row.price), liquidity: finiteNumber(row.liquidity) }))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
export async function fetchQuoteHistory(group: PropGroup, quote: PropRow, signal?: AbortSignal): Promise<QuoteHistoryPoint[]> {
  const target = historyTarget(group, quote);
  if (!target) return [];
  const response = await insight('history', target, target.market, signal);
  if (!response.value) throw new Error('PropLine line history is unavailable. Retry shortly.');
  return exactHistory(response.value, target);
}
