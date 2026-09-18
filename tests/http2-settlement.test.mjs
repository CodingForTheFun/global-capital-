import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { __requestOnce } from '../lib/ingestion/http2-json-fetch.mjs';

function connection(action = () => {}) {
  const req = new EventEmitter(), client = new EventEmitter();
  let destroyed = 0, requestDestroyed = 0;
  req.end = () => queueMicrotask(() => action(req, client));
  req.destroy = () => { requestDestroyed++; req.emit('close'); };
  client.request = () => req;
  client.destroy = () => { destroyed++; client.emit('close'); };
  return { client, req, connect: () => client, counts: () => ({ destroyed, requestDestroyed }) };
}

test('silent HTTP/2 peer explicitly times out and destroys both stream and session', async () => {
  const c = connection();
  await assert.rejects(__requestOnce('https://example.invalid/data', { connect: c.connect, timeoutMs: 15 }), { code: 'PUBLIC_HTTP2_TIMEOUT' });
  assert.deepEqual(c.counts(), { destroyed: 1, requestDestroyed: 1 });
  // Destruction can be followed by a transport error: it must be consumed.
  c.req.emit('error', new Error('late stream')); c.client.emit('error', new Error('late session'));
});

for (const type of ['stream-close', 'session-close', 'session-error']) {
  test(`HTTP/2 ${type} cannot leave the response promise pending`, async () => {
    const c = connection((req, client) => {
      if (type === 'session-error') client.emit('error', Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }));
      else (type === 'stream-close' ? req : client).emit('close');
    });
    await assert.rejects(__requestOnce('https://example.invalid/data', { connect: c.connect, timeoutMs: 500 }), {
      code: type === 'session-error' ? 'ECONNREFUSED' : 'PUBLIC_HTTP2_PREMATURE_CLOSE',
    });
    assert.deepEqual(c.counts(), { destroyed: 1, requestDestroyed: 1 });
  });
}

test('HTTP/2 success preserves headers and body, then releases the owned connection', async () => {
  const c = connection(req => { req.emit('response', { ':status': 200 }); req.emit('data', Buffer.from('{"ok":true}')); req.emit('end'); });
  const result = await __requestOnce('https://example.invalid/data', { connect: c.connect, timeoutMs: 500 });
  assert.equal(result.headers[':status'], 200); assert.equal(result.body.toString(), '{"ok":true}');
  assert.deepEqual(c.counts(), { destroyed: 1, requestDestroyed: 1 });
});

test('HTTP/2 cancellation and repeated stalled connections leave no owned session alive', async () => {
  for (let i = 0; i < 10; i++) {
    const controller = new AbortController(); const c = connection(() => controller.abort(Object.assign(new Error('stop'), { code: 'TEST_ABORT' })));
    await assert.rejects(__requestOnce('https://example.invalid/data', { connect: c.connect, signal: controller.signal, timeoutMs: 500 }), { code: 'TEST_ABORT' });
    assert.deepEqual(c.counts(), { destroyed: 1, requestDestroyed: 1 });
  }
});

test('HTTP/2 rejects a pre-aborted request without opening a connection', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(__requestOnce('https://example.invalid/data', { connect: () => calls++, signal: controller.signal, timeoutMs: 500 }));
  assert.equal(calls, 0);
});
