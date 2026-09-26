// Global per-sport prop model: features, logistic fit, chronological
// evaluation against the market, and the promotion gate.
//
// The market's own no-vig probability is the strongest single predictor of a
// prop, so it is a feature, not a competitor to beat by pretending it is not
// there. Player history (recent and season form against the line, hit rate at
// the line) is the other half; rows with no two-sided market (pick'em-only
// props) are fitted in the same model through indicator terms, so each regime
// is judged on its own held-out rows.
import { nameKey } from './observations.mjs';

const finite = v => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const logit = p => Math.log(p / (1 - p));
const sigmoid = z => 1 / (1 + Math.exp(-clamp(z, -30, 30)));
const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
const sd = a => {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};

// v2 appends game context after the v1 columns, so a v1 champion or artifact
// is still scored on its own first eight columns.
export const FEATURES = Object.freeze(['bias', 'market', 'hasMarket', 'form10', 'form5', 'formSeason', 'hitRate10', 'depth',
  'hasContext', 'home', 'rest', 'backToBack', 'oppAllow', 'oppPointsAllowed', 'teamPoints',
  // MLB batters: form against the opposing starter's hand, and lineup spot.
  'vsHand', 'battingSpot']);
export const MODEL_VERSION = 'global-logit-v3';
/** A game is usable history only if it started at least this long before the target. */
const HISTORY_GAP_MS = 3 * 3600_000;
/** Fewer prior games than this and the form features stay at zero. */
export const MIN_HISTORY = 3;

export const PROMOTION_POLICY = Object.freeze({
  minHoldout: 400,
  /** Distinct games in the holdout, and in each regime a model is released for. */
  minHoldoutEvents: 20,
  holdoutFraction: 0.2,
  /**
   * With a market, the model may not be worse than the market alone: the 90%
   * upper bound of its Brier difference, resampling whole games, must stay
   * within this. Without a market it must beat the smoothed hit rate and a coin
   * flip with the same confidence (upper bound at or below zero).
   */
  maxMarketBrierExcess: 0.0005,
  evidenceQuantile: 0.9,
  evidenceDraws: 500,
  /**
   * Calibration fails when the measured error is above this AND above what
   * random outcomes alone produce for these exact predictions 95% of the time;
   * a small holdout cannot prove miscalibration it cannot distinguish from noise.
   */
  maxCalibrationError: 0.04,
  calibrationDraws: 200,
  /** A challenger replaces the champion only if it is not worse on the same rows. */
  maxChampionBrierExcess: 0.0005,
});

/**
 * Feature vector for one prop at `line`, from the player's prior results in
 * this market (oldest first) and the consensus no-vig over probability at this
 * exact line when a two-sided market exists.
 */
export function featureVector({ history = [], line, marketP = null, context = null }) {
  const x = new Array(FEATURES.length).fill(0);
  x[0] = 1;
  if (finite(marketP) && marketP > 0.01 && marketP < 0.99) { x[1] = logit(marketP); x[2] = 1; }
  const values = history.filter(finite);
  if (finite(line) && values.length >= MIN_HISTORY) {
    const last20 = values.slice(-20), last10 = values.slice(-10), last5 = values.slice(-5);
    const scale = Math.max(sd(last20) ?? 0, 0.5, Math.abs(line) * 0.15);
    x[3] = clamp((mean(last10) - line) / scale, -4, 4);
    x[4] = clamp((mean(last5) - line) / scale, -4, 4);
    x[5] = clamp((mean(values) - line) / scale, -4, 4);
    const hits = last10.filter(v => v > line).length, decided = last10.filter(v => v !== line).length;
    x[6] = (hits + 1) / (decided + 2) - 0.5;
    x[7] = Math.min(values.length, 30) / 30;
  }
  if (context) {
    if (finite(context.restDays)) {
      x[10] = Math.min(context.restDays, 10) / 10;
      x[11] = context.restDays < 1.5 ? 1 : 0;
    }
    if (context.team) {
      x[8] = 1;
      x[9] = context.home ? 1 : -1;
      if (finite(context.oppAllow)) x[12] = clamp(context.oppAllow, -0.5, 0.5);
      if (finite(context.oppPointsAllowed)) x[13] = clamp(context.oppPointsAllowed, -3, 3);
      if (finite(context.teamPoints)) x[14] = clamp(context.teamPoints, -3, 3);
    }
    if (finite(context.vsHand)) x[15] = clamp(context.vsHand, -0.5, 0.5);
    if (finite(context.battingSpot)) x[16] = clamp(context.battingSpot, -1, 1);
  }
  return x;
}

