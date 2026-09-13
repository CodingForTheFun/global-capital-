// Stale-line detection plus a dedicated market-backed snipe engine.
//
// A snipe is an executable quote, not a generic player prop. It must be
// materially better for the bettor than either a sharp reference or a
// multi-book market consensus. Regular prop rows are never promoted to snipes
// merely because they exist on the board.

const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const median = (values = []) => {
  const sorted = values.map(num).filter((value) => value !== null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

// Books whose prices usually lead the market.
export const SHARP_BOOKS = Object.freeze(['pinnacle', 'circasports', 'bookmaker_eu']);
// Retail books where a lagging number is directly actionable.
export const RETAIL_BOOKS = Object.freeze([
  'draftkings', 'fanduel', 'betmgm', 'williamhill_us', 'caesars',
  'betrivers', 'fanatics', 'espnbet', 'pointsbetus', 'wynnbet',
]);

export const SHADED_PRICE = -125;
export const NEAR_EVEN_PRICE = -115;
export const MIN_EDGE_POINTS = 3;
// Consensus snipes require a real half-point-or-better number advantage.
export const MIN_SNIPE_LINE_GAP = 0.5;
// A non-sharp consensus signal needs at least two independent reference books.
export const MIN_SNIPE_REFERENCE_BOOKS = 2;
export const MIN_SNIPE_SUPPORT_RATIO = 0.6;
// Price snipes are only surfaced at +3% or better estimated EV.
export const MIN_SNIPE_EV = 0.03;
// Current-feed observations older than this cannot create a new snipe.
export const MAX_SNIPE_AGE_MS = 15 * 60 * 1000;

export const isSharpBook = (key) => SHARP_BOOKS.includes(String(key || '').toLowerCase());
export const isRetailBook = (key) => RETAIL_BOOKS.includes(String(key || '').toLowerCase());

export function impliedProbability(americanOdds) {
  const price = num(americanOdds);
  if (price === null || price === 0) return null;
  const magnitude = Math.abs(price);
  return price > 0 ? 100 / (magnitude + 100) : magnitude / (magnitude + 100);
}

export function decimalOdds(americanOdds) {
  const price = num(americanOdds);
  if (price === null || price === 0) return null;
  return price > 0 ? 1 + price / 100 : 1 + 100 / Math.abs(price);
}

export function noVigProbability(overOdds, underOdds, side) {
  const over = impliedProbability(overOdds);
  const under = impliedProbability(underOdds);
  if (over === null || under === null || over + under <= 0) return null;
  const normalized = String(side || '').toUpperCase() === 'UNDER' ? under / (over + under) : over / (over + under);
  return Number.isFinite(normalized) ? normalized : null;
}

/**
 * Strict sharp-vs-retail stale-line detector retained for high-confidence
 * two-book signals. A sharp reference is mandatory here.
 */
export function detectStaleLine(rows = []) {
  const offers = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      key: String(row?.sportsbookKey || '').toLowerCase(),
      book: row?.sportsbook || row?.sportsbookKey || null,
      side: String(row?.side || '').toUpperCase(),
      line: num(row?.line),
      price: num(row?.price),
    }))
    .filter((row) => row.key && (row.side === 'OVER' || row.side === 'UNDER') && row.line !== null && row.price !== null);

  const sharp = offers.filter((row) => isSharpBook(row.key));
  const retail = offers.filter((row) => isRetailBook(row.key));
  if (!sharp.length || !retail.length) return null;

  const signals = [];
  for (const side of ['OVER', 'UNDER']) {
    const sharpSide = sharp.filter((row) => row.side === side);
    const retailSide = retail.filter((row) => row.side === side);
    if (!sharpSide.length || !retailSide.length) continue;

    for (const sharpOffer of sharpSide) {
      for (const retailOffer of retailSide.filter((row) => row.line === sharpOffer.line)) {
        if (sharpOffer.price > SHADED_PRICE || retailOffer.price < NEAR_EVEN_PRICE) continue;
        const sharpProbability = impliedProbability(sharpOffer.price);
        const retailProbability = impliedProbability(retailOffer.price);
        if (sharpProbability === null || retailProbability === null) continue;
        const gap = (sharpProbability - retailProbability) * 100;
        if (gap < MIN_EDGE_POINTS) continue;
        signals.push({
          kind: 'price', side, line: sharpOffer.line,
          sharpBook: sharpOffer.book, sharpKey: sharpOffer.key, sharpPrice: sharpOffer.price,
          retailBook: retailOffer.book, retailKey: retailOffer.key, retailPrice: retailOffer.price,
          edgePoints: Number(gap.toFixed(1)),
        });
      }

      for (const retailOffer of retailSide.filter((row) => row.line !== sharpOffer.line)) {
        const better = side === 'OVER' ? retailOffer.line < sharpOffer.line : retailOffer.line > sharpOffer.line;
        if (!better) continue;
        const move = Math.abs(sharpOffer.line - retailOffer.line);
        if (move < MIN_SNIPE_LINE_GAP) continue;
        signals.push({
          kind: 'line', side, line: retailOffer.line, sharpLine: sharpOffer.line,
          sharpBook: sharpOffer.book, sharpKey: sharpOffer.key, sharpPrice: sharpOffer.price,
          retailBook: retailOffer.book, retailKey: retailOffer.key, retailPrice: retailOffer.price,
          lineMove: Number(move.toFixed(2)),
          edgePoints: null,
        });
      }
    }
  }
  if (!signals.length) return null;

  signals.sort((a, b) => (a.kind === b.kind
    ? (b.edgePoints ?? b.lineMove ?? 0) - (a.edgePoints ?? a.lineMove ?? 0)
    : a.kind === 'line' ? -1 : 1));
  return { ...signals[0], signalCount: signals.length };
}

