import { decimalOdds } from './line-lag.mjs';

export const MAX_ARBITRAGE_AGE_MS = 15 * 60 * 1000;
export const MIN_ARBITRAGE_ROI = 0.001;

const num = value => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const text = value => String(value ?? '').trim();
const sideOf = row => text(row?.side).toUpperCase();

function quoteTimestamp(row) {
  for (const value of [row?.providerUpdatedAt, row?.updatedAt, row?.observedAt, row?.lastSeenAt, row?.ingestedAt]) {
    const at = Date.parse(value);
    if (Number.isFinite(at)) return at;
  }
  return null;
}

function normalizeOffer(row, { now, maxAgeMs, includeLive }) {
  if (!row || row.isAlternate === true || row.suspended === true || row.stale === true) return null;
  if (!includeLive && row.live === true) return null;
  const side = sideOf(row);
  const line = num(row.line);
  const price = num(row.price);
  const bookKey = text(row.sportsbookKey || row.bookmakerKey || row.sportsbook).toLowerCase();
  if (!bookKey || (side !== 'OVER' && side !== 'UNDER') || line === null || price === null || price === 0) return null;
  const decimal = decimalOdds(price);
  if (decimal === null || decimal <= 1) return null;
  const at = quoteTimestamp(row);
  // Arb labels are only useful when both prices are demonstrably current.
  if (!Number.isFinite(at) || at > now + 5_000 || now - at > maxAgeMs) return null;
  return {
    bookKey,
    bookName: text(row.sportsbook || row.bookmakerName || row.sportsbookName || bookKey) || bookKey,
    side,
    line,
    price,
    decimal,
    at,
    deeplink: row.deeplink || null,
  };
}

function freshestOffers(rows, options) {
  const byKey = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const offer = normalizeOffer(row, options);
    if (!offer) continue;
    const key = [offer.bookKey, offer.side, offer.line].join('|');
    const previous = byKey.get(key);
    if (!previous || offer.at >= previous.at) byKey.set(key, offer);
  }
  return [...byKey.values()];
}

function pairSignal(over, under, bankroll) {
  if (over.bookKey === under.bookKey || over.line !== under.line) return null;
  const impliedSum = 1 / over.decimal + 1 / under.decimal;
  if (!(impliedSum > 0 && impliedSum < 1)) return null;
  const roi = 1 / impliedSum - 1;
  if (roi < MIN_ARBITRAGE_ROI) return null;

  const total = Math.max(0, Number.isFinite(bankroll) ? bankroll : 100);
  const overStake = total ? total * (1 / over.decimal) / impliedSum : 0;
  const underStake = total ? total * (1 / under.decimal) / impliedSum : 0;
  const equalizedPayout = total ? total / impliedSum : 0;

  return {
    available: true,
    kind: 'exact-line-cross-book-arbitrage',
    line: over.line,
    impliedSum: Number(impliedSum.toFixed(6)),
    roi: Number(roi.toFixed(6)),
    roiPct: Number((roi * 100).toFixed(2)),
    over: {
      bookKey: over.bookKey,
      bookName: over.bookName,
      price: over.price,
      decimalOdds: Number(over.decimal.toFixed(6)),
      observedAt: new Date(over.at).toISOString(),
      deeplink: over.deeplink,
    },
    under: {
      bookKey: under.bookKey,
      bookName: under.bookName,
      price: under.price,
      decimalOdds: Number(under.decimal.toFixed(6)),
      observedAt: new Date(under.at).toISOString(),
      deeplink: under.deeplink,
    },
    example: {
      totalStake: Number(total.toFixed(2)),
      overStake: Number(overStake.toFixed(2)),
      underStake: Number(underStake.toFixed(2)),
      equalizedPayout: Number(equalizedPayout.toFixed(2)),
      theoreticalProfit: Number((equalizedPayout - total).toFixed(2)),
    },
    note: 'Theoretical cross-book arbitrage at the observed prices. Availability, limits, void rules and line movement can remove the opportunity before placement.',
  };
}

/**
 * Find exact-line two-way player-prop arbitrage using already-normalized quotes.
 *
 * This function never fetches a sportsbook, never widens provider polling and
 * never treats a neighbouring line as interchangeable. Both sides must be
 * fresh, priced, regular quotes at the exact same number from different books.
 */
export function findArbitrageOpportunities(rows = [], {
  now = Date.now(),
  maxAgeMs = MAX_ARBITRAGE_AGE_MS,
  bankroll = 100,
  includeLive = false,
} = {}) {
  const current = freshestOffers(rows, { now, maxAgeMs, includeLive });
  const byLine = new Map();
  for (const offer of current) {
    if (!byLine.has(offer.line)) byLine.set(offer.line, { OVER: [], UNDER: [] });
    byLine.get(offer.line)[offer.side].push(offer);
  }

  const signals = [];
  for (const [line, sides] of byLine) {
    for (const over of sides.OVER) {
      for (const under of sides.UNDER) {
        const signal = pairSignal(over, under, bankroll);
        if (signal) signals.push(signal);
      }
    }
  }
  return signals.sort((a, b) =>
    b.roi - a.roi ||
    b.over.decimalOdds - a.over.decimalOdds ||
    b.under.decimalOdds - a.under.decimalOdds ||
    a.line - b.line
  );
}

export function bestArbitrage(rows = [], options = {}) {
  return findArbitrageOpportunities(rows, options)[0] || null;
}

export function arbitrageLabel(signal) {
  if (!signal?.available) return null;
  const money = value => {
    const number = num(value);
    if (number === null) return '—';
    return number > 0 ? `+${number}` : String(number);
  };
  return `${signal.roiPct.toFixed(2)}% theoretical · ${signal.over.bookName} OVER ${signal.line} ${money(signal.over.price)} / ${signal.under.bookName} UNDER ${signal.line} ${money(signal.under.price)}`;
}