/** A model's probability from its own weights: older artifacts use the leading columns. */
export const predictWith = (weights, x) => predictRow(weights, x.slice(0, weights.length));

const OPP_WINDOW_MS = 60 * 86_400_000;
const OPP_MIN_PROPS = 5;
const TEAM_GAMES = 10;

/**
 * Point-in-time game context, built by releasing resolved games in time
 * order. Nothing about a game is known to the index until it is released, and
 * callers release only games that began at least HISTORY_GAP_MS before the
 * prop they are describing.
 *   - A player's team is the one team in both this game and their previous
 *     game; unknown with no previous game or when it changed (a trade).
 *   - Opponent allowance: the share of this market's props that went over
 *     against the opponent in the last 60 days, smoothed, minus one half.
 *   - Scoring: the opponent's points allowed and the team's points scored over
 *     their last 10 games, as z-scores within the sport.
 */
export function createContextIndex({ enrich = null } = {}) {
  const events = new Set();
  const batterHand = new Map(); // player|market -> [{ t, hand, over }] (MLB box-score facts)
  const spots = new Map();      // player -> [{ e, spot }]
  const factsOf = (e) => (enrich && enrich[e] && enrich[e].f) || null;
  const teamGames = new Map();   // team -> [{ t, for, against }]
  const lastGames = new Map();   // player -> their last two distinct games [{ t, e, teams }], newest last
  const oppMarket = new Map();   // opponent|market -> [{ t, over }]
  let n = 0, sum = 0, sumSq = 0; // every released team-game score in the sport

  const teamsOf = (obs) => (obs.h && obs.v ? [nameKey(obs.h), nameKey(obs.v)] : null);
  // The player's latest game before this one (another event, earlier start).
  function previous(player, e, t) {
    const list = lastGames.get(player) || [];
    for (let i = list.length - 1; i >= 0; i--) if (list[i].e !== e && list[i].t < t) return list[i];
    return null;
  }
  function inferTeam(player, teams, e, t) {
    const prev = previous(player, e, t);
    if (!prev || !teams) return null;
    const both = teams.filter((team) => prev.teams.includes(team));
    return both.length === 1 ? both[0] : null;
  }
  const z = (value) => {
    if (n < 30 || !finite(value)) return null;
    const m = sum / n, s = Math.sqrt(Math.max(sumSq / n - m * m, 1e-9));
    return (value - m) / s;
  };
  const recentMean = (team, key) => {
    const list = teamGames.get(team);
    if (!list || list.length < 3) return null;
    return mean(list.slice(-TEAM_GAMES).map((g) => g[key]));
  };

  /** Make one resolved game known. Call in time order. */
  function release(obs) {
    const teams = teamsOf(obs);
    const player = nameKey(obs.p);
    if (teams && !events.has(obs.e)) {
      events.add(obs.e);
      if (finite(obs.hs) && finite(obs.vs)) {
        for (const [team, own, other] of [[teams[0], obs.hs, obs.vs], [teams[1], obs.vs, obs.hs]]) {
          const list = teamGames.get(team) || [];
          list.push({ t: obs.t, for: own, against: other });
          if (list.length > TEAM_GAMES * 2) list.shift();
          teamGames.set(team, list);
          n += 1; sum += own; sumSq += own * own;
        }
      }
    }
    const line = finite(obs.cp) ? obs.cp : finite(obs.dl) ? obs.dl : null;
    const team = inferTeam(player, teams, obs.e, obs.t);
    if (team && line !== null && obs.a !== line) {
      const opponent = teams.find((t) => t !== team);
      const key = `${opponent}|${obs.m}`;
      const list = oppMarket.get(key) || [];
      list.push({ t: obs.t, over: obs.a > line ? 1 : 0 });
      while (list.length && list[0].t < obs.t - OPP_WINDOW_MS) list.shift();
      oppMarket.set(key, list);
    }
    // MLB: the batter's box-score line for this game gives his team outright,
    // the opposing starter's hand and his lineup spot.
    const facts = factsOf(obs.e);
    const batter = facts?.lineup?.[player];
    if (batter && teams) {
      const opponent = teams.find((t) => t !== batter.team);
      const thrown = facts.starters?.[opponent];
      if (thrown && line !== null && obs.a !== line) {
        const key = `${player}|${obs.m}`;
        const rows = batterHand.get(key) || [];
        rows.push({ t: obs.t, hand: thrown, over: obs.a > line ? 1 : 0 });
        if (rows.length > 80) rows.shift();
        batterHand.set(key, rows);
      }
      const seen = spots.get(player) || [];
      if (!seen.some((s) => s.e === obs.e)) {
        seen.push({ e: obs.e, spot: batter.spot });
        if (seen.length > 10) seen.shift();
        spots.set(player, seen);
      }
    }
    const list = lastGames.get(player) || [];
    if (teams && !list.some((g) => g.e === obs.e)) {
      list.push({ t: obs.t, e: obs.e, teams });
      list.sort((a, b) => a.t - b.t);
      if (list.length > 2) list.shift();
      lastGames.set(player, list);
    }
  }

  /** Context for a prop in a game starting at t, from released games only. */
  function describe({ playerName, homeTeam, awayTeam, market, t, e = null, opposingHand = null }) {
    const player = nameKey(playerName);
    // Lineup spot from his last five games (today's may not be posted), and
    // his over-rate against today's starter's hand minus his overall rate.
    const recentSpots = (spots.get(player) || []).filter((s) => s.e !== e).slice(-5).map((s) => s.spot);
    const battingSpot = recentSpots.length >= 3 ? (5 - mean(recentSpots)) / 4 : null;
    const handRows = batterHand.get(`${player}|${String(market || '').toLowerCase()}`) || [];
    const same = opposingHand ? handRows.filter((r) => r.hand === opposingHand) : [];
    const rate = (rows) => (rows.reduce((s, r) => s + r.over, 0) + 1) / (rows.length + 2);
    const vsHand = same.length >= 5 && handRows.length >= 10 ? rate(same) - rate(handRows) : null;
    const prev = previous(player, e, t);
    const restDays = prev ? (t - prev.t) / 86_400_000 : null;
    const teams = homeTeam && awayTeam ? [nameKey(homeTeam), nameKey(awayTeam)] : null;
    const team = inferTeam(player, teams, e, t);
    if (!team) return { team: null, restDays, vsHand, battingSpot };
    const opponent = teams.find((x) => x !== team);
    const recent = (oppMarket.get(`${opponent}|${String(market || '').toLowerCase()}`) || []).filter((r) => r.t >= t - OPP_WINDOW_MS);
    const overs = recent.reduce((s, r) => s + r.over, 0);
    return {
      team,
      home: team === teams[0],
      restDays,
      oppAllow: recent.length >= OPP_MIN_PROPS ? (overs + 1) / (recent.length + 2) - 0.5 : null,
      oppPointsAllowed: z(recentMean(opponent, 'against')),
      teamPoints: z(recentMean(team, 'for')),
      vsHand,
      battingSpot,
    };
  }

  return { release, describe };
}

