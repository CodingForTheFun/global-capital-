import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildRows, splitHoldout } from '../lib/ml/global/model.mjs';
import { runTrainingCycle } from '../lib/ml/global/scheduler.mjs';
import { createGlobalPredictor } from '../lib/ml/global/predictor.mjs';
import { readArtifact, readState } from '../lib/ml/global/store.mjs';

// Synthetic league as in global-model.test.mjs, with its own names and events
// so two sports never share a player or a game.
function league({ players = 60, games = 40, seed = 7, marketNoise = 0.08, prefix = 'P' } = {}) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const normal = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const out = [];
  const start = Date.parse('2026-01-01T00:00:00Z');
  for (let p = 0; p < players; p++) {
    const mu = 4 + rnd() * 20, sigma = 2 + rnd() * 3;
    for (let g = 0; g < games; g++) {
      const t = start + g * 86_400_000 + p * 1000;
      const line = Math.round(mu + normal() * 1.5) + 0.5;
      const z = (line - mu) / sigma;
      const trueOver = 1 - 0.5 * (1 + Math.tanh(0.7978845608 * (z + 0.044715 * z ** 3)));
      const cq = Math.min(0.97, Math.max(0.03, trueOver + normal() * marketNoise));
      out.push({ e: `${prefix}ev${g}-${p % 10}`, t, p: `${prefix} ${p}`, m: 'player_points', a: Math.max(0, Math.round((mu + normal() * sigma) * 2) / 2),
        cp: line, cq, cn: 4, op: null, oq: null, on: 0, dl: null });
    }
  }
  return out;
}

const now = Date.parse('2026-06-01T00:00:00Z');
const policy = { maxExportCallsPerCycle: 4, exportReserve: 15, lookbackDays: 365, defaultWindowDays: 7, minWindowDays: 1 };

async function cycle(data) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'global-pooled-'));
  const summary = await runTrainingCycle({
    sports: ['NBA', 'WNBA'], now, dir, policy,
    fetchWindow: async ({ sportKey }) => ({ ok: true, observations: data[sportKey] || [], stats: { rows: 1 }, meta: { dailyRemaining: '80' } }),
  });
  return { dir, summary, state: await readState(dir) };
}

test('the all-sports model serves a sport only when it beats that sport\'s own model on the sport\'s own later games', async () => {
  const nba = league({ players: 80, games: 40 });
  const wnba = league({ players: 30, games: 70, seed: 5, prefix: 'W', marketNoise: 0.12 });
  const { dir, summary, state } = await cycle({ basketball_nba: nba, basketball_wnba: wnba });
  try {
    const evaluation = state.sports.NBA.lastEvaluation;
    assert.equal(evaluation.chosen, 'pooled');
    assert.deepEqual(evaluation.reasons, [], 'the sport\'s own model also passed');
    assert.deepEqual(evaluation.pooled.reasons, []);
    assert.ok(evaluation.pooled.metrics.all.brier < evaluation.metrics.all.brier, 'chosen for scoring better on the same games');
    const artifact = await readArtifact('NBA', dir);
    assert.equal(artifact.source, 'pooled');
    assert.deepEqual(artifact.metrics, evaluation.pooled.metrics, 'the artifact carries the evidence it was chosen on');
    const row = summary.trained.find((t) => t.sport === 'NBA');
    assert.equal(row.chosen, 'pooled');
    assert.ok(row.diag.pooled.vsMarket[0] >= 20, 'the diagnostics report the pooled evidence');

    const predictor = createGlobalPredictor({ dir, clock: () => now });
    const p = await predictor.predict({ sport: 'NBA', eventId: '9', playerId: 'p', playerName: 'P 3', marketId: 'player_points', sportsbookKey: 'draftkings',
      gameStartTime: '2026-06-02T00:00:00.000Z', line: 12.5, entityType: 'player', live: false, isAlternate: false, marketOverProbability: 0.55 });
    assert.equal(p.sourceKind, 'global-model');
    assert.match(p.validation?.message || p.message || JSON.stringify(p), /across every sport/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the all-sports model learns only from games that started before the sport\'s test games', async () => {
  const nba = league({ players: 80, games: 40 });
  const wnba = league({ players: 30, games: 70, seed: 5, prefix: 'W', marketNoise: 0.12 });
  const { dir, state } = await cycle({ basketball_nba: nba, basketball_wnba: wnba });
  try {
    const rows = [...buildRows(nba), ...buildRows(wnba)];
    for (const [sport, obs] of [['NBA', nba], ['WNBA', wnba]]) {
      const { holdout } = splitHoldout(buildRows(obs));
      const expected = rows.filter((r) => r.t < holdout[0].t).length;
      assert.equal(state.sports[sport].lastEvaluation.pooled.metrics.trainRows, expected, sport);
      // WNBA's season runs past NBA's test games, so those later games are left out of NBA's.
      if (sport === 'NBA') assert.ok(expected < rows.length - holdout.length, 'later games of the other sport are left out too');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a sport with too few test games gets no model, however well the all-sports model does elsewhere', async () => {
  const { dir, state } = await cycle({ basketball_nba: league({ players: 80, games: 40 }), basketball_wnba: league({ players: 4, games: 10, seed: 3, prefix: 'W' }) });
  try {
    const evaluation = state.sports.WNBA.lastEvaluation;
    assert.equal(evaluation.chosen, null);
    assert.ok(evaluation.pooled.reasons.includes('INSUFFICIENT_HOLDOUT'));
    assert.equal(await readArtifact('WNBA', dir), null);
    assert.ok(await readArtifact('NBA', dir), 'the sport with evidence still serves');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
