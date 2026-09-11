// The accuracy work: a baseline computed from the log, a calibration step that
// reconciles the model against it, and a ledger that grades what was claimed.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'projection-accuracy-'));
process.env.DATA_DIR = dataDir;

const { projectionBaseline, weightedStats, empiricalOverRate, normalCdf, MIN_SAMPLE } = await import('../lib/projections/baseline.mjs');
const { calibrateProjection, modelWeight, coherent, MIN_MODEL_WEIGHT, MAX_MODEL_WEIGHT } = await import('../lib/projections/calibrate.mjs');
const ledger = await import('../lib/projections/ledger.mjs');

const log = (values, startIso = '2026-03-10T00:00:00.000Z') => values.map((value, index) => ({
  // Index 0 is the most recent game, so dates run backwards from the start.
  date: new Date(Date.parse(startIso) - index * 3 * 86_400_000).toISOString(),
  value,
}));

// --- baseline --------------------------------------------------------------

test('the weighted mean leans on recent games without ignoring old ones', () => {
  // Rising usage: the most recent games are the high ones.
  const stats = weightedStats([40, 38, 36, 20, 18, 16]);
  const plain = (40 + 38 + 36 + 20 + 18 + 16) / 6;
  assert.ok(stats.mean > plain, 'recency weighting must sit above the flat average here');
  assert.ok(stats.mean < 40, 'but must not collapse onto the single most recent game');
  assert.ok(stats.stdDev > 0);
});

test('the empirical rate is smoothed, so a perfect streak is not certainty', () => {
  const perfect = empiricalOverRate([30, 31, 32, 33, 34], 25);
  assert.equal(perfect.decided, 5);
  assert.ok(perfect.rate < 1, 'five from five is not 100%');
  assert.ok(perfect.rate > 0.8);
  // A push is excluded rather than counted as half.
  const withPush = empiricalOverRate([30, 25, 32], 25);
  assert.equal(withPush.decided, 2);
});

test('the baseline refuses to exist on too few games', () => {
  const thin = projectionBaseline({ gameLog: log([20, 22]), line: 21 });
  assert.equal(thin.available, false);
  assert.equal(thin.reason, 'INSUFFICIENT_GAMES');
  assert.ok(MIN_SAMPLE > 2);

  const noLine = projectionBaseline({ gameLog: log([20, 22, 24, 26, 28]), line: null });
  assert.equal(noLine.available, false);
  assert.equal(noLine.reason, 'NO_LINE');
});

test('the baseline agrees with itself: a line at the mean is close to a coin flip', () => {
  const values = [30, 28, 32, 29, 31, 30, 29, 31];
  const baseline = projectionBaseline({ gameLog: log(values), line: 30 });
  assert.equal(baseline.available, true);
  assert.ok(Math.abs(baseline.probabilityOver - 0.5) < 0.2, `expected near 0.5, got ${baseline.probabilityOver}`);
  assert.ok(baseline.plausibleLow < baseline.projection);
  assert.ok(baseline.plausibleHigh > baseline.projection);
});

test('a line far below the log reads as a high chance of going over', () => {
  const baseline = projectionBaseline({ gameLog: log([50, 48, 52, 49, 51, 47]), line: 20 });
  assert.ok(baseline.probabilityOver > 0.85, `expected a strong over, got ${baseline.probabilityOver}`);
});

test('the normal CDF is right at the points we can check by hand', () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 1e-3);
  assert.ok(Math.abs(normalCdf(-1.96) - 0.025) < 1e-3);
});

// --- calibration -----------------------------------------------------------

test('confidence sets how much of its own answer the model keeps', () => {
  assert.equal(modelWeight(0), MIN_MODEL_WEIGHT);
  assert.equal(modelWeight(100), MAX_MODEL_WEIGHT);
  assert.ok(modelWeight(50) > MIN_MODEL_WEIGHT && modelWeight(50) < MAX_MODEL_WEIGHT);
  // Missing confidence is treated as no confidence, not as full confidence.
  assert.equal(modelWeight(null), MIN_MODEL_WEIGHT);
});

