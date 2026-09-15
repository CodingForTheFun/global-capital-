// The webhook endpoint is publicly reachable and unauthenticated by session, so
// the signature check is the only thing standing between the internet and the
// board. These tests exist for that boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import {
  EVENT_TYPES, __resetWebhookState, noteDelivery, replayCursor,
  signPayload, verifyDelivery, webhookHealth,
} from '../lib/data-sources/propline/webhooks.mjs';
import { handleProplineWebhook, WEBHOOK_PATH } from '../lib/data-sources/propline/webhook-route.mjs';

const SECRET = 'whsec_test_value';
const nowSeconds = () => Math.floor(Date.now() / 1000);

function request({ method = 'POST', body = '{}', signature, timestamp, event = 'line_movement', sequence = '1' } = {}) {
  const ts = timestamp ?? nowSeconds();
  const req = Readable.from([Buffer.from(body, 'utf8')]);
  req.method = method;
  req.headers = {
    'x-propline-signature': signature ?? signPayload(ts, body, SECRET),
    'x-propline-timestamp': String(ts),
    'x-propline-event': event,
    'x-propline-sequence': String(sequence),
  };
  return req;
}
function collector() {
  const res = { statusCode: null, headers: null, body: null, ended: false };
  res.writeHead = (status, headers) => { res.statusCode = status; res.headers = headers; return res; };
  res.end = (payload) => { res.body = payload ? JSON.parse(payload) : null; res.ended = true; return res; };
  return res;
}

test('a correctly signed delivery verifies', () => {
  const body = '{"event":"line_movement"}';
  const ts = nowSeconds();
  const out = verifyDelivery({ signature: signPayload(ts, body, SECRET), timestamp: ts, rawBody: body, secret: SECRET });
  assert.equal(out.ok, true);
});

test('a sha256= prefix is tolerated', () => {
  const body = '{}'; const ts = nowSeconds();
  const out = verifyDelivery({ signature: `sha256=${signPayload(ts, body, SECRET)}`, timestamp: ts, rawBody: body, secret: SECRET });
  assert.equal(out.ok, true);
});

test('a forged signature is rejected', () => {
  const body = '{}'; const ts = nowSeconds();
  const out = verifyDelivery({ signature: crypto.randomBytes(32).toString('hex'), timestamp: ts, rawBody: body, secret: SECRET });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'BAD_SIGNATURE');
});

test('a tampered body invalidates a real signature', () => {
  const ts = nowSeconds();
  const signature = signPayload(ts, '{"line":1.5}', SECRET);
  const out = verifyDelivery({ signature, timestamp: ts, rawBody: '{"line":99.5}', secret: SECRET });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'BAD_SIGNATURE');
});

test('a signature of the wrong length is rejected without throwing', () => {
  const body = '{}'; const ts = nowSeconds();
  // timingSafeEqual throws on unequal lengths; this must be a clean rejection.
  const out = verifyDelivery({ signature: 'abc', timestamp: ts, rawBody: body, secret: SECRET });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'BAD_SIGNATURE');
});

test('an old delivery is rejected even with a valid signature', () => {
  const body = '{}';
  const ts = nowSeconds() - 3600;
  const out = verifyDelivery({ signature: signPayload(ts, body, SECRET), timestamp: ts, rawBody: body, secret: SECRET });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'TIMESTAMP_OUT_OF_RANGE', 'a captured delivery must not replay forever');
});

test('a future-dated delivery is rejected too', () => {
  const body = '{}';
  const ts = nowSeconds() + 3600;
  const out = verifyDelivery({ signature: signPayload(ts, body, SECRET), timestamp: ts, rawBody: body, secret: SECRET });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'TIMESTAMP_OUT_OF_RANGE');
});

test('a missing signature or timestamp is named, not guessed at', () => {
  assert.equal(verifyDelivery({ signature: '', timestamp: nowSeconds(), rawBody: '{}', secret: SECRET }).reason, 'MISSING_SIGNATURE');
  assert.equal(verifyDelivery({ signature: 'a'.repeat(64), timestamp: 'nope', rawBody: '{}', secret: SECRET }).reason, 'MISSING_TIMESTAMP');
});

