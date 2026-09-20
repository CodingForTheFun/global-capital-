import test from 'node:test';
import assert from 'node:assert/strict';
import { createTypeSafeClient, verifyTypeSafeConnection } from '../lib/typesafe.ts';

test('missing key makes no provider call', async () => {
  assert.equal(createTypeSafeClient('  '), null);
  assert.deepEqual(await verifyTypeSafeConnection(null), { status: 'not_configured' });
});

test('uses official endpoint and a synthetic bounded request', async () => {
  let calls = 0;
  const client = createTypeSafeClient('test-secret', async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer test-secret');
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'jev-latest');
    assert.equal(body.state.message, 'This is an Oblige Props connection test.');
    assert.equal(JSON.stringify(body).includes('test-secret'), false);
    return Response.json({ model: 'jev-latest', answers: { purpose: {
      type: 'choice', choice: 'connection_test', confidence: 1,
      probabilities: { connection_test: 1, other: 0 },
    } }, usage: { input_tokens: 20, output_tokens: 5 } });
  });
  assert.equal(client.timeout, 8000);
  assert.deepEqual(await verifyTypeSafeConnection(client), { status: 'connected' });
  assert.equal(calls, 1);
});

for (const [code, status] of [[401, 'authentication_failed'], [429, 'rate_limited'], [503, 'unavailable']]) {
  test(`HTTP ${code} is sanitized and never retried`, async () => {
    let calls = 0;
    const client = createTypeSafeClient('test-secret', async () => {
      calls++;
      return Response.json({ error: 'test-secret' }, { status: code });
    });
    assert.deepEqual(await verifyTypeSafeConnection(client), { status });
    assert.equal(calls, 1);
  });
}

test('malformed answer cannot be reported as connected', async () => {
  const client = createTypeSafeClient('test-secret', async () => Response.json({ answers: {} }));
  assert.notEqual((await verifyTypeSafeConnection(client)).status, 'connected');
});