/**
 * Chronological training rows. Each row's history is only games that began
 * before it (with a gap), so no row ever sees its own or a later result.
 * The target line is the market's consensus point, or the standard pick'em
 * line when no two-sided market existed. Pushes are excluded from the fit.
 */
export function buildRows(observations, { enrich = null } = {}) {
  const sorted = [...observations].sort((a, b) => a.t - b.t);
  const past = new Map();
  const context = createContextIndex({ enrich });
  const rows = [];
  let cursor = 0;
  for (const obs of sorted) {
    // Release earlier games into history only once they are old enough.
    while (cursor < sorted.length && sorted[cursor].t <= obs.t - HISTORY_GAP_MS) {
      const prior = sorted[cursor++];
      context.release(prior);
      const key = `${nameKey(prior.p)}|${prior.m}`;
      const list = past.get(key) || [];
      list.push(prior.a);
      if (list.length > 60) list.shift();
      past.set(key, list);
    }
    const line = finite(obs.cp) ? obs.cp : finite(obs.dl) ? obs.dl : null;
    if (line === null || obs.a === line) continue;
    const history = past.get(`${nameKey(obs.p)}|${obs.m}`) || [];
    // The closing consensus is the market feature and the benchmark. At
    // serving time the model sees the current market, which is earlier and
    // noisier than the close, so "no worse than the market" is proven against
    // the hardest version of the market, not the one a customer sees.
    const marketP = finite(obs.cp) && finite(obs.cq) ? obs.cq : null;
    // The target game's starter is known before it (the probable), so its hand
    // is read from that game's facts; nothing else from the game is used.
    const facts = enrich?.[obs.e]?.f;
    const batter = facts?.lineup?.[nameKey(obs.p)];
    const opposingHand = batter && obs.h && obs.v ? facts.starters?.[[nameKey(obs.h), nameKey(obs.v)].find((t) => t !== batter.team)] || null : null;
    const ctx = context.describe({ playerName: obs.p, homeTeam: obs.h, awayTeam: obs.v, market: obs.m, t: obs.t, e: obs.e, opposingHand });
    rows.push({ t: obs.t, e: obs.e, m: obs.m, y: obs.a > line ? 1 : 0, marketP, x: featureVector({ history, line, marketP, context: ctx }) });
  }
  return rows;
}