test('without a configured secret nothing verifies', () => {
  const out = verifyDelivery({ signature: 'a'.repeat(64), timestamp: nowSeconds(), rawBody: '{}', secret: '' });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'WEBHOOK_NOT_CONFIGURED');
});

test('a sequence gap is recorded so replay knows where to resume', () => {
  __resetWebhookState();
  noteDelivery('line_movement', 10);
  noteDelivery('line_movement', 11);
  const { gap } = noteDelivery('line_movement', 20);
  assert.deepEqual({ from: gap.from, to: gap.to, missed: gap.missed }, { from: 11, to: 20, missed: 8 });
  assert.equal(replayCursor(), 11, 'replay resumes from the last sequence actually received');
});

test('consecutive deliveries record no gap', () => {
  __resetWebhookState();
  noteDelivery('resolution', 1);
  const { gap } = noteDelivery('resolution', 2);
  assert.equal(gap, null);
});

test('out-of-order deliveries do not move the watermark backwards', () => {
  __resetWebhookState();
  noteDelivery('steam', 100);
  noteDelivery('steam', 98);
  assert.equal(webhookHealth().lastSequence, 100);
});

test('health counts deliveries by type', () => {
  __resetWebhookState();
  noteDelivery('line_movement', 1);
  noteDelivery('resolution', 2);
  noteDelivery('line_movement', 3);
  const health = webhookHealth();
  assert.equal(health.byType.line_movement, 2);
  assert.equal(health.byType.resolution, 1);
  assert.equal(health.accepted, 3);
  for (const type of EVENT_TYPES) assert.ok(type in health.byType, `${type} must be counted`);
});

test('the route accepts a signed delivery and hands it to the consumer', async () => {
  __resetWebhookState();
  process.env.PROPLINE_WEBHOOK_SECRET = SECRET;
  const body = JSON.stringify({ event: 'line_movement', outcome_id: 'o1', price: -115 });
  const res = collector();
  const seen = [];
  await handleProplineWebhook(request({ body, sequence: '7' }), res, { onEvent: (e) => { seen.push(e); } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].type, 'line_movement');
  assert.equal(seen[0].payload.outcome_id, 'o1');
  delete process.env.PROPLINE_WEBHOOK_SECRET;
});

test('the route rejects an unsigned delivery with 401 and no detail', async () => {
  __resetWebhookState();
  process.env.PROPLINE_WEBHOOK_SECRET = SECRET;
  const res = collector();
  let called = false;
  await handleProplineWebhook(request({ signature: 'a'.repeat(64) }), res, { onEvent: () => { called = true; } });
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { ok: false, error: 'unauthorized' }, 'must not tell a forger which part failed');
  assert.equal(called, false, 'an unverified delivery must never reach the consumer');
  assert.equal(webhookHealth().rejected, 1);
  delete process.env.PROPLINE_WEBHOOK_SECRET;
});

test('a handler that throws still leaves the delivery answered 200', async () => {
  __resetWebhookState();
  process.env.PROPLINE_WEBHOOK_SECRET = SECRET;
  const res = collector();
  await handleProplineWebhook(request(), res, { onEvent: () => { throw new Error('downstream is down'); } });
  assert.equal(res.statusCode, 200, 'a failed handler must not trigger PropLine retries');
  delete process.env.PROPLINE_WEBHOOK_SECRET;
});

test('GET is not allowed on the webhook path', async () => {
  process.env.PROPLINE_WEBHOOK_SECRET = SECRET;
  const res = collector();
  await handleProplineWebhook(request({ method: 'GET' }), res);
  assert.equal(res.statusCode, 405);
  delete process.env.PROPLINE_WEBHOOK_SECRET;
});

test('with no secret configured the endpoint reports unavailable, not unauthorized', async () => {
  __resetWebhookState();
  delete process.env.PROPLINE_WEBHOOK_SECRET;
  const res = collector();
  await handleProplineWebhook(request(), res);
  assert.equal(res.statusCode, 503);
});

test('the webhook path is registered on the server', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../apex-v2/server-core.mjs', import.meta.url), 'utf8');
  assert.match(source, /PROPLINE_WEBHOOK_PATH/, 'the route must be wired into the server');
  assert.equal(WEBHOOK_PATH, '/api/propline/webhook');
});
