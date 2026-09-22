import test from 'node:test';
import assert from 'node:assert/strict';

import { handleEvaluate, handleHealth, TYPESAFE_ENDPOINT, DEFAULT_MODEL } from '../services/jev-gateway/lib/gateway.js';
import { evaluateJudgments, jevGatewayConfigured } from '../lib/jev/client.mjs';

const env = { JEV_GATEWAY_SECRET: 'shared-secret', TYPESAFE_API_KEY: 'ts-key' };
const auth = { authorization: 'Bearer shared-secret' };
const body = {
  state: { a: 'Jayson Tatum (BOS)', b: 'J. Tatum - Celtics' },
  questions: { same_player: { type: 'noul', instructions: 'Do `a` and `b` refer to the same player?' } },
};
const okAnswer = { model: 'jev-1.13.0', answers: { same_player: { type: 'noul', noul: 0.97 } }, usage: { input_tokens: 10, output_tokens: 2 } };
const jsonResponse = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

test('gateway forwards an authorized request with the server-held key and default model', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return jsonResponse(200, okAnswer); };
  const result = await handleEvaluate({ method: 'POST', headers: auth, body }, { env, fetchImpl });
  assert.equal(result.status, 200);
  assert.equal(result.body.answers.same_player.noul, 0.97);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, TYPESAFE_ENDPOINT);
  assert.equal(calls[0].init.headers.authorization, 'Bearer ts-key');
  assert.equal(JSON.parse(calls[0].init.body).model, DEFAULT_MODEL);
});

test('gateway rejects missing or wrong shared secret without calling TypeSafe', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return jsonResponse(200, okAnswer); };
  for (const headers of [{}, { authorization: 'Bearer nope' }, { authorization: 'shared-secret' }]) {
    const result = await handleEvaluate({ method: 'POST', headers, body }, { env, fetchImpl });
    assert.equal(result.status, 401);
  }
  assert.equal(called, false);
});

test('gateway fails closed when secrets are not configured', async () => {
  const noSecret = await handleEvaluate({ method: 'POST', headers: auth, body }, { env: { TYPESAFE_API_KEY: 'k' } });
  assert.equal(noSecret.status, 503);
  const noKey = await handleEvaluate({ method: 'POST', headers: auth, body }, { env: { JEV_GATEWAY_SECRET: 'shared-secret' } });
  assert.equal(noKey.status, 503);
});

test('gateway validates request shape', async () => {
  const bad = [
    { questions: body.questions },
    { state: 'x', questions: {} },
    { state: 'x', questions: { q: { type: 'freeform', instructions: 'x' } } },
    { state: 'x', questions: { q: { type: 'choice', instructions: 'x' } } },
  ];
  for (const candidate of bad) {
    const result = await handleEvaluate({ method: 'POST', headers: auth, body: candidate }, { env, fetchImpl: async () => assert.fail('should not call') });
    assert.equal(result.status, 422);
  }
  const notJson = await handleEvaluate({ method: 'POST', headers: auth, body: '{nope' }, { env });
  assert.equal(notJson.status, 400);
  const wrongMethod = await handleEvaluate({ method: 'GET', headers: auth }, { env });
  assert.equal(wrongMethod.status, 405);
});

test('gateway retries 429/529 then succeeds, and never leaks the key on failure', async () => {
  const statuses = [429, 529, 200];
  const fetchImpl = async () => { const s = statuses.shift(); return jsonResponse(s, s === 200 ? okAnswer : { error: 'busy' }); };
  const result = await handleEvaluate({ method: 'POST', headers: auth, body }, { env, fetchImpl, baseDelayMs: 1 });
  assert.equal(result.status, 200);

  const failing = await handleEvaluate({ method: 'POST', headers: auth, body }, { env, fetchImpl: async () => jsonResponse(401, { error: 'bad key ts-key' }), baseDelayMs: 1 });
  assert.equal(failing.status, 502);
  assert.doesNotMatch(JSON.stringify(failing.body), /ts-key/);
});

test('gateway health reports configuration without exposing values', () => {
  const { body: health } = handleHealth({ env });
  assert.deepEqual(health, { ok: true, service: 'jev-gateway', typesafeKeyConfigured: true, gatewaySecretConfigured: true });
});

test('client is a no-op when the gateway is not configured', async () => {
  assert.equal(jevGatewayConfigured({}), false);
  const result = await evaluateJudgments(body, { env: {}, fetchImpl: async () => assert.fail('should not call') });
  assert.deepEqual(result, { ok: false, reason: 'not_configured' });
});

test('client calls the gateway with the shared secret and returns answers', async () => {
  const clientEnv = { JEV_GATEWAY_URL: 'https://jev.example.vercel.app/', JEV_GATEWAY_SECRET: 'shared-secret' };
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return jsonResponse(200, okAnswer); };
  const result = await evaluateJudgments(body, { env: clientEnv, fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.answers.same_player.noul, 0.97);
  assert.equal(seen.url, 'https://jev.example.vercel.app/api/evaluate');
  assert.equal(seen.init.headers.authorization, 'Bearer shared-secret');
});

test('client degrades instead of throwing on gateway errors and timeouts', async () => {
  const clientEnv = { JEV_GATEWAY_URL: 'https://jev.example', JEV_GATEWAY_SECRET: 's' };
  const errored = await evaluateJudgments(body, { env: clientEnv, fetchImpl: async () => jsonResponse(503, { error: 'down' }) });
  assert.equal(errored.ok, false);
  assert.equal(errored.reason, 'gateway_error');

  const hanging = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const timedOut = await evaluateJudgments(body, { env: clientEnv, fetchImpl: hanging, timeoutMs: 10 });
  assert.equal(timedOut.reason, 'timeout');

  const unreachable = await evaluateJudgments(body, { env: clientEnv, fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal(unreachable.reason, 'unreachable');
});