test('a projection above the line with a probability below even is incoherent', () => {
  assert.equal(coherent({ projection: 35, probabilityOver: 0.4, line: 30 }), false);
  assert.equal(coherent({ projection: 35, probabilityOver: 0.7, line: 30 }), true);
  assert.equal(coherent({ projection: 25, probabilityOver: 0.3, line: 30 }), true);
  // Incoherence costs confidence rather than being silently accepted.
  const gameLog = log([30, 31, 29, 30, 32, 28]);
  const result = calibrateProjection({ projection: 35, probability_over: 0.4, confidence: 80 }, { gameLog, line: 30 });
  assert.ok(result.confidence < 80);
  assert.equal(result.calibration.coherent, false);
});

test('a wild projection is pulled back to the band the log supports', () => {
  const gameLog = log([30, 31, 29, 30, 32, 28, 30, 31]);
  const baseline = projectionBaseline({ gameLog, line: 30 });
  const wild = calibrateProjection({ projection: 200, probability_over: 0.99, confidence: 90 }, { gameLog, line: 30 });
  assert.equal(wild.calibration.clamped, true);
  assert.ok(wild.projection <= baseline.plausibleHigh, 'must not exceed the plausible band');
  assert.ok(wild.projection < 100);
  // Being clamped also costs confidence: the answer was unsupported.
  assert.ok(wild.confidence < 90);
});

test('a confident model keeps more of its answer than a hesitant one', () => {
  const gameLog = log([30, 31, 29, 30, 32, 28, 30, 31]);
  const market = { gameLog, line: 30 };
  const baseline = projectionBaseline(market);
  const confident = calibrateProjection({ projection: 34, probability_over: 0.75, confidence: 95 }, market);
  const hesitant = calibrateProjection({ projection: 34, probability_over: 0.75, confidence: 10 }, market);
  assert.ok(confident.projection > hesitant.projection, 'the hesitant answer must sit closer to the baseline');
  assert.ok(Math.abs(hesitant.projection - baseline.projection) < Math.abs(confident.projection - baseline.projection));
  // And neither is ever the raw model number, nor the raw baseline.
  assert.notEqual(confident.projection, 34);
  assert.notEqual(confident.projection, baseline.projection);
});

test('with too short a log nothing is blended and the model stands alone', () => {
  const result = calibrateProjection({ projection: 34, probability_over: 0.75, confidence: 80 }, { gameLog: log([30, 31]), line: 30 });
  assert.equal(result.calibration.applied, false);
  assert.equal(result.projection, 34);
  assert.equal(result.probabilityOver, 0.75);
});

test('the calibration block reports exactly what it changed', () => {
  const gameLog = log([30, 31, 29, 30, 32, 28]);
  const result = calibrateProjection({ projection: 33, probability_over: 0.7, confidence: 60 }, { gameLog, line: 30 });
  const c = result.calibration;
  assert.equal(c.applied, true);
  assert.equal(c.modelProjection, 33);
  assert.equal(c.modelProbabilityOver, 0.7);
  assert.ok(Number.isFinite(c.baselineProjection));
  assert.ok(Number.isFinite(c.modelWeight));
  assert.equal(c.sampleSize, 6);
  // Probabilities stay inside a range that can actually be priced.
  assert.ok(result.probabilityOver > 0 && result.probabilityOver < 1);
});

// --- ledger ----------------------------------------------------------------

test('a projection is recorded, then graded from a real game log', async () => {
  ledger.resetLedgerCache();
  await fs.rm(path.join(dataDir, 'projection-ledger.json'), { force: true });

  await ledger.recordProjection(
    { line: 30.5, projection: 33.1, probabilityOver: 0.68, confidence: 70, pick: 'LEAN OVER', side: 'OVER', ev: 4.2 },
    { sport: 'NFL', playerName: 'Test Player', market: 'Receiving Yards' },
  );
  let report = await ledger.accuracyReport({ minGraded: 1 });
  assert.equal(report.recorded, 1);
  assert.equal(report.graded, 0);
  assert.equal(report.awaitingResult, 1);

  // The game is played and lands over.
  await ledger.gradeFromGameLog({
    sport: 'NFL', playerName: 'Test Player', market: 'Receiving Yards',
    gameLog: [{ date: new Date(Date.now() + 86_400_000).toISOString(), value: 41 }],
  });
  report = await ledger.accuracyReport({ minGraded: 1 });
  assert.equal(report.graded, 1);
  assert.equal(report.calledPicks, 1);
  assert.equal(report.hitRate, 100);
  assert.equal(report.meanAbsoluteError, Number(Math.abs(33.1 - 41).toFixed(2)));
});

