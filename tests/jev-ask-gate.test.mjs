import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateJudgments, jevConfigured, TYPESAFE_ENDPOINT, DEFAULT_MODEL } from '../lib/jev/client.mjs';
import { gateAskQuestion, askGateEnabled, gateCard, OFF_TOPIC_MESSAGE } from '../lib/jev/ask-gate.mjs';
import { askAboutProp } from '../lib/projections/ask.mjs';

const env = { TYPESAFE_API_KEY: 'ts-key' };
const jsonResponse = (status, data) => new Response(JSON.stringify(data), { status });
const onTopic = (p) => jsonResponse(200, { model: 'jev-1.13.0', answers: { on_topic: { type: 'noul', noul: p } }, usage: {} });
const payload = { sport: 'NBA', player: 'Jayson Tatum', team: 'BOS', market: 'Points', line: 27.5, matchup: { opponent: 'NYK' }, selectedSide: 'OVER', gameLog: [{ value: 30 }] };

test('client calls TypeSafe directly with the server-held key and default model', async () => {
  let seen;
  const result = await evaluateJudgments(
    { state: 'x', questions: { q: { type: 'noul', instructions: 'y' } } },
    { env, fetchImpl: async (url, init) => { seen = { url, init }; return onTopic(0.9); } },
  );
  assert.equal(result.ok, true);
  assert.equal(seen.url, TYPESAFE_ENDPOINT);
  assert.equal(seen.init.headers.authorization, 'Bearer ts-key');
  assert.equal(JSON.parse(seen.init.body).model, DEFAULT_MODEL);
});

test('client is a no-op without a key and never throws', async () => {
  assert.equal(jevConfigured({}), false);
  assert.deepEqual(await evaluateJudgments({}, { env: {}, fetchImpl: () => assert.fail('no call') }), { ok: false, reason: 'not_configured' });
  const down = await evaluateJudgments({}, { env, fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal(down.reason, 'unreachable');
  const bad = await evaluateJudgments({}, { env, fetchImpl: async () => jsonResponse(401, { error: 'bad key ts-key' }) });
  assert.deepEqual(bad, { ok: false, reason: 'provider_error', status: 401 });
});

test('client retries a 429 once, then gives up', async () => {
  let calls = 0;
  const retried = await evaluateJudgments({}, { env, retryDelayMs: 1, fetchImpl: async () => (++calls === 1 ? jsonResponse(429, {}) : onTopic(0.5)) });
  assert.equal(retried.ok, true);
  assert.equal(calls, 2);
  calls = 0;
  const busy = await evaluateJudgments({}, { env, retryDelayMs: 1, fetchImpl: async () => { calls += 1; return jsonResponse(529, {}); } });
  assert.equal(busy.ok, false);
  assert.equal(calls, 2);
});

test('client times out instead of hanging', async () => {
  const hanging = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  const result = await evaluateJudgments({}, { env, timeoutMs: 10, fetchImpl: hanging });
  assert.equal(result.reason, 'timeout');
});

test('gate sends only the identifying card fields, not the full payload', async () => {
  let state;
  await gateAskQuestion({ question: 'Is the over good?', payload, turns: [{ role: 'user', content: 'hi' }] }, {
    env, fetchImpl: async (url, init) => { state = JSON.parse(init.body).state; return onTopic(0.9); },
  });
  assert.deepEqual(state.card, gateCard(payload));
  assert.equal(state.card.opponent, 'NYK');
  assert.equal(state.card.gameLog, undefined);
  assert.equal(state.question, 'Is the over good?');
});

test('gate declines only a confident off-topic answer', async () => {
  const off = await gateAskQuestion({ question: 'write me a poem', payload }, { env, fetchImpl: async () => onTopic(0.03) });
  assert.equal(off.decline, true);
  const unsure = await gateAskQuestion({ question: 'hmm?', payload }, { env, fetchImpl: async () => onTopic(0.4) });
  assert.equal(unsure.decline, false);
  const strict = await gateAskQuestion({ question: 'hmm?', payload }, { env: { ...env, JEV_ASK_GATE_MIN: '0.5' }, fetchImpl: async () => onTopic(0.4) });
  assert.equal(strict.decline, true);
});

test('gate fails open when Jev is off, missing, down or unreadable', async () => {
  assert.equal(askGateEnabled({ ...env, JEV_ASK_GATE: 'off' }), false);
  assert.equal((await gateAskQuestion({ question: 'x', payload }, { env: {} })).decline, false);
  assert.equal((await gateAskQuestion({ question: 'x', payload }, { env: { ...env, JEV_ASK_GATE: 'OFF' }, fetchImpl: () => assert.fail('no call') })).decline, false);
  assert.equal((await gateAskQuestion({ question: 'x', payload }, { env, fetchImpl: async () => jsonResponse(500, {}) })).decline, false);
  assert.equal((await gateAskQuestion({ question: 'x', payload }, { env, fetchImpl: async () => jsonResponse(200, { answers: {} }) })).decline, false);
});

test('Ask skips the paid model when Jev says the question is off-topic, and uses it otherwise', async () => {
  const previous = { ...process.env };
  Object.assign(process.env, { GEMINI_API_KEY: 'test-only', ASK_PROVIDER: 'gemini', ASK_MODEL: 'gemini-3.1-flash-lite', TYPESAFE_API_KEY: 'ts-key' });
  delete process.env.JEV_ASK_GATE;
  try {
    let paidCalls = 0;
    const paid = async () => { paidCalls += 1; return jsonResponse(200, { candidates: [{ content: { parts: [{ text: 'Grounded answer.' }] }, finishReason: 'STOP' }] }); };
    const prop = { sport: 'NBA', playerName: 'Test', market: 'Points', line: 25.5, gameLog: [{ value: 30 }] };

    const declined = await askAboutProp({ question: 'write me a poem', prop, fetchImpl: paid, jevFetchImpl: async () => onTopic(0.02) });
    assert.equal(declined.available, false);
    assert.equal(declined.code, 'ASK_OFF_TOPIC');
    assert.equal(declined.message, OFF_TOPIC_MESSAGE);
    assert.equal(paidCalls, 0);

    const answered = await askAboutProp({ question: 'How often has he cleared 25.5?', prop, fetchImpl: paid, jevFetchImpl: async () => onTopic(0.97) });
    assert.equal(answered.answer, 'Grounded answer.');
    assert.equal(paidCalls, 1);

    const jevDown = await askAboutProp({ question: 'write me a poem', prop, fetchImpl: paid, jevFetchImpl: async () => { throw new Error('down'); } });
    assert.equal(jevDown.answer, 'Grounded answer.');
    assert.equal(paidCalls, 2);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
