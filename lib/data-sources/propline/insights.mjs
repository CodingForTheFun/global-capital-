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
  const rows = list(payload?.plays ?? payload?.data ?? payload);
  const plays = [];
  for (const row of rows) {
    const playerName = text(row?.player_name ?? row?.description);
    if (!playerName) continue;
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
  const rows = list(payload?.history ?? payload?.snapshots ?? payload?.data ?? payload);
  const points = [];
  for (const row of rows) {
    const at = iso(row?.recorded_at ?? row?.timestamp ?? row?.at);
    const line = num(row?.point ?? row?.line);
    if (!at || line === null) continue;
    points.push({
      at,
      line,
      price: num(row?.price_american ?? row?.price),
      bookmakerKey: bookKey(row?.bookmaker ?? row?.bookmaker_key) || null,
      side: sideFromOutcome(row) || (text(row?.side).toUpperCase() || null),
    });
  }
  points.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { points };
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
  const source = payload?.trends ?? payload?.data ?? payload ?? {};
  const windows = {};
  for (const [key, value] of Object.entries(source && typeof source === 'object' ? source : {})) {
    const match = /^l(\d+)$/i.exec(text(key));
    if (!match || !value || typeof value !== 'object') continue;
    const games = num(value.games ?? value.sample);
    const overs = num(value.over ?? value.overs ?? value.hits);
    const rate = num(value.hit_rate ?? value.rate);
    windows[`l${match[1]}`] = {
      games,
      over: overs,
      under: num(value.under ?? value.unders),
      push: num(value.push ?? value.pushes),
      // A rate is only meaningful with its sample beside it.
      hitRate: rate !== null ? rate : games && overs !== null ? Number((overs / games).toFixed(4)) : null,
    };
  }
  return { windows, playerName: text(source?.player_name) || null };
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
  const games = list(payload?.games ?? payload?.data ?? payload).map((row) => ({
    gameId: text(row?.game_id) || null,
    date: iso(row?.game_date ?? row?.date),
    opponent: text(row?.opponent) || null,
    stats: row?.stats && typeof row.stats === 'object' ? row.stats : {},
  })).filter((row) => row.date);
  games.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  return { games };
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
export async function fetchProjections(sport, eventId, { markets = '' } = {}) {
  const path = eventPath(sport, eventId, '/projections');
  if (!path) return null;
  const payload = await read(path, markets ? { markets } : {}, TTL.projections);
  if (!payload) return null;
  const projections = list(payload?.projections ?? payload?.data ?? payload).map((row) => ({
    playerId: text(row?.player_id) || null,
    playerName: text(row?.player_name ?? row?.description) || null,
    marketKey: text(row?.market ?? row?.market_key).toLowerCase() || null,
    projection: num(row?.projection ?? row?.implied_value),
    // Market-implied, not modelled. Labelling it honestly is the difference
    // between a reference number and a claim this product cannot support.
    basis: 'market-implied',
  })).filter((row) => row.playerName && row.projection !== null);
  return { projections };
}
