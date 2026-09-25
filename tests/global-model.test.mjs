import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCsvStream, parseCsvLine } from '../lib/ml/global/csv.mjs';
import { createObservationReducer } from '../lib/ml/global/observations.mjs';
import { buildRows, featureVector, trainAndEvaluate, scoreProbabilities, FEATURES, PROMOTION_POLICY } from '../lib/ml/global/model.mjs';
import { runTrainingCycle } from '../lib/ml/global/scheduler.mjs';
import { createGlobalPredictor } from '../lib/ml/global/predictor.mjs';
import { readArtifact, readState, writeArtifact, writeObservations, mergeObservations } from '../lib/ml/global/store.mjs';
import { createMLStore } from '../lib/ml/snapshot-store.mjs';
import { predictionTarget } from '../lib/ml/contract.mjs';

const sampleCsv = readFileSync(new URL('./fixtures/propline-resolved-sample.csv', import.meta.url), 'utf8');

function reduce(csvText, chunk = 97) {
  const reducer = createObservationReducer({ sportKey: 'baseball_mlb' });
  const csv = createCsvStream(record => reducer.add(record));
  for (let i = 0; i < csvText.length; i += chunk) csv.push(csvText.slice(i, i + chunk));
  csv.end();
  return { observations: reducer.finish(), stats: reducer.stats(), header: csv.header() };
}

test('CSV reader handles quotes, escaped quotes and rows split across chunks', () => {
  assert.deepEqual(parseCsvLine('a,"b,c","d ""e""",'), ['a', 'b,c', 'd "e"', '']);
  const rows = [];
  const csv = createCsvStream(r => { rows.push(r); });
  for (const piece of ['x,y\r\n1,"multi', '\nline"\n2,', '3\n']) csv.push(piece);
  csv.end();
  assert.deepEqual(rows, [{ x: '1', y: 'multi\nline' }, { x: '2', y: '3' }]);
});

test('the real PropLine export sample reduces to one observation per player market per game', () => {
  const { observations, stats, header } = reduce(sampleCsv);
  assert.ok(header.includes('closing_point') && header.includes('actual_value'));
  assert.ok(observations.length >= 5 && observations.length < stats.rows);
  const keys = new Set(observations.map(o => `${o.e}|${o.p}|${o.m}`));
  assert.equal(keys.size, observations.length);
  for (const o of observations) {
    assert.ok(Number.isFinite(o.a) && Number.isFinite(o.t));
    if (o.cq !== null) { assert.ok(o.cq > 0 && o.cq < 1); assert.ok(o.cn >= 1); }
  }
  assert.ok(observations.some(o => o.cq !== null), 'two-sided closing markets exist in the sample');
});

test('pick\'em books never price the market; only standard pick\'em lines are kept', () => {
  const head = 'event_id,sport_key,commence_time,market,bookmaker,player_name,outcome_name,line,price_american,resolution,actual_value,closing_price,closing_point,opening_price,opening_point,dfs_odds_type';
  const row = (book, side, price, point, tier = '') => `1,baseball_mlb,2026-09-01T17:00:00Z,pitcher_strikeouts,${book},A Pitcher,${side},${point},${price},won,6,${price},${point},${price},${point},${tier}`;
  const csv = [head,
    row('prizepicks', 'Over', -137, 5.5, 'standard'), row('prizepicks', 'Under', -137, 5.5, 'standard'),
    row('prizepicks', 'Over', -137, 3.5, 'goblin'),
    row('draftkings', 'Over', -120, 5.5), row('draftkings', 'Under', 100, 5.5),
    row('fanduel', 'Over', -110, 5.5), // no under at fanduel: contributes nothing
  ].join('\n');
  const [obs] = reduce(csv).observations;
  assert.equal(obs.cn, 1, 'only DraftKings quoted both sides');
  const over = 120 / 220, under = 100 / 200;
  assert.ok(Math.abs(obs.cq - over / (over + under)) < 1e-12);
  assert.equal(obs.dl, 5.5, 'the goblin line is not the pick\'em line');
});

test('an observation whose books disagree on the actual result is dropped', () => {
  const head = 'event_id,sport_key,commence_time,market,bookmaker,player_name,outcome_name,line,price_american,resolution,actual_value,closing_price,closing_point,opening_price,opening_point';
  const csv = [head,
    '1,baseball_mlb,2026-09-01T17:00:00Z,batter_hits,draftkings,B Hitter,Over,0.5,-150,won,1,-150,0.5,-150,0.5',
    '1,baseball_mlb,2026-09-01T17:00:00Z,batter_hits,fanduel,B Hitter,Over,0.5,-150,won,2,-150,0.5,-150,0.5',
  ].join('\n');
  assert.equal(reduce(csv).observations.length, 0);
});

