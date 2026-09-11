// Stale line / book lag detection.
//
// The premise: sharp books move first. When Pinnacle or Circa have shaded a
// price or moved a number and a retail book is still posting the old one, the
// retail price is the stale side of a move that already happened.
//
// Two rules apply throughout:
//
//   • A sharp reference is required. With no sharp book in the payload there is
//     no basis for calling anything stale, and this returns nothing rather than
//     promoting the best retail price into a fake reference. Sharp books live
//     in the eu and us2 regions, so a narrow bookmaker scope legitimately
//     produces no signals at all.
//   • Both sides are compared at the same line. A price is only comparable to
//     another price for the same number; comparing -110 at 63.5 with -130 at
//     66.5 is a different bet, not an edge.

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

/** One-line label for the badge. Never names a book that is not in the data. */
export function staleLineLabel(signal) {
  if (!signal) return null;
  if (signal.kind === 'line') {
    return `${signal.retailBook} still at ${signal.line}, sharp moved to ${signal.sharpLine}`;
  }
  const price = (value) => (value > 0 ? `+${value}` : String(value));
  return `${signal.retailBook} ${price(signal.retailPrice)} vs sharp ${price(signal.sharpPrice)} · ${signal.edgePoints} pts`;
}
