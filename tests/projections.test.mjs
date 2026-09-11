import test from 'node:test';
import assert from 'node:assert/strict';
import {
  americanOddsToPayout, impliedProbability, expectedValuePercent,
  pickLabel, deriveProjection, PROJECTION_OUTPUT_SCHEMA,
} from '../lib/projections/schema.mjs';
import { DEFAULT_PROJECTION_SYSTEM_PROMPT, projectionSystemPrompt, projectionPromptSource } from '../lib/projections/system-prompt.mjs';
import { buildModelPayload, projectionsConfigured, projectionHealth } from '../lib/projections/service.mjs';

test('American odds convert to payout and implied probability', () => {
  assert.equal(americanOddsToPayout(100), 1);
  assert.equal(americanOddsToPayout(-110).toFixed(4), '0.9091');
  assert.equal(americanOddsToPayout(150), 1.5);
  assert.equal(impliedProbability(-110).toFixed(4), '0.5238');
  assert.equal(impliedProbability(100), 0.5);
  assert.equal(impliedProbability(150).toFixed(4), '0.4000');
  // No price is not a 50/50 shot.
  assert.equal(americanOddsToPayout(null), null);
  assert.equal(impliedProbability(''), null);
  assert.equal(americanOddsToPayout(0), null);
});

test('expected value is break-even exactly at the price-implied probability', () => {
  // Betting -110 at its own implied probability must return ~0% EV.
  assert.equal(Math.abs(expectedValuePercent(impliedProbability(-110), -110)) < 0.01, true);
  assert.equal(expectedValuePercent(0.6, -110), 14.55);
  assert.equal(expectedValuePercent(0.4, -110), -23.64);
  // A missing price yields null, not a break-even bet.
  assert.equal(expectedValuePercent(0.6, null), null);
  assert.equal(expectedValuePercent(null, -110), null);
  assert.equal(expectedValuePercent(1.4, -110), null);
});

test('a large edge on thin evidence is a PASS, not a strong play', () => {
  assert.equal(pickLabel({ evOver: 12, evUnder: -20, confidence: 80 }), 'STRONG OVER');
  assert.equal(pickLabel({ evOver: 3, evUnder: -8, confidence: 55 }), 'LEAN OVER');
  assert.equal(pickLabel({ evOver: -20, evUnder: 12, confidence: 80 }), 'STRONG UNDER');
  assert.equal(pickLabel({ evOver: -20, evUnder: 3, confidence: 55 }), 'LEAN UNDER');
  // Same 12% edge, confidence too low to earn a label.
  assert.equal(pickLabel({ evOver: 12, evUnder: -20, confidence: 30 }), 'PASS');
  assert.equal(pickLabel({ evOver: 1, evUnder: -3, confidence: 90 }), 'PASS');
  assert.equal(pickLabel({ evOver: 12, evUnder: -20, confidence: null }), 'PASS');
  assert.equal(pickLabel({ evOver: null, evUnder: null, confidence: 80 }), 'PASS');
});

test('a model response becomes a card payload with reproducible arithmetic', () => {
  const derived = deriveProjection(
    { projection: 78.4, probability_over: 0.62, confidence: 71, primary_driver: 'Averaging 84.2 over the last five.', data_gaps: ['opponentDefenseRank'] },
    { line: 63.5, overPrice: -115, underPrice: -105 },
  );
  assert.equal(derived.projection, 78.4);
  assert.equal(derived.edge, 14.9);
  assert.equal(derived.edgePercent, 23.5);
  assert.equal(derived.probabilityUnder, 0.38);
  assert.equal(derived.pick, 'STRONG OVER');
  assert.equal(derived.side, 'OVER');
  assert.equal(derived.ev, derived.evOver);
  assert.ok(derived.evOver > 0 && derived.evUnder < 0);
  assert.deepEqual(derived.dataGaps, ['opponentDefenseRank']);
  assert.equal(derived.confidence, 71);
});

