// Opening line, current line and steam for the props on the board.
//
// Contract: PropLine /v1/sports/{sport}/events/{id}/movement (v1.2.0). Per
// (book, market, outcome) it reports the opening and latest point/price; the
// steam[] array flags outcomes several books moved the same way. This module
// only summarises what PropLine returns: the consensus (median across books)
// opening and latest line per player market, and the strongest steam entry.
// Nothing is inferred when a book, side or player is missing.
import { proplineGet } from './client.mjs';
import { proplineSportKey } from './markets.mjs';

const text = value => String(value ?? '').trim();
const list = value => (Array.isArray(value) ? value : []);
const nameKey = value => text(value).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
const num = value => {
  if (value == null || typeof value === 'boolean' || text(value) === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const median = values => {
  const clean = values.filter(v => v !== null).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
};

export const MAX_MOVEMENT_EVENTS = 12;
const TTL_SECONDS = 60;

/** Key the board uses to look up one player market in one event. */
export const movementKey = (market, player) => `${text(market).toLowerCase()}|${nameKey(player)}`;

/**
 * Summarise one movement payload into { [market|player]: { over, under, steam } }.
 * over/under carry the median opening and latest point across books that
 * quoted both ends, plus how many books that was.
 */
export function summarizeMovement(payload) {
  if (!payload || payload.redacted === true) return null;
  const buckets = new Map();
  for (const book of list(payload.bookmakers)) {
    for (const market of list(book?.markets)) {
      const period = text(market?.period).toLowerCase();
      if (period && !['full', 'full_game', 'game', 'match'].includes(period)) continue;
      for (const outcome of list(market?.outcomes)) {
        const side = text(outcome?.name).toUpperCase();
        const player = text(outcome?.description || market?.description);
        if (!player || (side !== 'OVER' && side !== 'UNDER')) continue;
        const open = num(outcome?.open_point), latest = num(outcome?.latest_point);
        if (open === null || latest === null) continue;
        const key = movementKey(market?.key, player);
        const entry = buckets.get(key) || { OVER: [], UNDER: [] };
        entry[side].push({ open, latest, openAt: text(outcome?.open_at) || null });
        buckets.set(key, entry);
      }
    }
  }
  const out = Object.create(null);
  for (const [key, entry] of buckets) {
    const sideSummary = rows => rows.length ? {
      open: median(rows.map(r => r.open)),
      latest: median(rows.map(r => r.latest)),
      books: rows.length,
    } : null;
    out[key] = { over: sideSummary(entry.OVER), under: sideSummary(entry.UNDER), steam: null };
  }
  for (const steam of list(payload.steam)) {
    const period = text(steam?.period).toLowerCase();
    if (period && !['full', 'full_game', 'game', 'match'].includes(period)) continue;
    const player = text(steam?.description);
    const score = num(steam?.steam_score), moved = num(steam?.books_moved), quoting = num(steam?.books_quoting);
    const direction = text(steam?.consensus_direction).toLowerCase();
    if (!player || score === null || moved === null || !direction) continue;
    const key = movementKey(steam?.market, player);
    const row = out[key] || (out[key] = { over: null, under: null, steam: null });
    if (!row.steam || score > row.steam.score) {
      row.steam = { score, direction, booksMoved: moved, booksQuoting: quoting, side: text(steam?.name).toUpperCase() || null };
    }
  }
  return out;
}

/**
 * Movement for up to MAX_MOVEMENT_EVENTS events of one sport. Requests run
 * three at a time through the shared PropLine client (cache, cooldown and
 * quota reserve apply); a failed event is reported unavailable and never
 * stops the others.
 */
export async function fetchPropMovement({ sport, eventIds = [] } = {}, { get = proplineGet } = {}) {
  const sportKey = proplineSportKey(sport);
  if (!sportKey) return { ok: true, available: false, code: 'MOVEMENT_UNSUPPORTED', message: 'Line movement is not available for this sport.', events: {} };
  const queue = [...new Set(list(eventIds).map(text).filter(id => /^\d{1,18}$/.test(id)))].slice(0, MAX_MOVEMENT_EVENTS);
  const events = {};
  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      try {
        const payload = await get(`/v1/sports/${sportKey}/events/${id}/movement`, {}, { ttlSeconds: TTL_SECONDS, timeoutMs: 8000 });
        const summary = summarizeMovement(payload);
        events[id] = summary ? { available: true, markets: summary } : { available: false };
      } catch {
        events[id] = { available: false, retryable: true };
      }
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  const available = Object.values(events).some(row => row.available);
  return { ok: true, available, sport: text(sport).toUpperCase(), events };
}
