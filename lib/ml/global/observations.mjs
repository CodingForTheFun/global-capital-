// Resolved-props export rows -> one compact observation per player market per game.
//
// Source: PropLine /v1/exports/resolved-props (CSV). One export row is one
// (event, market, bookmaker, outcome). An observation keeps what a pregame
// model could have known (the opening and closing consensus no-vig
// probability, each at the point the books agreed on most) and what happened
// (actual_value). Nothing is inferred: a side without its opposite at the
// same book and point contributes no price, and conflicting actual values drop
// the whole observation.

const text = value => String(value ?? '').trim();
const num = value => {
  if (value === null || value === undefined || typeof value === 'boolean' || text(value) === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Pick'em platforms: their prices are multi-leg payouts, never a straight market. */
export const DFS_BOOKS = Object.freeze(new Set([
  'prizepicks', 'underdog', 'underdogfantasy', 'sleeper', 'parlayplay', 'betrpicks', 'betr', 'dabble', 'chalkboard', 'boom', 'owners_box', 'ownersbox',
]));

export const REQUIRED_COLUMNS = Object.freeze([
  'event_id', 'sport_key', 'commence_time', 'market', 'bookmaker', 'player_name', 'outcome_name', 'line',
  'resolution', 'actual_value', 'closing_price', 'closing_point', 'opening_price', 'opening_point',
]);

export const nameKey = value => text(value).normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[.'’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function implied(american) {
  const price = num(american);
  if (price === null || Math.abs(price) < 100) return null;
  return price > 0 ? 100 / (price + 100) : -price / (-price + 100);
}

const median = values => {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
};

/**
 * Consensus over-probability from { "book|point": { OVER: price, UNDER: price } }.
 * Uses the point the most books quoted on both sides; ties go to the lower
 * point so the choice is deterministic.
 */
function consensus(pairs) {
  const byPoint = new Map();
  for (const [key, sides] of pairs) {
    if (sides.OVER === undefined || sides.UNDER === undefined) continue;
    const over = implied(sides.OVER), under = implied(sides.UNDER);
    if (over === null || under === null || !(over + under > 0)) continue;
    const point = Number(key.slice(key.lastIndexOf('|') + 1));
    const list = byPoint.get(point) || [];
    list.push(over / (over + under));
    byPoint.set(point, list);
  }
  let best = null;
  for (const [point, list] of byPoint) {
    if (!best || list.length > best.list.length || (list.length === best.list.length && point < best.point)) best = { point, list };
  }
  return best ? { point: best.point, p: median(best.list), books: best.list.length } : null;
}

/**
 * Streaming reducer. add(row) takes one parsed CSV row; finish() returns the
 * observations. `maxGroups` bounds memory: past it, add() reports overflow and
 * the caller retries the window in smaller pieces.
 */
export function createObservationReducer({ sportKey, maxGroups = 250_000 } = {}) {
  const groups = new Map();
  let rows = 0, skipped = 0, overflow = false;

  function add(row) {
    rows += 1;
    if (overflow) return false;
    if (sportKey && text(row.sport_key) !== sportKey) { skipped += 1; return true; }
    const side = text(row.outcome_name).toUpperCase();
    const player = text(row.player_name);
    const market = text(row.market).toLowerCase();
    const resolution = text(row.resolution).toLowerCase();
    const actual = num(row.actual_value);
    const commence = Date.parse(text(row.commence_time));
    if ((side !== 'OVER' && side !== 'UNDER') || !player || !market || !text(row.event_id)
      || !['won', 'lost', 'push'].includes(resolution) || actual === null || !Number.isFinite(commence)) { skipped += 1; return true; }

    const key = `${text(row.event_id)}|${nameKey(player)}|${market}`;
    let group = groups.get(key);
    if (!group) {
      if (groups.size >= maxGroups) { overflow = true; return false; }
      group = { e: text(row.event_id), t: commence, p: player, m: market, a: actual, bad: false, close: new Map(), open: new Map(), dfs: new Map() };
      groups.set(key, group);
    } else if (Math.abs(group.a - actual) > 1e-9) {
      group.bad = true;
    }

    const book = text(row.bookmaker).toLowerCase();
    if (!book) return true;
    if (DFS_BOOKS.has(book)) {
      // Standard pick'em lines are the line a pick'em player takes; goblin and
      // demon tiers are deliberately shifted and do not describe the market.
      const tier = text(row.dfs_odds_type).toLowerCase();
      const line = num(row.line);
      if (line !== null && (!tier || tier === 'standard')) group.dfs.set(line, (group.dfs.get(line) || 0) + 1);
      return true;
    }
    for (const [stage, pointCol, priceCol] of [['close', 'closing_point', 'closing_price'], ['open', 'opening_point', 'opening_price']]) {
      const point = num(row[pointCol]), price = num(row[priceCol]);
      if (point === null || price === null) continue;
      const pairKey = `${book}|${point}`;
      const sides = group[stage].get(pairKey) || {};
      sides[side] = price;
      group[stage].set(pairKey, sides);
    }
    return true;
  }

  function finish() {
    const out = [];
    for (const group of groups.values()) {
      if (group.bad) continue;
      const close = consensus(group.close), open = consensus(group.open);
      let dfsLine = null, dfsCount = 0;
      for (const [line, count] of group.dfs) if (count > dfsCount || (count === dfsCount && line < dfsLine)) { dfsLine = line; dfsCount = count; }
      out.push({
        e: group.e, t: group.t, p: group.p, m: group.m, a: group.a,
        cp: close?.point ?? null, cq: close?.p ?? null, cn: close?.books ?? 0,
        op: open?.point ?? null, oq: open?.p ?? null, on: open?.books ?? 0,
        dl: dfsLine,
      });
    }
    out.sort((a, b) => a.t - b.t || a.e.localeCompare(b.e));
    return out;
  }

  return { add, finish, stats: () => ({ rows, skipped, groups: groups.size, overflow }) };
}

/** Stable identity for de-duplicating observations across overlapping windows. */
export const observationKey = obs => `${obs.e}|${nameKey(obs.p)}|${obs.m}`;