/** One Newton step of L2-regularised logistic regression; null when it cannot solve. */
function newtonStep(rows, w, lambda) {
  const k = w.length;
  {
    const g = new Array(k).fill(0);
    const H = Array.from({ length: k }, () => new Array(k).fill(0));
    for (const r of rows) {
      const p = sigmoid(r.x.reduce((s, v, i) => s + v * w[i], 0));
      const d = p - r.y, s = Math.max(p * (1 - p), 1e-6);
      for (let i = 0; i < k; i++) {
        if (!r.x[i]) continue;
        g[i] += d * r.x[i];
        for (let j = 0; j < k; j++) if (r.x[j]) H[i][j] += s * r.x[i] * r.x[j];
      }
    }
    for (let i = 1; i < k; i++) { g[i] += lambda * w[i]; H[i][i] += lambda; }
    for (let i = 0; i < k; i++) H[i][i] += 1e-6;
    return solve(H, g);
  }
}

/** L2-regularised logistic regression by Newton's method (few features, so exact). */
export function fitLogistic(rows, { lambda = 1, iterations = 25 } = {}) {
  let w = new Array(FEATURES.length).fill(0);
  for (let it = 0; it < iterations; it++) {
    const step = newtonStep(rows, w, lambda);
    if (!step) return null;
    w = w.map((v, i) => v - step[i]);
    if (Math.max(...step.map(Math.abs)) < 1e-7) break;
  }
  return w.every(finite) ? w : null;
}

/** The same fit, yielding to the event loop between steps (large pooled fits). */
export async function fitLogisticAsync(rows, { lambda = 1, iterations = 25, yieldFn = () => new Promise(resolve => setImmediate(resolve)) } = {}) {
  let w = new Array(FEATURES.length).fill(0);
  for (let it = 0; it < iterations; it++) {
    const step = newtonStep(rows, w, lambda);
    if (!step) return null;
    w = w.map((v, i) => v - step[i]);
    if (Math.max(...step.map(Math.abs)) < 1e-7) break;
    await yieldFn();
  }
  return w.every(finite) ? w : null;
}

function solve(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    if (Math.abs(M[i][i]) < 1e-12) return null;
    for (let r = i + 1; r < n; r++) {
      const f = M[r][i] / M[i][i];
      for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let c = i + 1; c < n; c++) s -= M[i][c] * x[c];
    x[i] = s / M[i][i];
  }
  return x;
}

export const predictRow = (weights, x) => sigmoid(x.reduce((s, v, i) => s + v * weights[i], 0));

/** Brier, log loss and expected calibration error (10 equal-width bins). */
export function scoreProbabilities(pairs) {
  if (!pairs.length) return { n: 0, brier: null, logLoss: null, calibrationError: null };
  let brier = 0, logLoss = 0;
  const bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 }));
  for (const { p, y } of pairs) {
    const q = clamp(p, 1e-6, 1 - 1e-6);
    brier += (q - y) ** 2;
    logLoss -= y ? Math.log(q) : Math.log(1 - q);
    const bin = bins[Math.min(9, Math.floor(q * 10))];
    bin.n++; bin.p += q; bin.y += y;
  }
  const n = pairs.length;
  const calibrationError = bins.reduce((s, b) => s + (b.n ? Math.abs(b.p - b.y) : 0), 0) / n;
  return { n, brier: brier / n, logLoss: logLoss / n, calibrationError };
}

/** Deterministic uniform numbers for resampling, so a decision can be reproduced. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The measured calibration error, and the error random outcomes alone reach
 * 95% of the time for these same predictions (outcomes redrawn from the
 * stated probabilities). The gap between them is evidence of miscalibration.
 */