// Synthetic league: each player has a true mean; the market knows it with
// noise; history reveals it slowly. Deterministic pseudo-random numbers.
function league({ players = 60, games = 40, seed = 7, withMarket = true } = {}) {
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
      const cq = withMarket ? Math.min(0.97, Math.max(0.03, trueOver + normal() * 0.03)) : null;
      out.push({ e: `ev${g}-${p % 10}`, t, p: `Player ${p}`, m: 'player_points', a: Math.max(0, Math.round((mu + normal() * sigma) * 2) / 2),
        cp: withMarket ? line : null, cq, cn: withMarket ? 4 : 0, op: null, oq: null, on: 0, dl: withMarket ? null : line });
    }
  }
  return out;
}

test('training rows only see games that started before the row they describe', () => {
  const obs = league({ players: 2, games: 12 });
  const rows = buildRows(obs);
  const first = rows[0];
  assert.equal(first.x[FEATURES.indexOf('depth')], 0, 'the first game has no history');
  // Rebuild with a future result changed wildly: earlier rows must not move.
  const altered = obs.map(o => o.t === Math.max(...obs.map(x => x.t)) ? { ...o, a: 999 } : o);
  const rows2 = buildRows(altered);
  for (let i = 0; i < rows.length - 2; i++) assert.deepEqual(rows[i].x, rows2[i].x);
});

test('feature vector marks a missing market instead of inventing one', () => {
  const x = featureVector({ history: [5, 6, 7, 8], line: 6.5, marketP: null });
  assert.equal(x[FEATURES.indexOf('hasMarket')], 0);
  assert.equal(x[FEATURES.indexOf('market')], 0);
  assert.ok(x[FEATURES.indexOf('depth')] > 0);
  const none = featureVector({ history: [5], line: 6.5, marketP: 0.55 });
  assert.equal(none[FEATURES.indexOf('form10')], 0, 'fewer than three games is no history');
});

test('the gate promotes a model that is not worse than the market on later games', () => {
  const result = trainAndEvaluate(buildRows(league({ players: 80, games: 40 })));
  assert.equal(result.promote, true, result.reasons.join(','));
  assert.equal(result.regimes.withMarket, true);
  const wm = result.metrics.withMarket;
  assert.ok(wm.model.brier <= wm.market.brier + 0.0005);
  assert.ok(result.metrics.holdoutStart > new Date(Date.parse('2026-01-01')).toISOString());
});

test('the gate refuses small samples and never promotes on training fit alone', () => {
  const result = trainAndEvaluate(buildRows(league({ players: 5, games: 12 })));
  assert.equal(result.promote, false);
  assert.ok(result.reasons.includes('INSUFFICIENT_HOLDOUT'));
  assert.equal(result.weights, null);
});

test('a challenger worse than the champion on the same games is rejected', () => {
  const rows = buildRows(league({ players: 80, games: 40 }));
  const good = trainAndEvaluate(rows);
  const champion = { weights: good.weights };
  // Same rows, same champion: demanding a large margin over it must block promotion.
  const strict = trainAndEvaluate(rows, { champion, policy: { ...PROMOTION_POLICY, maxChampionBrierExcess: -0.05 } });
  assert.equal(strict.promote, false);
  assert.ok(strict.reasons.includes('WORSE_THAN_CHAMPION'));
  assert.ok(Math.abs(strict.metrics.champion.brier - strict.metrics.all.brier) < 0.01);
});

test('probability scores are exact on a tiny example', () => {
  const s = scoreProbabilities([{ p: 0.8, y: 1 }, { p: 0.2, y: 0 }]);
  assert.ok(Math.abs(s.brier - 0.04) < 1e-12);
  assert.ok(Math.abs(s.calibrationError - 0.2) < 1e-12);
});

test('observation merge replaces by identity and applies retention', () => {
  const now = Date.parse('2026-09-01T00:00:00Z');
  const a = { e: '1', t: now - 1000, p: 'X', m: 'm', a: 1 };
  const b = { ...a, a: 2 };
  const old = { e: '0', t: now - 500 * 86_400_000, p: 'X', m: 'm', a: 3 };
  const merged = mergeObservations([a, old], [b], { now });
  assert.deepEqual(merged, [b]);
});

async function tmp() { return mkdtemp(path.join(os.tmpdir(), 'global-model-')); }

