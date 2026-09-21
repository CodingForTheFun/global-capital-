import type { PropGroup, PropRow } from './types';
import { finiteNumber, isDfs, quotePeriod, quoteVariant } from './prop-signals';

export type Prediction = {
  available?: boolean; code?: string; message?: string;
  projection?: number; probabilityOver?: number; probabilityUnder?: number; probabilityPush?: number;
  modelVersion?: string; sourceKind?: string; generatedAt?: string; expiresAt?: string;
  validation?: { method?: string; observations?: number; events?: number };
};
type Target = { groupKey: string; payload: Record<string, unknown> };
const missing = (code: string, message: string): Prediction => ({ available: false, code, message });
export function predictionKey(group: PropGroup): string {
  const quote = group.bestOver || group.bestUnder || group.quotes[0];
  return JSON.stringify([group.key, quote?.sportsbookKey || quote?.sportsbook, quote?.providerPlayerId || group.providerPlayerId || quote?.playerId, quote?.marketId || group.marketId, group.startsAt]);
}

export function predictionTarget(group: PropGroup, quote = group.bestOver || group.bestUnder || group.quotes[0]): Target | Prediction {
  const scope = group.period || quotePeriod(quote);
  if (scope || /(?:^|[\s_·])(?:[1-4][HQ]|[HQ][1-4]|half|quarter|inning|period)(?:$|[\s_·])/i.test(`${group.market} ${group.marketId || ''} ${group.sport}`)) {
    return missing('PERIOD_MODEL_UNAVAILABLE', 'A model for this exact game period is not available.');
  }
  const payload = {
    sport: group.sport, eventId: quote?.eventId, playerId: quote?.providerPlayerId || group.providerPlayerId || quote?.playerId,
    playerName: group.player, marketId: quote?.marketId || group.marketId,
    sportsbookKey: quote?.sportsbookKey || quote?.sportsbook, gameStartTime: group.startsAt,
    line: group.line, entityType: 'player', live: group.live,
    isAlternate: quote?.isAlternate === true || quoteVariant(quote) !== 'standard',
  };
  const identity = [payload.sport, payload.eventId, payload.playerId, payload.playerName, payload.marketId, payload.sportsbookKey];
  if (identity.some(value => typeof value !== 'string' || !value.trim() || value.length > 200) || !payload.gameStartTime || !Number.isFinite(Date.parse(payload.gameStartTime)) || !Number.isFinite(payload.line)) {
    return missing('MISSING_QUOTE_IDENTITY', 'The provider has not supplied the complete identity needed for this forecast.');
  }
  return { groupKey: predictionKey(group), payload };
}

/** At most 24 exact selections per request, matching the existing server contract. */
export async function fetchPredictions(groups: PropGroup[], signal?: AbortSignal, onResults?: (results: Record<string, Prediction>) => void, timeoutMs = 45000): Promise<Record<string, Prediction>> {
  const results: Record<string, Prediction> = {};
  const targets: Target[] = [];
  for (const group of groups) {
    const target = predictionTarget(group);
    if ('payload' in target) targets.push(target);
    else results[predictionKey(group)] = target;
  }
  if (signal?.aborted) return {};
  if (Object.keys(results).length) onResults?.({ ...results });
  for (let offset = 0; offset < targets.length && !signal?.aborted; offset += 24) {
    const chunk = targets.slice(offset, offset + 24);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    const deadline = setTimeout(cancel, timeoutMs);
    const batch: Record<string, Prediction> = {};
    try {
      const response = await fetch('/api/props/ml', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ props: chunk.map((target, index) => ({ ...target.payload, key: String(index) })) }),
      });
      if (!response.ok) throw new Error(response.status === 401 ? 'Sign in again to load forecasts.' : response.status === 429 ? 'Forecast requests are busy. Retry shortly.' : 'Forecasts could not load. Retry shortly.');
      const body = await response.json();
      chunk.forEach((target, index) => {
        const value = body?.results?.[String(index)];
        batch[target.groupKey] = value && typeof value.available === 'boolean' ? value : missing('MODEL_RESPONSE_MISSING', 'No forecast was returned for this selection.');
      });
    } catch (error) {
      if (signal?.aborted) break;
      const reason = controller.signal.aborted ? 'The forecast request timed out. Retry shortly.' : error instanceof Error ? error.message : 'Forecasts could not load. Retry shortly.';
      chunk.forEach(target => { batch[target.groupKey] = missing('MODEL_REQUEST_FAILED', reason); });
    } finally {
      clearTimeout(deadline);
      signal?.removeEventListener('abort', cancel);
    }
    if (signal?.aborted) break;
    Object.assign(results, batch);
    onResults?.(batch);
  }
  return signal?.aborted ? {} : results;
}

export function usablePrediction(prediction: Prediction | null | undefined, now = Date.now()): prediction is Prediction & { projection: number } {
  const expires = Date.parse(prediction?.expiresAt || '');
  return prediction?.available === true && prediction.code === 'READY' && Boolean(prediction.modelVersion) &&
    ['chronological-heldout-real-lines', 'rolling-player-history'].includes(prediction.validation?.method || '') &&
    typeof prediction.projection === 'number' && Number.isFinite(prediction.projection) && Number.isFinite(expires) && expires > now;
}
export function modelLabel(prediction?: Prediction | null): string {
  return prediction?.validation?.method === 'rolling-player-history' ? 'History model' : 'Validated model';
}
export function quoteEv(quote: PropRow | null | undefined, prediction?: Prediction | null, now = Date.now()): number | null {
  if (!quote || !usablePrediction(prediction, now) || isDfs(quote) || quote.conflict || quoteVariant(quote) !== 'standard') return null;
  const probabilities = [prediction.probabilityOver, prediction.probabilityUnder, prediction.probabilityPush];
  if (probabilities.some(p => typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) || Math.abs(probabilities.reduce<number>((sum, p) => sum + (p || 0), 0) - 1) > 1e-6) return null;
  const price = finiteNumber(quote.price), side = String(quote.side || '').toUpperCase();
  if (!price || !['OVER', 'UNDER'].includes(side)) return null;
  const win = side === 'OVER' ? prediction.probabilityOver! : prediction.probabilityUnder!;
  const loss = side === 'OVER' ? prediction.probabilityUnder! : prediction.probabilityOver!;
  return (win * (price > 0 ? price / 100 : 100 / Math.abs(price)) - loss) * 100;
}
export function bestEv(group: PropGroup, prediction?: Prediction, now = Date.now()): number | null {
  // A response belongs to the book in its target; never borrow it for another book.
  const quote = group.bestOver || group.bestUnder || group.quotes[0];
  const book = quote?.sportsbookKey || quote?.sportsbook;
  const values = group.quotes.filter(row => (row.sportsbookKey || row.sportsbook) === book && finiteNumber(row.line) === group.line)
    .map(row => quoteEv(row, prediction, now)).filter((value): value is number => value !== null);
  return values.length ? Math.max(...values) : null;
}