export function calibrationEvidence(pairs, { draws = 200, seed = 1 } = {}) {
  const ece = scoreProbabilities(pairs).calibrationError;
  if (!finite(ece)) return { ece: null, noise95: null };
  const rand = seeded(seed);
  const sims = [];
  for (let d = 0; d < draws; d++) sims.push(scoreProbabilities(pairs.map(({ p }) => ({ p, y: rand() < p ? 1 : 0 }))).calibrationError);
  sims.sort((a, b) => a - b);
  return { ece, noise95: sims[Math.floor(0.95 * (draws - 1))] };
}

/**
 * Brier difference (model minus baseline) on the same rows, and its one-sided
 * upper bound from resampling whole games: props from one game move together,
 * so rows are not independent evidence and the game is the unit resampled.
 */
export function pairedBrierDelta(rows, model, baseline, { draws = 500, seed = 2, q = 0.9 } = {}) {
  const games = new Map();
  for (const r of rows) {
    const pm = model(r), pb = baseline(r);
    if (!finite(pm) || !finite(pb)) continue;
    const g = games.get(r.e) || { d: 0, n: 0 };
    g.d += (clamp(pm, 1e-6, 1 - 1e-6) - r.y) ** 2 - (clamp(pb, 1e-6, 1 - 1e-6) - r.y) ** 2;
    g.n += 1;
    games.set(r.e, g);
  }
  const list = [...games.values()];
  if (!list.length) return { delta: null, upper: null, games: 0, n: 0 };
  let d = 0, n = 0;
  for (const g of list) { d += g.d; n += g.n; }
  const rand = seeded(seed);
  const sims = [];
  for (let k = 0; k < draws; k++) {
    let sd = 0, sn = 0;
    for (let i = 0; i < list.length; i++) { const g = list[Math.floor(rand() * list.length)]; sd += g.d; sn += g.n; }
    sims.push(sd / sn);
  }
  sims.sort((a, b) => a - b);
  return { delta: d / n, upper: sims[Math.floor(q * (draws - 1))], games: list.length, n };
}

/** The chronological split: the latest games are held out, cut between games. */
export function splitHoldout(rows, policy = PROMOTION_POLICY) {
  const sorted = [...rows].sort((a, b) => a.t - b.t);
  // Cut between games, never inside one: other players' results from the same
  // game on both sides of the line would let the holdout share a game with the
  // training rows it is meant to be independent of.
  let cut = Math.floor(sorted.length * (1 - policy.holdoutFraction));
  while (cut > 0 && cut < sorted.length && sorted[cut].t === sorted[cut - 1].t) cut += 1;
  return { sorted, train: sorted.slice(0, cut), holdout: sorted.slice(cut) };
}

/**
 * Scores fitted weights on held-out rows and applies every gate except the
 * training-size one. Used for a sport's own model and for the pooled model
 * scored on that sport's holdout, so both face the same test.
 */