function timestamp(row) {
  // ingestedAt/observedAt prove the quote was present on the latest board even
  // when a provider's own updated_at value has not changed for hours.
  const value = row?.ingestedAt || row?.observedAt || row?.updatedAt || row?.providerUpdatedAt || null;
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function automaticOffers(rows, now) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      key: String(row?.sportsbookKey || '').toLowerCase(),
      book: row?.sportsbook || row?.sportsbookKey || null,
      side: String(row?.side || '').toUpperCase(),
      line: num(row?.line),
      price: num(row?.price),
      updatedAt: timestamp(row),
    }))
    .filter((row) => {
      if (!row.key || (row.side !== 'OVER' && row.side !== 'UNDER') || row.line === null) return false;
      return row.updatedAt === null || Math.max(0, now - row.updatedAt) <= MAX_SNIPE_AGE_MS;
    });
}

function latestByBookSide(offers, side) {
  const byBook = new Map();
  for (const offer of offers) {
    if (offer.side !== side) continue;
    const previous = byBook.get(offer.key);
    if (!previous || (offer.updatedAt || 0) > (previous.updatedAt || 0)) byBook.set(offer.key, offer);
  }
  return [...byBook.values()];
}

function targetSet(targetBooks) {
  if (!Array.isArray(targetBooks)) return null;
  return new Set(targetBooks.map((value) => String(value || '').toLowerCase()).filter(Boolean));
}

function ageMs(offer, now) {
  return offer?.updatedAt === null || offer?.updatedAt === undefined ? null : Math.max(0, now - offer.updatedAt);
}

function currentRows(rows, now) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const at = timestamp(row);
    return at === null || Math.max(0, now - at) <= MAX_SNIPE_AGE_MS;
  });
}

function strictOpportunity(rows, offers, now, targets) {
  const strict = detectStaleLine(currentRows(rows, now));
  if (!strict || (targets && !targets.has(String(strict.retailKey || '').toLowerCase()))) return null;
  const target = offers.find((offer) => offer.key === strict.retailKey && offer.side === strict.side && offer.line === strict.line) || null;
  if (strict.kind === 'line') {
    return {
      kind: 'sharp-line', source: 'sharp-lag', side: strict.side,
      targetBook: strict.retailBook, targetKey: strict.retailKey, line: strict.line, price: strict.retailPrice,
      referenceBook: strict.sharpBook, referenceKey: strict.sharpKey, referenceLine: strict.sharpLine, referencePrice: strict.sharpPrice,
      lineGap: strict.lineMove, lineMove: strict.lineMove, edgePoints: null, edgePct: null,
      referenceCount: 1, supportCount: 1, supportRatio: 1, bookCount: 2,
      quality: 'Sharp-confirmed', updatedAt: target?.updatedAt ?? null, ageMs: ageMs(target, now),
      score: 100 + (strict.lineMove || 0) * 12,
      retailBook: strict.retailBook, retailKey: strict.retailKey, retailPrice: strict.retailPrice,
      sharpBook: strict.sharpBook, sharpKey: strict.sharpKey, sharpLine: strict.sharpLine, sharpPrice: strict.sharpPrice,
    };
  }
  return {
    kind: 'sharp-price', source: 'sharp-lag', side: strict.side,
    targetBook: strict.retailBook, targetKey: strict.retailKey, line: strict.line, price: strict.retailPrice,
    referenceBook: strict.sharpBook, referenceKey: strict.sharpKey, referenceLine: strict.line, referencePrice: strict.sharpPrice,
    lineGap: 0, lineMove: 0, edgePoints: strict.edgePoints, edgePct: null,
    referenceCount: 1, supportCount: 1, supportRatio: 1, bookCount: 2,
    quality: 'Sharp-confirmed', updatedAt: target?.updatedAt ?? null, ageMs: ageMs(target, now),
    score: 80 + (strict.edgePoints || 0),
    retailBook: strict.retailBook, retailKey: strict.retailKey, retailPrice: strict.retailPrice,
    sharpBook: strict.sharpBook, sharpKey: strict.sharpKey, sharpLine: strict.line, sharpPrice: strict.sharpPrice,
  };
}