test('a rate is withheld until enough picks have been graded', async () => {
  ledger.resetLedgerCache();
  await fs.rm(path.join(dataDir, 'projection-ledger.json'), { force: true });
  await ledger.recordProjection(
    { line: 20, projection: 25, probabilityOver: 0.7, confidence: 60, pick: 'LEAN OVER', side: 'OVER' },
    { sport: 'NBA', playerName: 'Thin Sample', market: 'Points' },
  );
  await ledger.gradeFromGameLog({
    sport: 'NBA', playerName: 'Thin Sample', market: 'Points',
    gameLog: [{ date: new Date(Date.now() + 86_400_000).toISOString(), value: 26 }],
  });
  const report = await ledger.accuracyReport();
  assert.equal(report.graded, 1);
  assert.equal(report.sufficient, false);
  assert.equal(report.hitRate, null, 'one pick is not a hit rate');
  assert.equal(report.brierScore, null);
  assert.ok(report.minimumForRate >= 20);
});

test('a game outside the match window does not settle the projection', async () => {
  ledger.resetLedgerCache();
  await fs.rm(path.join(dataDir, 'projection-ledger.json'), { force: true });
  await ledger.recordProjection(
    { line: 10, projection: 12, probabilityOver: 0.6, confidence: 50, pick: 'LEAN OVER', side: 'OVER' },
    { sport: 'NHL', playerName: 'Late Game', market: 'Shots' },
  );
  // A log entry from long before the projection, and one from long after.
  await ledger.gradeFromGameLog({
    sport: 'NHL', playerName: 'Late Game', market: 'Shots',
    gameLog: [
      { date: new Date(Date.now() - 30 * 86_400_000).toISOString(), value: 14 },
      { date: new Date(Date.now() + 60 * 86_400_000).toISOString(), value: 3 },
    ],
  });
  const report = await ledger.accuracyReport({ minGraded: 1 });
  assert.equal(report.graded, 0, 'neither game belongs to this projection');
});

test('re-asking the same prop replaces the open claim instead of stacking it', async () => {
  ledger.resetLedgerCache();
  await fs.rm(path.join(dataDir, 'projection-ledger.json'), { force: true });
  const subject = { sport: 'MLB', playerName: 'Repeat Ask', market: 'Total Bases' };
  await ledger.recordProjection({ line: 1.5, projection: 1.8, probabilityOver: 0.55, confidence: 40, pick: 'PASS', side: null }, subject);
  await ledger.recordProjection({ line: 1.5, projection: 2.1, probabilityOver: 0.62, confidence: 55, pick: 'LEAN OVER', side: 'OVER' }, subject);
  const report = await ledger.accuracyReport({ minGraded: 1 });
  assert.equal(report.recorded, 1, 'the second ask replaces the first');
});

test('a PASS makes no claim, so it never flatters the hit rate', async () => {
  ledger.resetLedgerCache();
  await fs.rm(path.join(dataDir, 'projection-ledger.json'), { force: true });
  await ledger.recordProjection(
    { line: 5, projection: 5.1, probabilityOver: 0.51, confidence: 30, pick: 'PASS', side: null },
    { sport: 'WNBA', playerName: 'No Call', market: 'Assists' },
  );
  await ledger.gradeFromGameLog({
    sport: 'WNBA', playerName: 'No Call', market: 'Assists',
    gameLog: [{ date: new Date(Date.now() + 86_400_000).toISOString(), value: 9 }],
  });
  const report = await ledger.accuracyReport({ minGraded: 1 });
  assert.equal(report.graded, 1);
  assert.equal(report.calledPicks, 0, 'a PASS is graded for error but never counted as a win');
  assert.equal(report.hitRate, null);
});

test.after(async () => { await fs.rm(dataDir, { recursive: true, force: true }); });

// --- the payload the model actually receives -------------------------------

