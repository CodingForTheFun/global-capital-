const EPS = 1e-9;

export const EV_POLICY = Object.freeze({
  maxQuoteAgeMs: 5 * 60_000,
  maxPairSkewMs: 60_000,
});

const DFS_BOOKS = new Set([
  'prizepicks',
  'underdog',
  'underdogfantasy',
  'sleeper',
  'parlayplay',
  'betrpicks',
  'chalkboard',
]);

const PROVIDER_BOOKS = new Set([
  'espn',
  'sportsdataio',
  'sportsgameodds',
  'propline',
  'clearsports',
  'sportradar',
]);

const number = value => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const text = value => String(value ?? '').trim();

function compactBook(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function bookKey(row) {
  return compactBook(row?.sportsbookKey || row?.bookmakerKey || row?.sportsbook);
}

function decimalOdds(value) {
  const price = number(value);
  if (price === null || Math.abs(price) < 100) return null;
  return price > 0 ? 1 + price / 100 : 1 + 100 / -price;
}

function impliedProbability(value) {
  const decimal = decimalOdds(value);
  return decimal === null ? null : 1 / decimal;
}

function quoteTime(row) {
  for (const value of [row?.lastSeenAt, row?.ingestedAt, row?.updatedAt, row?.providerUpdatedAt]) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function sideOf(row) {
  const side = text(row?.side).toUpperCase();
  return side === 'OVER' || side === 'UNDER' ? side : null;
}

function lineMatches(row, group) {
  const line = number(row?.line);
  const groupLine = number(group?.line);
  return line !== null && groupLine !== null && Math.abs(line - groupLine) <= EPS;
}

function current(row, group, now) {
  if (!row || group?.live === true || row.live === true || row.started === true || row.completed === true
    || row.stale === true || row.suspended === true || row.isAlternate === true || !lineMatches(row, group)) return false;
  const observedAt = quoteTime(row);
  if (observedAt === null) return true;
  return observedAt <= now && now - observedAt <= EV_POLICY.maxQuoteAgeMs;
}

function straightQuote(row, group, now) {
  if (!current(row, group, now) || row?.requiresParlay === true) return null;
  const book = bookKey(row);
  const payoutType = text(row?.payoutType).toLowerCase();
  if (!book || DFS_BOOKS.has(book) || PROVIDER_BOOKS.has(book) || (payoutType && payoutType !== 'straight')) return null;
  const side = sideOf(row);
  const price = number(row?.price);
  const decimal = decimalOdds(price);
  if (!side || price === null || decimal === null) return null;
  return {
    row,
    bookKey: book,
    sportsbookKey: text(row?.sportsbookKey || row?.sportsbook) || book,
    bookName: text(row?.sportsbook || row?.sportsbookKey) || book,
    side,
    price,
    decimal,
    observedAt: quoteTime(row),
  };
}

function bestStraightQuote(group, side, now) {
  const rows = (Array.isArray(group?.quotes) ? group.quotes : [])
    .map(row => straightQuote(row, group, now))
    .filter(Boolean)
    .filter(quote => quote.side === side);
  rows.sort((a, b) => b.price - a.price || a.bookKey.localeCompare(b.bookKey));
  return rows[0] || null;
}

function probability01(value) {
  const parsed = number(value);
  if (parsed === null || parsed < 0) return null;
  if (parsed <= 1) return parsed;
  if (parsed <= 100) return parsed / 100;
  return null;
}

function median(values) {
  const clean = values.filter(value => Number.isFinite(value)).sort((a, b) => a - b);
  if (!clean.length) return null;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}

function exactFairProbability(group, side, now) {
  const groupLine = number(group?.line);
  if (groupLine === null) return null;
  const values = [];
  for (const row of Array.isArray(group?.quotes) ? group.quotes : []) {
    if (!current(row, group, now) || sideOf(row) !== side || row?.fairOddsAvailable === false) continue;
    const fairLine = number(row?.fairLine ?? row?.fairOverUnder);
    if (fairLine === null || Math.abs(fairLine - groupLine) > EPS) continue;
    const probability = impliedProbability(row?.fairOdds);
    if (probability !== null) values.push(probability);
  }
  return median(values);
}

function pairedBookProbabilities(group, now) {
  const byBook = new Map();
  for (const row of Array.isArray(group?.quotes) ? group.quotes : []) {
    const quote = straightQuote(row, group, now);
    if (!quote) continue;
    const bucket = byBook.get(quote.bookKey) || {};
    const previous = bucket[quote.side];
    if (!previous || (quote.observedAt ?? 0) >= (previous.observedAt ?? 0)) bucket[quote.side] = quote;
    byBook.set(quote.bookKey, bucket);
  }

  const pairs = [];
  for (const [book, bucket] of byBook) {
    const over = bucket.OVER;
    const under = bucket.UNDER;
    if (!over || !under) continue;
    if (over.observedAt !== null && under.observedAt !== null
      && Math.abs(over.observedAt - under.observedAt) > EV_POLICY.maxPairSkewMs) continue;
    const overRaw = 1 / over.decimal;
    const underRaw = 1 / under.decimal;
    const total = overRaw + underRaw;
    if (!(total > 0)) continue;
    pairs.push({
      bookKey: book,
      over: overRaw / total,
      under: underRaw / total,
    });
  }
  return pairs;
}

function crossBookFairProbability(group, side, targetBook, now) {
  const references = pairedBookProbabilities(group, now).filter(pair => pair.bookKey !== targetBook);
  return median(references.map(pair => side === 'OVER' ? pair.over : pair.under));
}

function resultFor(quote, side, probability, pushProbability, source) {
  if (!quote || probability === null) return null;
  const push = pushProbability ?? 0;
  if (push < 0 || push > 1 || probability + push > 1 + EPS) return null;
  return {
    side,
    ev: (probability * quote.decimal + push - 1) * 100,
    probability,
    pushProbability: push,
    price: quote.price,
    sportsbook: quote.bookName,
    sportsbookKey: quote.sportsbookKey,
    source,
  };
}

/**
 * Best verified single-leg EV for one exact prop line.
 *
 * Hierarchy:
 * 1) validated/adaptive model probability;
 * 2) exact-line no-vig fair odds supplied by the odds feed;
 * 3) no-vig probability from other complete two-sided sportsbooks.
 *
 * DFS/parlay-only prices are deliberately excluded: a multi-leg payout is not
 * a straight single-leg return and cannot be labelled as card-level EV.
 */
export function expectedValueFor(group, prediction, { now = Date.now() } = {}) {
  if (!group || group.live === true || !Number.isFinite(now)) return null;

  const overQuote = bestStraightQuote(group, 'OVER', now);
  const underQuote = bestStraightQuote(group, 'UNDER', now);
  const candidates = [];

  if (prediction?.available === true) {
    const push = probability01(prediction.probabilityPush) ?? 0;
    const over = resultFor(overQuote, 'OVER', probability01(prediction.probabilityOver), push, 'model');
    const under = resultFor(underQuote, 'UNDER', probability01(prediction.probabilityUnder), push, 'model');
    if (over) candidates.push(over);
    if (under) candidates.push(under);
  }

  if (!candidates.length) {
    for (const [side, quote] of [['OVER', overQuote], ['UNDER', underQuote]]) {
      if (!quote) continue;
      const fair = exactFairProbability(group, side, now);
      const probability = fair ?? crossBookFairProbability(group, side, quote.bookKey, now);
      const source = fair !== null ? 'fair-odds' : probability !== null ? 'market-consensus' : null;
      const candidate = source ? resultFor(quote, side, probability, 0, source) : null;
      if (candidate) candidates.push(candidate);
    }
  }

  candidates.sort((a, b) => b.ev - a.ev || a.side.localeCompare(b.side));
  return candidates[0] || null;
}

export function expectedValueSourceLabel(value) {
  if (!value) return null;
  if (value.source === 'model') return 'Verified model probability';
  if (value.source === 'fair-odds') return 'Exact-line no-vig fair odds';
  if (value.source === 'market-consensus') return 'Cross-book no-vig consensus';
  return 'Verified probability';
}
