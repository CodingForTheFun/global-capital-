// Pre-match win probability from a completed event's closing moneyline.
//
// Research-only: it answers "how favoured was this player going into that
// match?" for a history filter. It never produces a current price, a pick or a
// projection. Every read goes through proplineGet, so the shared cache, the
// cooldown and the protected daily reserve all apply; closing prices do not
// change once a match is over, so each event is read at most once a week.
//
// Contract: PropLine /v1/sports/{sport}/events/{id}/odds/closing, read
// defensively. Flat rows ({market, name, closing_price, bookmaker}) and grouped
// bookmaker/market/outcome payloads are both accepted; anything that does not
// resolve to exactly this player and one named opponent at the same book is
// ignored rather than guessed.
import { proplineGet } from './client.mjs';
import { proplineSportKey } from './markets.mjs';
import { impliedProbability } from './normalize.mjs';

const text = value => String(value ?? '').trim();
const list = value => (Array.isArray(value) ? value : []);
const nameKey = value => text(value).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
const num = value => {
  if (value == null || typeof value === 'boolean' || text(value) === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const MONEYLINE_MARKETS = new Set(['h2h', 'moneyline', 'ml', 'match_winner', 'winner']);
export const MONEYLINE_SPORTS = new Set(['TENNIS']);
export const MAX_MONEYLINE_EVENTS = 15;
const CLOSE_TTL_SECONDS = 7 * 24 * 60 * 60;

function flatten(payload) {
  const flat = list(payload?.closing ?? payload?.data ?? payload?.odds ?? payload);
  const grouped = list(payload?.bookmakers).flatMap(book => list(book?.markets).flatMap(market =>
    list(market?.outcomes).map(outcome => ({
      bookmaker: book?.key ?? book?.title,
      market: market?.key,
      name: outcome?.name,
      closing_price: outcome?.closing_price ?? outcome?.price_american ?? outcome?.price,
      is_stale: outcome?.is_stale === true || market?.is_stale === true,
    }))));
  return [...flat, ...grouped];
}

/**
 * No-vig win probability for `player`, averaged over books that closed both
 * sides. A book quoting a third name, a conflicting duplicate or only one side
 * contributes nothing; with no qualifying book the answer is null.
 */
export function closingWinProbability(payload, player, opponent = null) {
  const me = nameKey(player), them = opponent ? nameKey(opponent) : null;
  if (!me) return null;
  const books = new Map();
  for (const row of flatten(payload)) {
    const market = text(row?.market ?? row?.market_key).toLowerCase();
    if (!MONEYLINE_MARKETS.has(market)) continue;
    const who = nameKey(row?.name ?? row?.outcome_name ?? row?.outcome ?? row?.participant ?? row?.team ?? row?.description);
    const price = num(row?.closing_price ?? row?.closing_price_american ?? row?.price_american ?? row?.price);
    if (!who || price === null || price === 0) continue;
    const book = text(row?.bookmaker ?? row?.bookmaker_key ?? row?.book) || 'market';
    const entry = books.get(book) || { sides: new Map(), conflict: false, stale: false };
    if (entry.sides.has(who) && entry.sides.get(who) !== price) entry.conflict = true;
    entry.sides.set(who, price);
    entry.stale ||= row?.is_stale === true;
    books.set(book, entry);
  }
  const fair = [];
  let stale = false;
  for (const entry of books.values()) {
    if (entry.conflict || entry.sides.size !== 2 || !entry.sides.has(me)) continue;
    const other = [...entry.sides.keys()].find(key => key !== me);
    if (them && other !== them) continue;
    const a = impliedProbability(entry.sides.get(me)), b = impliedProbability(entry.sides.get(other));
    if (a === null || b === null || a + b <= 0) continue;
    fair.push(a / (a + b));
    stale ||= entry.stale;
  }
  if (!fair.length) return null;
  const probability = fair.reduce((sum, value) => sum + value, 0) / fair.length;
  return { winProbability: Math.round(probability * 1000) / 10, books: fair.length, stale };
}

const memo = new Map();
let loggedCalls = 0;

/**
 * Win probabilities for up to MAX_MONEYLINE_EVENTS completed events. Requests
 * run three at a time; a failed or unreadable event is reported unavailable
 * and never stops the others.
 */
export async function fetchClosingWinProbabilities({ sport, player, events = [] } = {}, { get = proplineGet, now = Date.now } = {}) {
  const selected = text(sport).toUpperCase(), sportKey = proplineSportKey(selected);
  if (!MONEYLINE_SPORTS.has(selected) || !sportKey || !text(player)) {
    return { ok: true, available: false, code: 'MONEYLINE_UNSUPPORTED', message: 'Pre-match win probability is not available for this sport.', events: {} };
  }
  const queue = [];
  const seen = new Set();
  for (const event of list(events)) {
    const id = text(event?.id);
    if (!id || seen.has(id) || !/^[A-Za-z0-9:_-]{1,120}$/.test(id)) continue;
    seen.add(id);
    queue.push({ id, opponent: text(event?.opponent) || null });
    if (queue.length >= MAX_MONEYLINE_EVENTS) break;
  }
  const out = {};
  async function worker() {
    while (queue.length) {
      const { id, opponent } = queue.shift();
      const key = JSON.stringify([selected, id, nameKey(player), nameKey(opponent)]);
      const hit = memo.get(key);
      if (hit && hit.until > now()) { out[id] = hit.value; continue; }
      let value;
      try {
        const payload = await get(`/v1/sports/${sportKey}/events/${encodeURIComponent(id)}/odds/closing`, {}, { ttlSeconds: CLOSE_TTL_SECONDS, timeoutMs: 8000 });
        const reading = closingWinProbability(payload, player, opponent);
        value = reading ? { available: true, ...reading } : { available: false };
        memo.set(key, { value, until: now() + (reading ? CLOSE_TTL_SECONDS : 6 * 60 * 60) * 1000 });
        while (memo.size > 5000) memo.delete(memo.keys().next().value);
      } catch {
        // Quota reserve, cooldown or outage: unknown for now, retried later.
        value = { available: false, retryable: true };
      }
      out[id] = value;
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  const available = Object.values(out).some(row => row.available);
  // Counts only: confirms the live closing payload shape from the service logs.
  if (loggedCalls < 3) {
    loggedCalls += 1;
    const rows = Object.values(out);
    console.log('[closing-moneyline] coverage', JSON.stringify({ requested: rows.length, available: rows.filter(row => row.available).length, retryable: rows.filter(row => row.retryable).length }));
  }
  return { ok: true, available, sport: selected, events: out, ...(available ? {} : { message: 'Closing moneylines were not returned for these matches.' }) };
}

export function __resetClosingMoneyline() { memo.clear(); loggedCalls = 0; }