function pairedConsensus(offers, target) {
  const byBook = new Map();
  for (const offer of offers) {
    if (offer.key === target.key || offer.line !== target.line || offer.price === null) continue;
    if (!byBook.has(offer.key)) byBook.set(offer.key, { key: offer.key, book: offer.book, OVER: null, UNDER: null });
    const slot = byBook.get(offer.key);
    const previous = slot[offer.side];
    if (!previous || (offer.updatedAt || 0) > (previous.updatedAt || 0)) slot[offer.side] = offer;
  }
  const probabilities = [];
  const books = [];
  for (const pair of byBook.values()) {
    if (!pair.OVER || !pair.UNDER) continue;
    const fair = noVigProbability(pair.OVER.price, pair.UNDER.price, target.side);
    if (fair === null) continue;
    probabilities.push(fair);
    books.push(pair.book || pair.key);
  }
  return { probabilities, books };
}

/**
 * Return every current executable snipe for one player/market group.
 *
 * Consensus line snipes require 3+ books total (target + 2 references). A
 * sharp-vs-retail lag may surface with two books because the reference itself
 * is explicitly designated sharp. Price snipes require a two-book no-vig
 * reference consensus at the exact same line.
 */
export function findSnipeOpportunities(rows = [], { now = Date.now(), targetBooks = null } = {}) {
  const offers = automaticOffers(rows, now);
  if (!offers.length) return [];
  const targets = targetSet(targetBooks);
  const allowed = (key) => targets === null || targets.has(String(key || '').toLowerCase());
  const candidates = [];

  const strict = strictOpportunity(rows, offers, now, targets);
  if (strict) candidates.push(strict);

  for (const side of ['OVER', 'UNDER']) {
    const sideOffers = latestByBookSide(offers, side);
    for (const target of sideOffers) {
      if (!allowed(target.key)) continue;
      const refs = sideOffers.filter((offer) => offer.key !== target.key);
      if (refs.length >= MIN_SNIPE_REFERENCE_BOOKS) {
        const referenceLine = median(refs.map((offer) => offer.line));
        if (referenceLine !== null) {
          const gap = side === 'OVER' ? referenceLine - target.line : target.line - referenceLine;
          const support = refs.filter((offer) => side === 'OVER'
            ? offer.line >= target.line + MIN_SNIPE_LINE_GAP
            : offer.line <= target.line - MIN_SNIPE_LINE_GAP);
          const supportRatio = refs.length ? support.length / refs.length : 0;
          if (gap >= MIN_SNIPE_LINE_GAP && support.length >= MIN_SNIPE_REFERENCE_BOOKS && supportRatio >= MIN_SNIPE_SUPPORT_RATIO) {
            const sharpReference = support.find((offer) => isSharpBook(offer.key));
            candidates.push({
              kind: 'line-consensus', source: sharpReference ? 'sharp-consensus' : 'market-consensus', side,
              targetBook: target.book, targetKey: target.key, line: target.line, price: target.price,
              referenceBook: sharpReference?.book || 'Market consensus', referenceKey: sharpReference?.key || null,
              referenceLine: Number(referenceLine.toFixed(2)), referencePrice: sharpReference?.price ?? null,
              lineGap: Number(gap.toFixed(2)), lineMove: Number(gap.toFixed(2)), edgePoints: null, edgePct: null,
              referenceCount: refs.length, supportCount: support.length, supportRatio: Number(supportRatio.toFixed(3)), bookCount: refs.length + 1,
              quality: sharpReference ? 'Sharp + consensus' : `${support.length}/${refs.length} books agree`,
              updatedAt: target.updatedAt, ageMs: ageMs(target, now),
              score: Number((gap * 12 + supportRatio * 10 + Math.min(refs.length, 5) + (sharpReference ? 6 : 0)).toFixed(3)),
              retailBook: target.book, retailKey: target.key, retailPrice: target.price,
              sharpBook: sharpReference?.book || 'Market consensus', sharpKey: sharpReference?.key || null, sharpLine: Number(referenceLine.toFixed(2)), sharpPrice: sharpReference?.price ?? null,
            });
          }
        }
      }

      if (target.price !== null) {
        const paired = pairedConsensus(offers, target);
        if (paired.probabilities.length >= MIN_SNIPE_REFERENCE_BOOKS) {
          const fairProbability = median(paired.probabilities);
          const implied = impliedProbability(target.price);
          const decimal = decimalOdds(target.price);
          if (fairProbability !== null && implied !== null && decimal !== null) {
            const edgePoints = (fairProbability - implied) * 100;
            const ev = fairProbability * decimal - 1;
            if (ev >= MIN_SNIPE_EV && edgePoints >= 2) {
              candidates.push({
                kind: 'price-consensus', source: 'no-vig-consensus', side,
                targetBook: target.book, targetKey: target.key, line: target.line, price: target.price,
                referenceBook: 'No-vig market', referenceKey: null, referenceLine: target.line, referencePrice: null,
                lineGap: 0, lineMove: 0, edgePoints: Number(edgePoints.toFixed(1)), edgePct: Number((ev * 100).toFixed(1)),
                fairProbability: Number(fairProbability.toFixed(4)), targetImpliedProbability: Number(implied.toFixed(4)),
                referenceCount: paired.probabilities.length, supportCount: paired.probabilities.length, supportRatio: 1, bookCount: paired.probabilities.length + 1,
                quality: `${paired.probabilities.length}-book no-vig`, referenceBooks: paired.books,
                updatedAt: target.updatedAt, ageMs: ageMs(target, now),
                score: Number((ev * 100 + paired.probabilities.length + 20).toFixed(3)),
                retailBook: target.book, retailKey: target.key, retailPrice: target.price,
                sharpBook: 'No-vig market', sharpKey: null, sharpLine: target.line, sharpPrice: null,
              });
            }
          }
        }
      }
    }
  }

  const deduped = new Map();
  for (const candidate of candidates) {
    const key = [candidate.targetKey, candidate.side, candidate.line].join('|');
    const previous = deduped.get(key);
    if (!previous || candidate.score > previous.score) deduped.set(key, candidate);
  }
  return [...deduped.values()].sort((a, b) => b.score - a.score || (b.lineGap || 0) - (a.lineGap || 0));
}

