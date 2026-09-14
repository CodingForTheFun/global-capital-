// Fair value for a DFS pick'em leg, taken from the books that price both sides.
//
// The board already compares sportsbook against sportsbook to find stale lines.
// The props people actually play are the DFS ones — PrizePicks, Underdog, Pick6
// — and those carry no price at all, just a number. That leaves the hit-rate
// donut as the only signal on the card, and a hit rate is a record of the past,
// not a probability for tonight.
//
// A sportsbook quoting both sides of the same number is stating a probability.
// Strip the vig out of that pair and you have the market's fair price for the
// exact line the DFS board is offering. A pick'em leg pays as a coin flip, so
// the fair probability minus 50% is the leg's edge, and it is a real number
// rather than an extrapolation from ten games.
//
// What this deliberately will not do:
//   - compare across different numbers. Over 0.5 hits and over 1.5 hits are
//     different bets; a "fair probability" borrowed from a neighbouring line is
//     an invented one.
//   - price a single side. Without both sides there is no vig to remove, and a
//     one-way price is mostly margin.
//   - guess a payout multiplier. The public feeds expose which lines are demons
//     and goblins but never what they pay, so those are reported, not priced.
//   - carry a stale price. A number from before the news is not the market.
// Every one of those cases returns a reason instead of a number.
import { bookInfo } from '../constants/books.mjs';
import { isSharpBook, noVigProbability } from '../markets/line-lag.mjs';

// A price older than this is not describing the current market.
export const MAX_PRICE_AGE_MS = 30 * 60 * 1000;
// Below this the "edge" is inside the noise of the books' own disagreement.
export const MEANINGFUL_EDGE = 0.03;
// One retail book alone is its own opinion; a consensus needs corroboration.
export const MIN_CONSENSUS_BOOKS = 2;

const num = value => (typeof value === 'number' && Number.isFinite(value) ? value
  : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null);
const sideOf = row => String(row?.side || '').toUpperCase();
const keyOf = row => String(row?.sportsbookKey || row?.sportsbook || '').toLowerCase();
const stampOf = row => Date.parse(row?.providerUpdatedAt || row?.updatedAt || row?.ingestedAt) || 0;

/** Books that post a number without a price: the DFS boards themselves. */
export const isDfsBook = key => bookInfo(key)?.type === 'dfs';

/**
 * Collapse offers into { bookKey -> line -> {over, under, at} }, keeping only
 * the freshest quote per book/line/side.
 */
function priceIndex(offers, { now, maxAgeMs }) {
  const index = new Map();
  for (const row of offers) {
    const key = keyOf(row), line = num(row?.line), price = num(row?.price), side = sideOf(row);
    if (!key || line === null || price === null) continue;
    if (side !== 'OVER' && side !== 'UNDER') continue;
    if (isDfsBook(key)) continue;
    const at = stampOf(row);
    if (at && now - at > maxAgeMs) continue;
    if (!index.has(key)) index.set(key, new Map());
    const byLine = index.get(key);
    const slot = byLine.get(line) || { over: null, under: null, at: 0 };
    const field = side === 'OVER' ? 'over' : 'under';
    if (slot[field] === null || at >= slot.at) { slot[field] = price; slot.at = Math.max(slot.at, at); }
    byLine.set(line, slot);
  }
  return index;
}

/** The line the DFS boards are actually offering, with the books offering it. */
function dfsLine(offers) {
  const byLine = new Map();
  for (const row of offers) {
    const line = num(row?.line);
    if (line === null || !isDfsBook(keyOf(row))) continue;
    const seen = byLine.get(line) || new Set();
    seen.add(keyOf(row));
    byLine.set(line, seen);
  }
  if (!byLine.size) return null;
  // When DFS boards disagree, the one more of them post is the real board line.
  const ranked = [...byLine.entries()].sort((a, b) => b[1].size - a[1].size || a[0] - b[0]);
  return { line: ranked[0][0], books: [...ranked[0][1]].sort() };
}