test('a training cycle advances cursors, respects the export budget and promotes', async () => {
  const dir = await tmp();
  try {
    const obs = league({ players: 80, games: 40 });
    const calls = [];
    const fetchWindow = async ({ sportKey, since, until }) => {
      calls.push({ sportKey, since, until });
      return { ok: true, observations: sportKey === 'basketball_nba' ? obs : [], stats: { rows: 1 }, meta: { dailyRemaining: '80' } };
    };
    const now = Date.parse('2026-03-01T00:00:00Z');
    const summary = await runTrainingCycle({ sports: ['NBA', 'MLB'], now, dir, fetchWindow, policy: { maxExportCallsPerCycle: 6, exportReserve: 15, lookbackDays: 365, defaultWindowDays: 7, minWindowDays: 1 } });
    assert.equal(summary.exportCalls, 6);
    assert.equal(calls.length, 6);
    const state = await readState(dir);
    assert.ok(Date.parse(state.sports.NBA.backfillThrough) < now - 2 * 86_400_000);
    assert.equal(state.sports.NBA.incrementalThrough, new Date(now).toISOString());
    const artifact = await readArtifact('NBA', dir);
    assert.ok(artifact && artifact.regimes.withMarket, JSON.stringify(state.sports.NBA.lastEvaluation?.reasons));
    assert.equal(await readArtifact('MLB', dir), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a cycle stops at the export reserve or daily cap and halves an oversized window', async () => {
  const dir = await tmp();
  try {
    let n = 0;
    const fetchWindow = async () => {
      n += 1;
      if (n === 1) return { ok: true, observations: [], meta: { dailyRemaining: '40' } };
      if (n === 2) return { ok: false, code: 'EXPORT_WINDOW_TOO_LARGE', meta: { dailyRemaining: '39' } };
      return { ok: false, code: 'EXPORT_DAILY_CAP', meta: {} };
    };
    const summary = await runTrainingCycle({ sports: ['NBA'], now: Date.parse('2026-03-01T00:00:00Z'), dir, fetchWindow });
    assert.equal(summary.stop, 'EXPORT_DAILY_CAP');
    assert.equal((await readState(dir)).sports.NBA.windowDays, 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

const target = extra => ({ sport: 'NBA', eventId: '9', playerId: 'p', playerName: 'Player 3', marketId: 'player_points', sportsbookKey: 'draftkings',
  gameStartTime: '2026-03-05T00:00:00.000Z', line: 12.5, entityType: 'player', live: false, isAlternate: false, ...extra });

test('without a promoted model the market probability is passed through and labelled as the market', async () => {
  const dir = await tmp();
  try {
    const predictor = createGlobalPredictor({ dir });
    const p = await predictor.predict(target({ marketOverProbability: 0.56 }));
    assert.equal(p.sourceKind, 'market-consensus');
    assert.equal(p.modelled, false);
    assert.ok(Math.abs(p.probabilityOver - 0.56) < 1e-12);
    assert.equal(await predictor.predict(target({})), null, 'no market and no model: nothing is invented');
    assert.equal(await predictor.predict(target({ sport: 'CURLING', marketOverProbability: 0.5 })), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a promoted model serves its regime, uses past games only, and keeps the adaptive projection', async () => {
  const dir = await tmp();
  try {
    const obs = league({ players: 80, games: 40 });
    const result = trainAndEvaluate(buildRows(obs));
    await writeObservations('NBA', obs, dir);
    await writeArtifact('NBA', { sport: 'NBA', version: 'global-logit-v1', weights: result.weights, regimes: { withMarket: true, withoutMarket: false },
      pushRates: {}, trainedAt: '2026-03-01T00:00:00.000Z', metrics: result.metrics }, dir);
    const predictor = createGlobalPredictor({ dir, clock: () => Date.parse('2026-03-01T00:00:00Z') });
    const p = await predictor.predict(target({ marketOverProbability: 0.55 }), { available: true, projection: 13.1 });
    assert.equal(p.sourceKind, 'global-model');
    assert.equal(p.projection, 13.1);
    assert.ok(p.inputs.historyGames > 0 && p.inputs.historyGames <= 30);
    assert.ok(Math.abs(p.probabilityOver + p.probabilityUnder + p.probabilityPush - 1) < 1e-9);
    assert.equal(p.validation.method, 'chronological-holdout-resolved-props');
    // The regime without a market was not promoted, so no estimate is made there.
    assert.equal(await predictor.predict(target({})), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('an integer line gets a push share and probabilities still sum to one', async () => {
  const dir = await tmp();
  try {
    const predictor = createGlobalPredictor({ dir });
    const p = await predictor.predict(target({ line: 12, marketOverProbability: 0.5 }));
    assert.ok(Math.abs(p.probabilityOver + p.probabilityUnder + p.probabilityPush - 1) < 1e-9);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the prediction target carries a valid market probability and drops an invalid one', () => {
  assert.equal(predictionTarget(target({ marketOverProbability: 0.6 })).marketOverProbability, 0.6);
  assert.equal('marketOverProbability' in predictionTarget(target({ marketOverProbability: 1.4 })), false);
  assert.equal('marketOverProbability' in predictionTarget(target({ marketOverProbability: '0.6' })), false);
});

test('the store prefers the global answer and falls back to adaptive when it has none', async () => {
  const future = '2030-01-01T00:00:00.000Z';
  const adaptiveHistory = { available: true, gameLog: Array.from({ length: 20 }, (_, i) => ({ gameId: 'g' + i, date: new Date(Date.parse('2026-01-01') + i * 86_400_000).toISOString(), value: 10 + (i % 5) })) };
  const global = { predict: async (t, base) => t.marketOverProbability ? { available: true, sourceKind: 'market-consensus', projection: base?.projection ?? null, probabilityOver: 0.5, probabilityUnder: 0.5, probabilityPush: 0 } : null };
  const store = createMLStore({ file: '/nonexistent/predictions.json', research: async () => adaptiveHistory, global });
  const withMarket = await store.lookup(target({ gameStartTime: future, marketOverProbability: 0.5 }));
  assert.equal(withMarket.sourceKind, 'market-consensus');
  assert.ok(Number.isFinite(withMarket.projection), 'the adaptive projection rides along');
  const without = await store.lookup(target({ gameStartTime: future }));
  assert.equal(without.sourceKind, 'verified-history-adaptive-model');
});

test('a name-only player id is never sent to research as a provider id', async () => {
  let seen = 'unset';
  const store = createMLStore({ file: '/nonexistent/predictions.json', research: async q => { seen = q.providerPlayerId; return { available: false }; } });
  await store.lookup(target({ playerId: 'name:player 3', gameStartTime: '2030-01-01T00:00:00.000Z' }));
  assert.equal(seen, undefined);
});

test('the export fetcher streams the CSV, sends the key as a header and reports the export budget', async () => {
  const { fetchResolvedWindow } = await import('../lib/ml/global/export.mjs');
  const previous = process.env.PROPLINE_API_KEY;
  process.env.PROPLINE_API_KEY = 'test-key';
  try {
    let seen = null;
    const fetcher = async (url, init) => {
      seen = { url: String(url), key: init.headers['x-api-key'] };
      const bytes = new TextEncoder().encode(sampleCsv);
      const body = new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 4096) c.enqueue(bytes.slice(i, i + 4096)); c.close(); } });
      return new Response(body, { status: 200, headers: { 'x-propline-export-daily-remaining': '97', 'x-propline-export-window-start': '2025-09-25T00:00:00Z' } });
    };
    const r = await fetchResolvedWindow({ sportKey: 'baseball_mlb', since: Date.parse('2026-09-18T00:00:00Z'), until: Date.parse('2026-09-25T00:00:00Z') }, { fetcher });
    assert.equal(r.ok, true);
    assert.ok(r.observations.length >= 5);
    assert.equal(r.meta.dailyRemaining, '97');
    assert.ok(!seen.url.includes('test-key'), 'the key never appears in the URL');
    assert.equal(seen.key, 'test-key');
    assert.match(seen.url, /sport=baseball_mlb/);

    const tooBig = await fetchResolvedWindow({ sportKey: 'baseball_mlb', maxGroups: 2 }, { fetcher });
    assert.equal(tooBig.code, 'EXPORT_WINDOW_TOO_LARGE', 'a window cut short is never stored');
    const wrong = await fetchResolvedWindow({ sportKey: 'baseball_mlb' }, { fetcher: async () => new Response('a,b\n1,2\n', { status: 200 }) });
    assert.equal(wrong.code, 'EXPORT_SCHEMA_UNRECOGNIZED');
    const capped = await fetchResolvedWindow({ sportKey: 'baseball_mlb' }, { fetcher: async () => new Response('{}', { status: 429 }) });
    assert.equal(capped.code, 'EXPORT_DAILY_CAP');
  } finally {
    if (previous === undefined) delete process.env.PROPLINE_API_KEY; else process.env.PROPLINE_API_KEY = previous;
  }
});
