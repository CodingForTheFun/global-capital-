// Stale line / book lag and automatic cross-book snipe detection.
//
// Sharp stale-line detection stays deliberately strict: Pinnacle/Circa/
// Bookmaker must be present before we call a retail number stale. Automatic
// snipes are a separate layer. They can also surface a bettor-friendlier main
// line across current DFS/sportsbook quotes even when American odds are absent.

const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

// Books whose prices lead the market.
export const SHARP_BOOKS = Object.freeze(['pinnacle', 'circasports', 'bookmaker_eu']);
// Books that follow it, and where a lagging number is actually bettable.
export const RETAIL_BOOKS = Object.freeze([
  'draftkings', 'fanduel', 'betmgm', 'williamhill_us', 'caesars',
  'betrivers', 'fanatics', 'espnbet', 'pointsbetus', 'wynnbet',
]);

// A sharp price at or beyond this is a real opinion, not noise.
export const SHADED_PRICE = -125;
// A retail price at or better than this is still near even money.
export const NEAR_EVEN_PRICE = -115;
// Implied-probability gap below which a difference is not worth a badge.
export const MIN_EDGE_POINTS = 3;
// Ignore tiny float noise. Most pick'em/main-line moves are 0.5 or larger.
export const MIN_SNIPE_LINE_GAP = 0.25;
// A quote with an explicit old timestamp should not create a new snipe.
export const MAX_SNIPE_AGE_MS = 15 * 60 * 1000;

export const isSharpBook = (key) => SHARP_BOOKS.includes(String(key || '').toLowerCase());
export const isRetailBook = (key) => RETAIL_BOOKS.includes(String(key || '').toLowerCase());

export function impliedProbability(americanOdds) {
  const price = num(americanOdds);
  if (price === null || price === 0) return null;
  const magnitude = Math.abs(price);
  return price > 0 ? 100 / (magnitude + 100) : magnitude / (magnitude + 100);
}

/**
 * Find the strongest stale-line signal across one prop's offers.
 *
 * `rows` are the raw sportsbook offers for a single player/market group, each
 * carrying sportsbookKey, side, line and price.
 *
 * Two shapes count:
 *   price — sharp and retail post the same line, sharp has shaded it, retail
 *           is still near even money.
 *   line  — sharp has moved off the number retail is still posting, in the
 *           direction that favours the bettor at retail.
 *
 * This function intentionally keeps the original sharp-reference contract.
 * Use detectSnipe() for the broader automatic scanner.
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
      // Same-number price lag: sharp has shaded, retail has not followed.
      for (const retailOffer of retailSide.filter((row) => row.line === sharpOffer.line)) {
        if (sharpOffer.price > SHADED_PRICE || retailOffer.price < NEAR_EVEN_PRICE) continue;
        const gap = (impliedProbability(sharpOffer.price) - impliedProbability(retailOffer.price)) * 100;
        if (gap < MIN_EDGE_POINTS) continue;
        signals.push({
          kind: 'price', side, line: sharpOffer.line,
          sharpBook: sharpOffer.book, sharpKey: sharpOffer.key, sharpPrice: sharpOffer.price,
          retailBook: retailOffer.book, retailKey: retailOffer.key, retailPrice: retailOffer.price,
          edgePoints: Number(gap.toFixed(1)),
        });
      }

      // Number lag: retail is still posting a line sharp has moved away from,
      // and the stale number is the friendlier one for this side.
      for (const retailOffer of retailSide.filter((row) => row.line !== sharpOffer.line)) {
        const better = side === 'OVER' ? retailOffer.line < sharpOffer.line : retailOffer.line > sharpOffer.line;
        if (!better) continue;
        const move = Math.abs(sharpOffer.line - retailOffer.line);
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

  // A moved number beats a shaded price, and within each a bigger gap wins.
  signals.sort((a, b) => (a.kind === b.kind
    ? (b.edgePoints ?? b.lineMove ?? 0) - (a.edgePoints ?? a.lineMove ?? 0)
    : a.kind === 'line' ? -1 : 1));
  return { ...signals[0], signalCount: signals.length };
}

function timestamp(row) {
  const value = row?.providerUpdatedAt || row?.updatedAt || row?.ingestedAt || null;
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
      return row.updatedAt === null || now - row.updatedAt <= MAX_SNIPE_AGE_MS;
    });
}

/**
 * Automatic snipe scanner.
 *
 * 1. Prefer a strict sharp-vs-retail stale-line signal when one exists.
 * 2. Otherwise compare current main lines across distinct books/DFS platforms.
 *    This second mode does not require American odds, so PrizePicks/Underdog
 *    line differences can surface automatically.
 *
 * For OVER, a lower posted line is friendlier. For UNDER, a higher posted line
 * is friendlier. The signal disappears naturally when books converge.
 */
export function detectSnipe(rows = [], { now = Date.now() } = {}) {
  const sharp = detectStaleLine(rows);
  if (sharp) return { ...sharp, source: 'sharp-lag' };

  const offers = automaticOffers(rows, now);
  const signals = [];
  for (const side of ['OVER', 'UNDER']) {
    const byBook = new Map();
    for (const offer of offers.filter((row) => row.side === side)) {
      const previous = byBook.get(offer.key);
      if (!previous) byBook.set(offer.key, offer);
      else {
        // Main-line groups normally contain one quote per book/side. If a feed
        // repeats one, keep the bettor-friendlier current number.
        const better = side === 'OVER' ? offer.line < previous.line : offer.line > previous.line;
        if (better || (!better && offer.line === previous.line && (offer.updatedAt || 0) > (previous.updatedAt || 0))) byBook.set(offer.key, offer);
      }
    }
    const sideOffers = [...byBook.values()];
    if (sideOffers.length < 2) continue;

    sideOffers.sort((a, b) => side === 'OVER' ? a.line - b.line : b.line - a.line);
    const best = sideOffers[0];
    const reference = sideOffers[sideOffers.length - 1];
    const move = Math.abs(reference.line - best.line);
    if (best.key === reference.key || move < MIN_SNIPE_LINE_GAP) continue;

    signals.push({
      kind: 'crossbook',
      source: 'cross-book',
      side,
      line: best.line,
      retailBook: best.book,
      retailKey: best.key,
      retailPrice: best.price,
      referenceBook: reference.book,
      referenceKey: reference.key,
      referenceLine: reference.line,
      referencePrice: reference.price,
      // Keep these aliases so existing book-highlighting UI can light both ends.
      sharpBook: reference.book,
      sharpKey: reference.key,
      sharpLine: reference.line,
      sharpPrice: reference.price,
      lineMove: Number(move.toFixed(2)),
      edgePoints: null,
      signalCount: sideOffers.filter((row) => row.line !== reference.line).length,
    });
  }

  if (!signals.length) return null;
  signals.sort((a, b) => (b.lineMove || 0) - (a.lineMove || 0));
  return signals[0];
}

/** One-line label for a stale-line or automatic snipe badge. */
export function staleLineLabel(signal) {
  if (!signal) return null;
  if (signal.kind === 'crossbook') {
    return `${signal.retailBook} ${signal.side} ${signal.line} vs ${signal.referenceBook} ${signal.referenceLine} · ${signal.lineMove} better`;
  }
  if (signal.kind === 'line') {
    return `${signal.retailBook} still at ${signal.line}, sharp moved to ${signal.sharpLine}`;
  }
  const price = (value) => (value > 0 ? `+${value}` : String(value));
  return `${signal.retailBook} ${price(signal.retailPrice)} vs sharp ${price(signal.sharpPrice)} · ${signal.edgePoints} pts`;
}