const median = values => {
  const sorted = [...values].sort((a, b) => a - b), mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Fair probability for a DFS leg, or a reason it cannot be stated.
 *
 * @param offers every quote gathered for one prop, DFS and sportsbook alike.
 * @returns {{line:number, overProbability:number, side:string,
 *   sideProbability:number, edge:number, basis:'sharp'|'consensus',
 *   books:string[], bookName:string, pricedAt:string|null, dfsBooks:string[]}
 *   | {reason:string}}
 */
export function dfsFairValue(offers = [], { now = Date.now(), maxAgeMs = MAX_PRICE_AGE_MS,
  minConsensusBooks = MIN_CONSENSUS_BOOKS } = {}) {
  const rows = Array.isArray(offers) ? offers : [];
  const board = dfsLine(rows);
  if (!board) return { reason: 'NO_DFS_LINE' };

  const index = priceIndex(rows, { now, maxAgeMs });
  if (!index.size) return { reason: 'NO_BOOK_PRICES' };

  // Only quotes on the same number can speak to this bet.
  const atLine = [];
  for (const [key, byLine] of index) {
    const slot = byLine.get(board.line);
    if (!slot) continue;
    if (slot.over === null || slot.under === null) continue;
    const probability = noVigProbability(slot.over, slot.under, 'OVER');
    if (probability === null || !(probability > 0 && probability < 1)) continue;
    atLine.push({ key, probability, at: slot.at });
  }
  if (!atLine.length) {
    // Separate "nobody posts this number" from "nobody posts both sides of it",
    // because they say different things about the line.
    const anyLine = [...index.values()].some(byLine => byLine.size > 0);
    const sameLine = [...index.values()].some(byLine => byLine.has(board.line));
    return { reason: sameLine ? 'NO_TWO_SIDED_PRICE' : anyLine ? 'NO_MATCHING_BOOK_LINE' : 'NO_BOOK_PRICES' };
  }

  // A sharp book is the reference when one is present; otherwise corroborated
  // retail books stand in, and the result says which it was.
  const sharp = atLine.filter(row => isSharpBook(row.key));
  const used = sharp.length ? sharp : atLine;
  const basis = sharp.length ? 'sharp' : 'consensus';
  if (basis === 'consensus' && used.length < minConsensusBooks) return { reason: 'NEEDS_MORE_BOOKS' };

  const overProbability = basis === 'sharp' ? median(sharp.map(r => r.probability)) : median(used.map(r => r.probability));
  const side = overProbability >= 0.5 ? 'OVER' : 'UNDER';
  const sideProbability = side === 'OVER' ? overProbability : 1 - overProbability;
  const pricedAt = Math.max(...used.map(r => r.at));
  return {
    line: board.line,
    overProbability,
    side,
    sideProbability,
    // A pick'em leg pays as a coin flip, so 50% is the break-even.
    edge: sideProbability - 0.5,
    basis,
    books: used.map(r => r.key).sort(),
    bookName: used.length === 1 ? bookInfo(used[0].key).name : `${used.length} books`,
    pricedAt: pricedAt ? new Date(pricedAt).toISOString() : null,
    dfsBooks: board.books,
  };
}

/**
 * One line of copy for the card. Returns null when there is nothing honest to
 * say, so the UI shows nothing rather than a hedge.
 */
export function describeDfsEdge(value) {
  if (!value || value.reason || !Number.isFinite(value.edge)) return null;
  const pct = n => `${(n * 100).toFixed(1)}%`;
  // Naming the book is worth more than a category when only one priced it.
  const one = value.books.length === 1;
  const subject = one ? bookInfo(value.books[0]).name
    : value.basis === 'sharp' ? `${value.books.length} sharp books` : `${value.books.length} books`;
  const verb = plural => (one ? plural.one : plural.many);
  const shot = `${value.side.toLowerCase()} ${value.line} a ${pct(value.sideProbability)} shot`;
  if (Math.abs(value.edge) < MEANINGFUL_EDGE) {
    return `${subject} ${verb({ one: 'prices', many: 'price' })} ${value.side.toLowerCase()} ${value.line} at ${pct(value.sideProbability)} — no real edge either way`;
  }
  return `${subject} ${verb({ one: 'makes', many: 'make' })} ${shot} — ${pct(value.edge)} better than the coin flip this pays like`;
}

/** Whether an edge clears the noise floor and is worth flagging on the board. */
export const hasMeaningfulEdge = value =>
  !!value && !value.reason && Number.isFinite(value.edge) && value.edge >= MEANINGFUL_EDGE;