test('the payload carries a baseline built from the same log the model sees', async () => {
  const { buildModelPayload } = await import('../lib/projections/service.mjs');
  const payload = buildModelPayload({
    sport: 'NFL',
    playerName: 'Anchor Test',
    market: 'Receiving Yards',
    line: 30.5,
    gameLog: log([41, 28, 35, 33, 26, 38, 30, 44]),
  });
  assert.equal(payload.baseline.available, true);
  assert.equal(payload.baseline.sampleSize, 8);
  assert.ok(Number.isFinite(payload.baseline.projection));
  assert.ok(payload.baseline.probabilityOver > 0 && payload.baseline.probabilityOver < 1);
  // The baseline must be derived from the same bounded log, not the raw input,
  // so the model cannot be shown an anchor it was not given the data for.
  assert.equal(payload.baseline.sampleSize, payload.gameLog.length);
});

test('a short log produces an unavailable baseline rather than a made-up one', async () => {
  const { buildModelPayload } = await import('../lib/projections/service.mjs');
  const payload = buildModelPayload({
    sport: 'NBA', playerName: 'Thin', market: 'Points', line: 20,
    gameLog: log([22, 19]),
  });
  assert.equal(payload.baseline.available, false);
  assert.equal(payload.baseline.reason, 'INSUFFICIENT_GAMES');
});

test('the cache key ignores a one-cent price tick but not a real price move', async () => {
  const { effort } = await import('../lib/projections/providers/anthropic.mjs');
  // Effort is an Anthropic-side setting now; it is reported for owner
  // diagnostics, never to customers.
  assert.ok(['low', 'medium', 'high', 'xhigh', 'max'].includes(effort({})));

  const service = await fs.readFile(new URL('../lib/projections/service.mjs', import.meta.url), 'utf8');
  assert.match(service, /bucketPrice\(input\.overPrice\)/);
  assert.match(service, /bucketPrice\(input\.underPrice\)/);
  // The line itself must stay exact: a different line is a different bet.
  assert.match(service, /input\.market, input\.line,/);
});

// --- the request shape the SDK actually accepts -----------------------------
// Verified against @anthropic-ai/sdk 0.125.0. These are the settings that would
// fail on the FIRST real call rather than at edit time, which is exactly the
// kind of breakage a test should hold still — this path has never run against
// the live model, so nothing else is watching it.

test('the projection request matches the SDK surface it was written against', async () => {
  const service = await fs.readFile(new URL('../lib/projections/providers/anthropic.mjs', import.meta.url), 'utf8');

  // Structured outputs go through parse(), not create() plus hand-parsing.
  assert.match(service, /messages\.parse\(/);
  assert.match(service, /jsonSchemaOutputFormat\(schema\)/);
  assert.match(service, /from '@anthropic-ai\/sdk\/helpers\/json-schema'/);

  // Effort belongs inside output_config; at the top level it is ignored.
  assert.match(service, /output_config: \{ effort: effort\(\), format:/);

  // temperature is rejected outright on this model family. Match a request
  // field rather than the bare word, which also appears in the comment saying
  // why it is not sent.
  assert.doesNotMatch(service, /^\s*temperature\s*:/m);
  // Thinking is on by default here; passing a budget is a 400.
  assert.doesNotMatch(service, /^\s*budget_tokens\s*:/m);

  // An exact model id, with no date suffix appended.
  assert.match(service, /'claude-opus-5'/);
  assert.doesNotMatch(service, /claude-opus-5-\d{8}/);
});

test('the token ceiling and timeout leave room for a high-effort answer', async () => {
  const provider = await fs.readFile(new URL('../lib/projections/providers/anthropic.mjs', import.meta.url), 'utf8');
  const service = await fs.readFile(new URL('../lib/projections/service.mjs', import.meta.url), 'utf8');

  const maxTokens = Number(provider.match(/const MAX_TOKENS = (\d+)/)[1]);
  // Thinking tokens count against this, and the response now carries four
  // written sections. Too low and the answer truncates, which fails the call.
  assert.ok(maxTokens >= 16000, `max_tokens ${maxTokens} risks truncation at high effort`);

  const timeout = Number(service.match(/const REQUEST_TIMEOUT_MS = ([\d_]+)/)[1].replace(/_/g, ''));
  // An abort does not refund the request, so waiting is cheaper than retrying.
  assert.ok(timeout >= 120_000, `timeout ${timeout}ms is short for a high-effort turn`);
});