test('an unusable model response yields no card rather than a zeroed one', () => {
  assert.equal(deriveProjection({ projection: null, probability_over: 0.6 }, { line: 10 }), null);
  assert.equal(deriveProjection({ projection: 12, probability_over: null }, { line: 10 }), null);
  // A probability outside [0,1] is not clamped into a plausible-looking number.
  assert.equal(deriveProjection({ projection: 12, probability_over: 1.4 }, { line: 10 }), null);
  // Without a price there is no expected value, so no label is claimed.
  const noPrice = deriveProjection({ projection: 12, probability_over: 0.9, confidence: 90, data_gaps: [] }, { line: 10 });
  assert.equal(noPrice.ev, null);
  assert.equal(noPrice.pick, 'PASS');
  assert.equal(noPrice.edge, 2);
});

test('the model payload is bounded and drops anything not named', () => {
  const payload = buildModelPayload({
    sport: 'NFL', playerName: 'A Player', market: 'Reception Yards', line: '63.5',
    overPrice: -115, gameLog: Array.from({ length: 80 }, (_, i) => ({ date: '2026-01-01', value: i })),
    windows: { l5: { average: 84.2, games: 5, hitRate: 80 }, season: { average: null } },
    notes: 'x'.repeat(900), secretField: 'must not survive', injuryStatus: 'Questionable',
  });
  assert.equal(payload.gameLog.length, 25);
  assert.equal(payload.line, 63.5);
  assert.equal(payload.windows.l5.average, 84.2);
  // A window with no average carries no information and is dropped.
  assert.equal('season' in payload.windows, false);
  assert.equal(payload.context.notes.length, 400);
  assert.equal(payload.context.injuryStatus, 'Questionable');
  assert.equal('secretField' in payload, false);
  assert.equal(payload.context.opponentDefenseRank, null);
});

test('the output schema is strict so the model cannot invent extra fields', () => {
  assert.equal(PROJECTION_OUTPUT_SCHEMA.additionalProperties, false);
  assert.deepEqual(
    PROJECTION_OUTPUT_SCHEMA.required,
    ['projection', 'probability_over', 'confidence', 'primary_driver', 'data_gaps'],
  );
  // The caller derives EV and the pick; the model must not supply them.
  assert.equal('ev_percent' in PROJECTION_OUTPUT_SCHEMA.properties, false);
  assert.equal('pick' in PROJECTION_OUTPUT_SCHEMA.properties, false);
});

test('the prompt is overridable from the environment and reports its source', () => {
  const original = process.env.PROJECTION_SYSTEM_PROMPT;
  try {
    delete process.env.PROJECTION_SYSTEM_PROMPT;
    assert.equal(projectionSystemPrompt(), DEFAULT_PROJECTION_SYSTEM_PROMPT);
    assert.equal(projectionPromptSource(), 'built-in-placeholder');
    process.env.PROJECTION_SYSTEM_PROMPT = 'Replaced by the operator.';
    assert.equal(projectionSystemPrompt(), 'Replaced by the operator.');
    assert.equal(projectionPromptSource(), 'environment');
  } finally {
    if (original === undefined) delete process.env.PROJECTION_SYSTEM_PROMPT;
    else process.env.PROJECTION_SYSTEM_PROMPT = original;
  }
});

test('the prompt forbids fabrication and keeps arithmetic out of the model', () => {
  const prompt = DEFAULT_PROJECTION_SYSTEM_PROMPT;
  assert.match(prompt, /never fill one in/i);
  assert.match(prompt, /Never invent a statistic/i);
  assert.match(prompt, /Do not compute expected value/i);
  assert.match(prompt, /data_gaps/);
});

test('projections stay dormant without a key and never fall back to a guess', async () => {
  const original = process.env.ANTHROPIC_API_KEY;
  try {
    delete process.env.ANTHROPIC_API_KEY;
    assert.equal(projectionsConfigured(), false);
    assert.equal(projectionHealth().configured, false);
    const { projectPlayerProp } = await import('../lib/projections/service.mjs');
    const result = await projectPlayerProp({ sport: 'NFL', playerName: 'A Player', market: 'Rush Yards', line: 40.5 });
    assert.equal(result.available, false);
    assert.equal(result.code, 'PROJECTION_NOT_CONFIGURED');
    assert.equal('projection' in result, false);
  } finally {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
  }
});
