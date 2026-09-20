// The analytical half of PropLine.
//
// The board only ever used /events and /events/{id}/odds. Everything that makes
// this a research product rather than a price list - movement, steam, best line,
// graded results, hit-rate trends, opening and closing numbers - sits behind
// endpoints nothing called. Several of them replace things this product either
// builds badly by scraping or does not have at all.
//
// Two rules shape this module:
//
//   * Everything is on demand, not polled. These are asked for when a customer
//     opens a prop, so the cost tracks use rather than inventory. They all go
//     through proplineGet, so the daily reserve still protects them.
//
//   * Nothing here is load bearing. Every reader returns null on failure rather
//     than throwing, because a missing trend line should leave the board intact,
//     not take a page down.
//
// Response shapes are read defensively. They come from PropLine's published
// contract rather than captured traffic, so each normaliser tolerates a field
// moving and reports what it could not read instead of assuming.
import { proplineGet } from './client.mjs';
import { proplineSportKey, bookKey, sideFromOutcome } from './markets.mjs';
import { impliedProbability } from './normalize.mjs';

const text = (value) => String(value ?? '').trim();
const list = (value) => (Array.isArray(value) ? value : []);
const num = (value) => {
  if (value == null || typeof value === 'boolean' || text(value) === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const iso = (value) => {
  const t = Date.parse(text(value));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

// How stale each answer may be. A trend only changes when a game finishes; a
// price moves constantly. Getting these wrong is what turns an on-demand call
// into an accidental poll.
export const TTL = Object.freeze({
  movement: 60,
  bestLine: 60,
  ev: 60,
  projections: 300,
  history: 300,
  context: 1_800,
  results: 3_600,
  closing: 3_600,
  trends: 3_600,
  games: 21_600,
});

async function read(path, params, ttlSeconds) {
  try {
    return await proplineGet(path, params, { ttlSeconds });
  } catch {
    // Enrichment must never break the thing it decorates.
    return null;
  }
}

function eventPath(sport, eventId, suffix = '') {
  const key = proplineSportKey(sport);
  const id = text(eventId);
  if (!key || !id) return null;
  return `/v1/sports/${key}/events/${encodeURIComponent(id)}${suffix}`;
}

function playerPath(sport, playerName, suffix) {
  const key = proplineSportKey(sport);
  const name = text(playerName);
  if (!key || !name) return null;
  return `/v1/sports/${key}/players/${encodeURIComponent(name)}${suffix}`;
}

/* ---------------------------------------------------------------- movement */

/**
 * Line movement and cross-book steam for one event.
 *
 * This is what the Movers view needs. It matters that it comes from PropLine's
 * own tick history rather than from local snapshots: the local line history has
 * been dead for most of a day more than once, and a movement view built on it
 * shows nothing when that happens.
 */
export function normalizeMovement(payload, { sport = null } = {}) {
  const rows = list(payload?.movements ?? payload?.data ?? payload);
  const moves = [];
  let unreadable = 0;
  for (const row of rows) {
    const playerName = text(row?.player_name ?? row?.description);
    const marketKey = text(row?.market ?? row?.market_key).toLowerCase();
    if (!playerName || !marketKey) { unreadable += 1; continue; }
    const openPoint = num(row?.opening_point ?? row?.open_point ?? row?.from_point);
    const nowPoint = num(row?.current_point ?? row?.point ?? row?.to_point);
    moves.push({
      sport,
      playerId: text(row?.player_id) || null,
      playerName,
      marketKey,
      side: sideFromOutcome(row) || (text(row?.side).toUpperCase() || null),
      bookmakerKey: bookKey(row?.bookmaker ?? row?.bookmaker_key) || null,
      openingPoint: openPoint,
      currentPoint: nowPoint,
      // The signed move is the number a reader actually scans for.
      pointDelta: openPoint !== null && nowPoint !== null ? Number((nowPoint - openPoint).toFixed(2)) : null,
      openingPrice: num(row?.opening_price),
      currentPrice: num(row?.current_price ?? row?.price_american ?? row?.price),
      steamScore: num(row?.steam_score),
      booksAgreeing: num(row?.books_agreeing ?? row?.book_count),
      lastChangeAt: iso(row?.last_change_at ?? row?.updated_at),
      outcomeId: text(row?.outcome_id) || null,
    });
  }
  // Biggest absolute move first: a line that fell two points is as interesting
  // as one that rose two, and steam breaks the tie.
  moves.sort((a, b) => Math.abs(b.pointDelta ?? 0) - Math.abs(a.pointDelta ?? 0) || (b.steamScore ?? 0) - (a.steamScore ?? 0));
  return { moves, unreadable };
}

export async function fetchMovement(sport, eventId, { markets = '' } = {}) {
  const path = eventPath(sport, eventId, '/movement');
  if (!path) return null;
  const payload = await read(path, markets ? { markets } : {}, TTL.movement);
  return payload ? normalizeMovement(payload, { sport }) : null;
}

/* --------------------------------------------------------------- best line */

/**
 * Which book pays most, per (market, player, line).
 *
 * The Best Lines view is currently a re-sort of the same board. This is the
 * measured answer to the same question.
 */
export function normalizeBestLine(payload) {
  const rows = list(payload?.best_lines ?? payload?.data ?? payload);
  const best = [];
  for (const row of rows) {
    const playerName = text(row?.player_name ?? row?.description);
    const marketKey = text(row?.market ?? row?.market_key).toLowerCase();
    if (!playerName || !marketKey) continue;
    const price = num(row?.price_american ?? row?.price);
    best.push({
      playerId: text(row?.player_id) || null,
      playerName,
      marketKey,
      side: sideFromOutcome(row) || (text(row?.side).toUpperCase() || null),
      line: num(row?.point ?? row?.line),
      price,
      impliedProbability: impliedProbability(price),
      bookmakerKey: bookKey(row?.bookmaker ?? row?.bookmaker_key) || null,
      booksCompared: num(row?.books_compared ?? row?.book_count),
      deeplink: text(row?.link) || null,
    });
  }
  return { best };
}

export async function fetchBestLine(sport, eventId) {
  const path = eventPath(sport, eventId, '/best-line');
  if (!path) return null;
  const payload = await read(path, {}, TTL.bestLine);
  return payload ? normalizeBestLine(payload) : null;
}

/* ---------------------------------------------------------- expected value */

/**
 * Cross-book +EV against a no-vig fair line.
 *
 * Deliberately carries the de-vig method through rather than presenting a bare
 * percentage: multiplicative and Shin disagree, and a reader betting on this
 * deserves to know which produced the number.
 */
export function normalizeEv(payload) {
  if (payload?.redacted === true) return { plays: [], redacted: true };
  const rows = [...list(payload?.plays ?? payload?.data ?? payload)];
  for (const line of list(payload?.lines)) {
    if (line?.redacted === true) continue;
    for (const outcome of list(line?.outcomes)) {
      if (outcome?.redacted === true || (num(outcome?.point) !== null && num(line?.point) !== null && num(outcome.point) !== num(line.point))) continue;
      const side = sideFromOutcome(outcome);
      rows.push({ ...line, ...outcome, player_name: line.player ?? line.player_name ?? line.description,
        player_id: line.player_id, market_key: line.market_key ?? line.market,
        bookmaker: outcome.book ?? outcome.bookmaker ?? outcome.bookmaker_key,
        ev_percent: outcome.ev_pct ?? outcome.ev_percent ?? outcome.ev,
        fair_probability: line.fair_probs?.[side === 'OVER' ? 'Over' : side === 'UNDER' ? 'Under' : ''],
      });
    }
  }
  const plays = [];
  for (const row of rows) {
    const playerName = text(row?.player_name ?? row?.description);
    if (!playerName || row?.redacted === true) continue;
    const edge = num(row?.ev_percent ?? row?.ev);
    plays.push({
      playerId: text(row?.player_id) || null,
      playerName,
      marketKey: text(row?.market ?? row?.market_key).toLowerCase() || null,
      side: sideFromOutcome(row) || (text(row?.side).toUpperCase() || null),
      line: num(row?.point ?? row?.line),
      price: num(row?.price_american ?? row?.price),
      bookmakerKey: bookKey(row?.bookmaker ?? row?.bookmaker_key) || null,
      evPercent: edge,
      fairPrice: num(row?.fair_price ?? row?.no_vig_price),
      fairProbability: num(row?.fair_probability ?? row?.no_vig_probability),
      devigMethod: text(row?.devig_method ?? row?.method).toLowerCase() || null,
      fairSource: text(row?.fair_source) || null,
      updatedAt: iso(row?.last_update ?? row?.updated_at),
      booksUsed: num(row?.books_used ?? row?.book_count),
    });
  }
  plays.sort((a, b) => (b.evPercent ?? -Infinity) - (a.evPercent ?? -Infinity));
  return { plays };
}

export async function fetchExpectedValue(sport, eventId, { markets = '', bookmakers = '' } = {}) {
  const path = eventPath(sport, eventId, '/ev');
  if (!path) return null;
  const payload = await read(path, { ...(markets ? { markets } : {}), ...(bookmakers ? { bookmakers } : {}) }, TTL.ev);
  return payload ? normalizeEv(payload) : null;
}

/* ------------------------------------------------------- history & closing */

/** Time-series of every odds change: what local line history was meant to be. */
export function normalizeHistory(payload) {
  const points = [];
  const add = (row, inherited = {}) => {
    const at = iso(row?.recorded_at ?? row?.timestamp ?? row?.at);
    const line = num(row?.point ?? row?.line);
    if (!at || line === null) return;
    points.push({
      at,
      line,
      price: num(row?.price_american ?? row?.price),
      liquidity: num(row?.liquidity),
      bookmakerKey: bookKey(row?.bookmaker ?? row?.bookmaker_key ?? inherited.bookmakerKey) || null,
      marketKey: text(row?.market ?? row?.market_key ?? inherited.marketKey).toLowerCase() || null,
      playerName: text(row?.player_name ?? row?.description ?? inherited.playerName) || null,
      side: sideFromOutcome(row) || inherited.side || (text(row?.side).toUpperCase() || null),
      outcomeId: text(row?.outcome_id ?? inherited.outcomeId) || null,
      bookOutcomeId: text(row?.book_outcome_id ?? inherited.bookOutcomeId) || null,
      dfsOddsType: text(row?.dfs_odds_type ?? inherited.dfsOddsType).toLowerCase() || null,
    });
  };

  // Older/flattened response shapes are still accepted.
  const direct = list(payload?.history ?? payload?.snapshots ?? payload?.data);
  if (direct.length && direct.some((row) => row?.recorded_at || row?.timestamp || row?.at)) {
    for (const row of direct) add(row);
  } else if (Array.isArray(payload)) {
    for (const row of payload) add(row);
  }

  // Current documented shape is bookmaker -> market -> outcome -> snapshots.
  for (const bookmaker of list(payload?.bookmakers)) {
    const bookmakerKey = bookKey(bookmaker?.key ?? bookmaker?.bookmaker) || null;
    for (const market of list(bookmaker?.markets)) {
      const marketKey = text(market?.key ?? market?.market_key).toLowerCase() || null;
      for (const outcome of list(market?.outcomes)) {
        const inherited = {
          bookmakerKey,
          marketKey,
          playerName: text(outcome?.description ?? outcome?.player_name) || null,
          side: sideFromOutcome(outcome) || (text(outcome?.side).toUpperCase() || null),
          outcomeId: text(outcome?.outcome_id) || null,
          bookOutcomeId: text(outcome?.book_outcome_id) || null,
          dfsOddsType: text(outcome?.dfs_odds_type).toLowerCase() || null,
        };
        for (const snapshot of list(outcome?.snapshots)) add(snapshot, inherited);
      }
    }
  }

  points.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { points, redacted: payload?.redacted === true };
}

export async function fetchOddsHistory(sport, eventId, { markets = '' } = {}) {
  const path = eventPath(sport, eventId, '/odds/history');
  if (!path) return null;
  const payload = await read(path, markets ? { markets } : {}, TTL.history);
  return payload ? normalizeHistory(payload) : null;
}

/** Opening and closing numbers per outcome, which is what CLV is measured against. */
export function normalizeClosing(payload) {
  const rows = list(payload?.closing ?? payload?.data ?? payload);
  const closes = [];
  for (const row of rows) {
    const playerName = text(row?.player_name ?? row?.description);
    if (!playerName) continue;
    closes.push({
      playerId: text(row?.player_id) || null,
      playerName,
      marketKey: text(row?.market ?? row?.market_key).toLowerCase() || null,
      side: sideFromOutcome(row) || (text(row?.side).toUpperCase() || null),
      bookmakerKey: bookKey(row?.bookmaker ?? row?.bookmaker_key) || null,
      openingLine: num(row?.opening_point),
      openingPrice: num(row?.opening_price),
      openingAt: iso(row?.opening_at),
      closingLine: num(row?.closing_point),
      closingPrice: num(row?.closing_price),
      closingAt: iso(row?.closing_at),
      // PropLine flags a close captured more than ten minutes before kickoff.
      // Presenting that as a true close would quietly corrupt any CLV built on it.
      stale: row?.is_stale === true,
    });
  }
  return { closes };
}

export async function fetchClosingLines(sport, eventId) {
  const path = eventPath(sport, eventId, '/odds/closing');
  if (!path) return null;
  const payload = await read(path, {}, TTL.closing);
  return payload ? normalizeClosing(payload) : null;
}

/* ------------------------------------------------------ results & players */

/** Each prop graded against the actual box score. */
export function normalizeResults(payload) {
  const rows = list(payload?.results ?? payload?.data ?? payload);
  const results = [];
  for (const row of rows) {
    const playerName = text(row?.player_name ?? row?.description);
    const resolution = text(row?.resolution).toLowerCase();
    if (!playerName || !resolution) continue;
    results.push({
      playerId: text(row?.player_id) || null,
      playerName,
      marketKey: text(row?.market ?? row?.market_key).toLowerCase() || null,
      side: sideFromOutcome(row) || (text(row?.side).toUpperCase() || null),
      line: num(row?.point ?? row?.line),
      resolution,
      actualValue: num(row?.actual_value),
      resolvedAt: iso(row?.resolved_at),
    });
  }
  return { results };
}

export async function fetchResults(sport, eventId) {
  const path = eventPath(sport, eventId, '/results');
  if (!path) return null;
  const payload = await read(path, {}, TTL.results);
  return payload ? normalizeResults(payload) : null;
}

/**
 * Hit-rate trends over the last 5/10/20/50 graded games.
 *
 * This product scrapes ESPN for the same thing. These are graded against
 * official box scores by the provider, which is both more reliable and the
 * reason the scraping path can eventually stop being load bearing.
 */
export function normalizeTrends(payload) {
  const source = payload?.trends ?? payload ?? {};
  // The real shape is one row per market, with snake_case windows - not the flat
  // {l5, l10} object this first assumed. Verified against a live response.
  const rows = list(source?.markets);
  const markets = [];
  let redacted = false;

  const window = (value) => {
    if (value === null || value === undefined) return null;
    // A window may be the rate itself, or a breakdown. Both are accepted.
    if (typeof value === 'number') return { hitRate: value > 1 ? value / 100 : value, over: null, under: null, push: null, games: null };
    if (typeof value !== 'object') return null;
    const games = num(value.games ?? value.sample ?? value.graded);
    const over = num(value.over ?? value.overs ?? value.hits);
    const rate = num(value.hit_rate ?? value.rate ?? value.percent);
    return {
      games,
      over,
      under: num(value.under ?? value.unders),
      push: num(value.push ?? value.pushes),
      // Never a rate without the sample behind it.
      hitRate: rate !== null ? (rate > 1 ? rate / 100 : rate) : games && over !== null ? Number((over / games).toFixed(4)) : null,
    };
  };

  for (const row of rows) {
    const marketKey = text(row?.market).toLowerCase();
    if (!marketKey) continue;
    if (row?.redacted === true) redacted = true;
    markets.push({
      marketKey,
      gamesGraded: num(row?.games_graded),
      referenceBook: bookKey(row?.reference_bookmaker) || null,
      recentLine: num(row?.recent_line),
      avgActual: num(row?.avg_actual),
      currentStreak: num(row?.current_streak),
      redacted: row?.redacted === true,
      windows: {
        l5: window(row?.last_5),
        l10: window(row?.last_10),
        l20: window(row?.last_20),
        l50: window(row?.last_50),
      },
    });
  }

  return {
    playerName: text(source?.player_name) || null,
    markets,
    // Free keys return every window null with redacted true. Saying so lets a
    // caller distinguish "no data" from "not entitled to this data".
    redacted,
  };
}

/** The trend row for one market, which is what a prop actually needs. */
export function trendsForMarket(trends, marketKey) {
  const key = text(marketKey).toLowerCase();
  if (!key) return null;
  return list(trends?.markets).find((row) => row.marketKey === key) || null;
}

export async function fetchPlayerTrends(sport, playerName) {
  const path = playerPath(sport, playerName, '/trends');
  if (!path) return null;
  const payload = await read(path, {}, TTL.trends);
  return payload ? normalizeTrends(payload) : null;
}

export async function fetchPlayerGames(sport, playerName) {
  const path = playerPath(sport, playerName, '/games');
  if (!path) return null;
  const payload = await read(path, {}, TTL.games);
  if (!payload) return null;
  // Verified against a live response: the date is commence_time, and stats
  // already carry the combination markets (points_rebounds and the rest) that
  // the scraped path has to compute for itself.
  const games = list(payload?.games).map((row) => ({
    eventId: text(row?.event_id) || null,
    date: iso(row?.commence_time ?? row?.game_date ?? row?.date),
    status: text(row?.status).toLowerCase() || null,
    opponent: text(row?.opponent) || null,
    team: text(row?.player_team ?? row?.team_abbr) || null,
    teamAbbr: text(row?.team_abbr) || null,
    isHome: row?.is_home === true,
    homeTeam: text(row?.home_team) || null,
    awayTeam: text(row?.away_team) || null,
    homeScore: num(row?.home_score),
    awayScore: num(row?.away_score),
    stats: row?.stats && typeof row.stats === 'object' ? row.stats : {},
  })).filter((row) => row.date);
  games.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  return { playerName: text(payload?.player_name) || null, games };
}

/**
 * The value a market resolves to for one game.
 *
 * PropLine names combination markets the same way its prop markets are named,
 * so player_points_rebounds reads straight out of the stats block rather than
 * being recomputed - which is where a scraped path gets combinations wrong.
 */
export function statForMarket(game, marketKey) {
  const stats = game?.stats;
  if (!stats || typeof stats !== 'object') return null;
  const key = text(marketKey).toLowerCase().replace(/^player_/, '').replace(/^batter_/, '').replace(/^pitcher_/, '');
  if (key && stats[key] !== undefined) return num(stats[key]);
  return null;
}

/* --------------------------------------------------- context & projections */

/** Conditions that change how a prop should be read: weather, pitchers, umpires. */
export async function fetchEventContext(sport, eventId) {
  const path = eventPath(sport, eventId, '/context');
  if (!path) return null;
  const payload = await read(path, {}, TTL.context);
  if (!payload) return null;
  const source = payload?.context ?? payload ?? {};
  return {
    weather: source?.weather && typeof source.weather === 'object' ? source.weather : null,
    probablePitchers: list(source?.probable_pitchers),
    umpires: list(source?.umpires),
    venue: text(source?.venue) || null,
    roof: text(source?.roof) || null,
  };
}

/** Market-implied projections: where no-vig probability crosses 50%. */
export function normalizeProjections(payload) {
  if (payload?.redacted === true) return { projections: [], redacted: true };
  const projections = list(payload?.projections ?? payload?.data ?? payload).filter(row => row?.redacted !== true).map((row) => ({
    playerId: text(row?.player_id) || null,
    playerName: text(row?.player ?? row?.player_name ?? row?.description) || null,
    marketKey: text(row?.market_key ?? row?.market).toLowerCase() || null,
    projection: num(row?.projected_value ?? row?.projection ?? row?.implied_value),
    consensusOverProbability: num(row?.consensus_over_prob),
    booksContributing: num(row?.books_contributing),
    updatedAt: iso(row?.last_update),
    basis: 'market-implied',
  })).filter((row) => row.playerName && row.marketKey && row.projection !== null);
  return { projections };
}
export async function fetchProjections(sport, eventId, { markets = '' } = {}) {
  const path = eventPath(sport, eventId, '/projections');
  if (!path) return null;
  const payload = await read(path, markets ? { markets } : {}, TTL.projections);
  return payload ? normalizeProjections(payload) : null;
}