/** Backward-compatible single strongest signal for regular-board badges. */
export function detectSnipe(rows = [], options = {}) {
  return findSnipeOpportunities(rows, options)[0] || null;
}

/** One-line label for a stale-line or consensus-backed snipe. */
export function staleLineLabel(signal) {
  if (!signal) return null;
  if (signal.kind === 'line-consensus') {
    return `${signal.targetBook} ${signal.side} ${signal.line} vs market ${signal.referenceLine} · ${signal.lineGap} better`;
  }
  if (signal.kind === 'price-consensus') {
    const price = signal.price > 0 ? `+${signal.price}` : String(signal.price);
    return `${signal.targetBook} ${price} · ${signal.edgePct}% estimated EV vs no-vig market`;
  }
  if (signal.kind === 'sharp-line' || signal.kind === 'line') {
    return `${signal.targetBook || signal.retailBook} ${signal.side} ${signal.line} vs ${signal.referenceBook || signal.sharpBook} ${signal.referenceLine ?? signal.sharpLine}`;
  }
  if (signal.kind === 'sharp-price' || signal.kind === 'price') {
    const displayPrice = (value) => (value > 0 ? `+${value}` : String(value));
    return `${signal.targetBook || signal.retailBook} ${displayPrice(signal.price ?? signal.retailPrice)} vs sharp ${displayPrice(signal.referencePrice ?? signal.sharpPrice)} · ${signal.edgePoints} pts`;
  }
  if (signal.kind === 'crossbook') {
    return `${signal.retailBook} ${signal.side} ${signal.line} vs ${signal.referenceBook} ${signal.referenceLine} · ${signal.lineMove} better`;
  }
  return null;
}
