import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrationEvidence, pairedBrierDelta, evaluateWeights, PROMOTION_POLICY, FEATURES } from '../lib/ml/global/model.mjs';

let seed = 99;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test('calibration: noise at a small holdout is not read as miscalibration, a real bias still is', () => {
  // 400 perfectly calibrated predictions: outcomes drawn at the stated probability.
  let measuredAboveGate = 0, flagged = 0;
  for (let trial = 0; trial < 40; trial++) {
    const pairs = Array.from({ length: 400 }, () => { const p = 0.3 + rand() * 0.4; return { p, y: rand() < p ? 1 : 0 }; });
    const { ece, noise95 } = calibrationEvidence(pairs, { draws: 200, seed: trial + 1 });
    if (ece > 0.04) measuredAboveGate += 1;
    if (ece > 0.04 && ece > noise95) flagged += 1;
  }
  assert.ok(measuredAboveGate >= 5, 'the old fixed gate would have failed some perfectly calibrated models');
  assert.ok(flagged <= 4, `noise-aware check flagged ${flagged} of 40 calibrated models`);
  // A biased model: says 70% when the truth is 50%.
  const biased = Array.from({ length: 400 }, () => ({ p: 0.7, y: rand() < 0.5 ? 1 : 0 }));
  const b = calibrationEvidence(biased, { draws: 200 });
  assert.ok(b.ece > 0.04 && b.ece > b.noise95, 'a real bias is still caught');
});

test('paired Brier difference resamples whole games, so correlated props widen the bound', () => {
  const rows = [];
  for (let g = 0; g < 40; g++) {
    const y = rand() < 0.5 ? 1 : 0;
    // Ten props from one game share their outcome.
    for (let i = 0; i < 10; i++) rows.push({ e: 'g' + g, y, pm: y ? 0.6 : 0.4, pb: 0.5 });
  }
  const clustered = pairedBrierDelta(rows, (r) => r.pm, (r) => r.pb, { draws: 500 });
  assert.equal(clustered.games, 40);
  assert.ok(clustered.delta < 0, 'the model is better on average');
  const independent = pairedBrierDelta(rows.map((r, i) => ({ ...r, e: 'x' + i })), (r) => r.pm, (r) => r.pb, { draws: 500 });
  assert.ok(Math.abs(independent.delta - clustered.delta) < 1e-12);
  assert.equal(pairedBrierDelta([], () => 0.5, () => 0.5).games, 0);
});

function holdoutRows({ games, perGame, edge, withMarket = true }) {
  const rows = [];
  for (let g = 0; g < games; g++) {
    for (let i = 0; i < perGame; i++) {
      const truth = 0.35 + rand() * 0.3;
      const y = rand() < truth ? 1 : 0;
      const x = new Array(FEATURES.length).fill(0);
      x[0] = 1;
      if (withMarket) { x[2] = 1; x[1] = Math.log(truth / (1 - truth)); }
      rows.push({ e: 'g' + g, t: g * 1000 + i, y, x, marketP: withMarket ? Math.min(0.95, Math.max(0.05, truth + (rand() - 0.5) * edge)) : null });
    }
  }
  return rows;
}

test('a regime needs enough games and confident evidence, not a point estimate', () => {
  // Weights that read the true probability through the market column: the
  // model knows the truth; the market is noisier by `edge`.
  const weights = new Array(FEATURES.length).fill(0);
  weights[1] = 1;
  const clear = evaluateWeights(weights, holdoutRows({ games: 40, perGame: 25, edge: 0.4 }), { policy: PROMOTION_POLICY });
  assert.equal(clear.regimes.withMarket, true, JSON.stringify(clear.reasons));
  assert.ok(clear.metrics.withMarket.delta.upper <= PROMOTION_POLICY.maxMarketBrierExcess);
  const fewGames = evaluateWeights(weights, holdoutRows({ games: 12, perGame: 50, edge: 0.4 }), { policy: PROMOTION_POLICY });
  assert.ok(fewGames.reasons.includes('INSUFFICIENT_HOLDOUT_EVENTS'));
  assert.equal(fewGames.regimes.withMarket, false, 'twelve games are not enough evidence however many props they hold');
  const tie = evaluateWeights(weights, holdoutRows({ games: 40, perGame: 25, edge: 0.0 }), { policy: PROMOTION_POLICY });
  assert.equal(tie.regimes.withMarket, true, 'matching the market is allowed within the small excess');
});
