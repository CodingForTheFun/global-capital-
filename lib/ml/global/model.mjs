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

export const FEATURES = Object.freeze(['bias', 'market', 'hasMarket', 'form10', 'form5', 'formSeason', 'hitRate10', 'depth']);
export const MODEL_VERSION = 'global-logit-v1';
/** A game is usable history only if it started at least this long before the target. */
const HISTORY_GAP_MS = 3 * 3600_000;
const MIN_HISTORY = 3;

export const PROMOTION_POLICY = Object.freeze({
  minHoldout: 400,
  minHoldoutEvents: 60,
  holdoutFraction: 0.2,
  /** With a market, the model may not be worse than the market alone. */
  maxMarketBrierExcess: 0.0005,
  /** Without a market, it must beat both a coin flip and the smoothed hit rate. */
  maxCalibrationError: 0.04,
  /** A challenger replaces the champion only if it is not worse on the same rows. */
  maxChampionBrierExcess: 0.0005,
});

/**
 * Feature vector for one prop at `line`, from the player's prior results in
 * this market (oldest first) and the consensus no-vig over probability at this
 * exact line when a two-sided market exists.
 */
export function featureVector({ history = [], line, marketP = null }) {
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
  return x;
}

/**
 * Chronological training rows. Each row's history is only games that began
 * before it (with a gap), so no row ever sees its own or a later result.
 * The target line is the market's consensus point, or the standard pick'em
 * line when no two-sided market existed. Pushes are excluded from the fit.
 */
export function buildRows(observations) {
  const sorted = [...observations].sort((a, b) => a.t - b.t);
  const past = new Map();
  const rows = [];
  let cursor = 0;
  for (const obs of sorted) {
    // Release earlier games into history only once they are old enough.
    while (cursor < sorted.length && sorted[cursor].t <= obs.t - HISTORY_GAP_MS) {
      const prior = sorted[cursor++];
      const key = `${nameKey(prior.p)}|${prior.m}`;
      const list = past.get(key) || [];
      list.push(prior.a);
      if (list.length > 60) list.shift();
      past.set(key, list);
    }
    const line = finite(obs.cp) ? obs.cp : finite(obs.dl) ? obs.dl : null;
    if (line === null || obs.a === line) continue;
    const history = past.get(`${nameKey(obs.p)}|${obs.m}`) || [];
    const marketP = finite(obs.cp) && finite(obs.cq) ? obs.cq : null;
    rows.push({ t: obs.t, e: obs.e, m: obs.m, y: obs.a > line ? 1 : 0, marketP, x: featureVector({ history, line, marketP }) });
  }
  return rows;
}

/** L2-regularised logistic regression by Newton's method (8 features, so exact). */
export function fitLogistic(rows, { lambda = 1, iterations = 25 } = {}) {
  const k = FEATURES.length;
  let w = new Array(k).fill(0);
  for (let it = 0; it < iterations; it++) {
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
    const step = solve(H, g);
    if (!step) return null;
    w = w.map((v, i) => v - step[i]);
    if (Math.max(...step.map(Math.abs)) < 1e-7) break;
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

/**
 * Train on the earlier 80% of rows, score the later 20%, then decide.
 * Returns { weights, metrics, gate } where weights are refitted on every row
 * only when the gate passes.
 */
export function trainAndEvaluate(rows, { policy = PROMOTION_POLICY, champion = null } = {}) {
  const sorted = [...rows].sort((a, b) => a.t - b.t);
  const cut = Math.floor(sorted.length * (1 - policy.holdoutFraction));
  const train = sorted.slice(0, cut), holdout = sorted.slice(cut);
  const reasons = [];
  const fitted = train.length >= 200 ? fitLogistic(train) : null;
  if (!fitted) reasons.push('INSUFFICIENT_TRAINING_ROWS');

  const withMarket = holdout.filter(r => r.x[2] === 1), without = holdout.filter(r => r.x[2] !== 1);
  const score = (list, fn) => scoreProbabilities(list.map(r => ({ p: fn(r), y: r.y })));
  const model = fn => fitted ? fn : () => 0.5;
  const metrics = {
    trainRows: train.length,
    holdoutRows: holdout.length,
    holdoutEvents: new Set(holdout.map(r => r.e)).size,
    holdoutStart: holdout.length ? new Date(holdout[0].t).toISOString() : null,
    holdoutEnd: holdout.length ? new Date(holdout[holdout.length - 1].t).toISOString() : null,
    all: score(holdout, model(r => predictRow(fitted, r.x))),
    withMarket: {
      model: score(withMarket, model(r => predictRow(fitted, r.x))),
      market: score(withMarket, r => r.marketP),
    },
    withoutMarket: {
      model: score(without, model(r => predictRow(fitted, r.x))),
      hitRate: score(without, r => 0.5 + r.x[6]),
      coinFlip: score(without, () => 0.5),
    },
  };

  if (holdout.length < policy.minHoldout) reasons.push('INSUFFICIENT_HOLDOUT');
  if (metrics.holdoutEvents < policy.minHoldoutEvents) reasons.push('INSUFFICIENT_HOLDOUT_EVENTS');
  if (!finite(metrics.all.calibrationError) || metrics.all.calibrationError > policy.maxCalibrationError) reasons.push('CALIBRATION_FAILED');

  // Each regime is released separately: a model may improve pick'em-only
  // props while adding nothing over a two-sided market, or the reverse.
  const wm = metrics.withMarket, wo = metrics.withoutMarket;
  const useWithMarket = fitted && wm.model.n >= 150
    && wm.model.brier <= wm.market.brier + policy.maxMarketBrierExcess;
  const useWithoutMarket = fitted && wo.model.n >= 150
    && wo.model.brier < wo.coinFlip.brier && wo.model.brier <= wo.hitRate.brier;
  if (!useWithMarket && !useWithoutMarket) reasons.push('NO_REGIME_BEATS_BASELINE');

  if (champion?.weights && fitted) {
    const champ = score(holdout, r => predictRow(champion.weights, r.x));
    metrics.champion = champ;
    if (metrics.all.brier > champ.brier + policy.maxChampionBrierExcess) reasons.push('WORSE_THAN_CHAMPION');
  }

  const promote = reasons.length === 0;
  const weights = promote ? fitLogistic(sorted) : null;
  if (promote && !weights) reasons.push('REFIT_FAILED');
  return {
    promote: promote && Boolean(weights),
    reasons,
    weights,
    regimes: { withMarket: Boolean(useWithMarket), withoutMarket: Boolean(useWithoutMarket) },
    metrics,
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