export function evaluateWeights(fitted, holdout, { policy = PROMOTION_POLICY, champion = null, trainRows = 0 } = {}) {
  const reasons = [];
  const withMarket = holdout.filter(r => r.x[2] === 1), without = holdout.filter(r => r.x[2] !== 1);
  const score = (list, fn) => scoreProbabilities(list.map(r => ({ p: fn(r), y: r.y })));
  const predict = r => (fitted ? predictWith(fitted, r.x) : 0.5);
  const q = policy.evidenceQuantile ?? 0.9, draws = policy.evidenceDraws ?? 500;
  const hitRate = r => 0.5 + r.x[6], coin = () => 0.5;
  const calibration = calibrationEvidence(holdout.map(r => ({ p: predict(r), y: r.y })), { draws: policy.calibrationDraws ?? 200 });
  const metrics = {
    trainRows,
    holdoutRows: holdout.length,
    holdoutEvents: new Set(holdout.map(r => r.e)).size,
    holdoutStart: holdout.length ? new Date(holdout[0].t).toISOString() : null,
    holdoutEnd: holdout.length ? new Date(holdout[holdout.length - 1].t).toISOString() : null,
    all: score(holdout, predict),
    calibration,
    withMarket: {
      model: score(withMarket, predict),
      market: score(withMarket, r => r.marketP),
      delta: pairedBrierDelta(withMarket, predict, r => r.marketP, { draws, q }),
    },
    withoutMarket: {
      model: score(without, predict),
      hitRate: score(without, hitRate),
      coinFlip: score(without, coin),
      deltaHitRate: pairedBrierDelta(without, predict, hitRate, { draws, q }),
      deltaCoin: pairedBrierDelta(without, predict, coin, { draws, q }),
    },
  };

  if (holdout.length < policy.minHoldout) reasons.push('INSUFFICIENT_HOLDOUT');
  if (metrics.holdoutEvents < policy.minHoldoutEvents) reasons.push('INSUFFICIENT_HOLDOUT_EVENTS');
  const miscalibrated = !finite(calibration.ece)
    || (calibration.ece > policy.maxCalibrationError && calibration.ece > (calibration.noise95 ?? 0));
  if (miscalibrated) reasons.push('CALIBRATION_FAILED');

  // Each regime is released separately, on evidence: a model may improve
  // pick'em-only props while adding nothing over a two-sided market, or the reverse.
  const wm = metrics.withMarket, wo = metrics.withoutMarket;
  const enough = (delta) => delta.n >= 150 && delta.games >= policy.minHoldoutEvents;
  const useWithMarket = Boolean(fitted) && enough(wm.delta) && finite(wm.delta.upper)
    && wm.delta.upper <= policy.maxMarketBrierExcess;
  const useWithoutMarket = Boolean(fitted) && enough(wo.deltaHitRate)
    && finite(wo.deltaHitRate.upper) && wo.deltaHitRate.upper <= 0
    && finite(wo.deltaCoin.upper) && wo.deltaCoin.upper <= 0;
  if (!useWithMarket && !useWithoutMarket) reasons.push('NO_REGIME_BEATS_BASELINE');

  if (champion?.weights && fitted) {
    // The champion was refitted on every row it had, so holdout rows up to its
    // dataThrough are in its training set and would flatter it. Compare only on
    // games after that, with the challenger scored on the same rows.
    const through = Date.parse(champion.dataThrough || '') || Infinity;
    const unseen = holdout.filter(r => r.t > through);
    if (unseen.length >= Math.min(150, policy.minHoldout)) {
      const champ = score(unseen, r => predictWith(champion.weights, r.x));
      const challenger = score(unseen, predict);
      metrics.champion = { ...champ, challengerBrier: challenger.brier, since: new Date(through).toISOString() };
      if (challenger.brier > champ.brier + policy.maxChampionBrierExcess) reasons.push('WORSE_THAN_CHAMPION');
    } else {
      // Too few games the champion never saw to judge it fairly; the market and
      // calibration gates above still decide.
      metrics.champion = { n: unseen.length, skipped: 'TOO_FEW_UNSEEN_ROWS' };
    }
  }

  return { reasons, regimes: { withMarket: useWithMarket, withoutMarket: useWithoutMarket }, metrics };
}

/**
 * Train on the earlier 80% of rows, score the later 20%, then decide.
 * Returns { weights, metrics, gate } where weights are refitted on every row
 * only when the gate passes.
 */
export function trainAndEvaluate(rows, { policy = PROMOTION_POLICY, champion = null } = {}) {
  const { sorted, train, holdout } = splitHoldout(rows, policy);
  const fitted = train.length >= 200 ? fitLogistic(train) : null;
  const evaluation = evaluateWeights(fitted, holdout, { policy, champion, trainRows: train.length });
  const reasons = [...(fitted ? [] : ['INSUFFICIENT_TRAINING_ROWS']), ...evaluation.reasons];
  const promote = reasons.length === 0;
  const weights = promote ? fitLogistic(sorted) : null;
  if (promote && !weights) reasons.push('REFIT_FAILED');
  return {
    promote: promote && Boolean(weights),
    reasons,
    weights,
    regimes: evaluation.regimes,
    metrics: evaluation.metrics,
  };
}

/** Share of integer-line games that landed exactly on the line, per market. */
export function pushRates(observations) {
  const counts = new Map();
  for (const obs of observations) {
    const line = finite(obs.cp) ? obs.cp : finite(obs.dl) ? obs.dl : null;
    if (line === null || !Number.isInteger(line)) continue;
    const c = counts.get(obs.m) || { n: 0, push: 0 };
    c.n++; if (obs.a === line) c.push++;
    counts.set(obs.m, c);
  }
  const out = {};
  for (const [market, c] of counts) if (c.n >= 50) out[market] = (c.push + 1) / (c.n + 2);
  return out;
}
