import test from 'node:test';
import assert from 'node:assert/strict';
import {
  __resetProplineDeliveryHealth,
  proplineDeliveryHealth,
  refreshProplineDeliveryHealth,
} from '../lib/data-sources/propline/delivery-health.mjs';

test('delivery monitor summarizes recent webhook attempts without exposing the API key', async () => {
  __resetProplineDeliveryHealth();
  const previous = process.env.PROPLINE_API_KEY;
  process.env.PROPLINE_API_KEY = 'test-delivery-health-key';
  let requested = null;
  try {
    const out = await refreshProplineDeliveryHealth({
      subscriptionId: 12,
      fetcher: async (url, init) => {
        requested = { url: String(url), headers: init.headers };
        return new Response(JSON.stringify({ deliveries: [
          { id: 3, status: 'delivered', http_status: 200, attempt_count: 1, created_at: '2026-09-16T02:00:00Z' },
          { id: 2, status: 'failed', http_status: 503, attempt_count: 3, created_at: '2026-09-16T01:59:00Z' },
        ] }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    assert.equal(out.subscriptionId, '12');
    assert.equal(out.deliveries, 2);
    assert.equal(out.successful, 1);
    assert.equal(out.failed, 1);
    assert.equal(out.maxAttempts, 3);
    assert.equal(out.lastHttpStatus, 200);
    assert.equal(out.healthy, false);
    assert.match(requested.url, /\/v1\/webhooks\/12\/deliveries\?limit=50$/);
    assert.equal(requested.headers['x-api-key'], 'test-delivery-health-key');
    assert.doesNotMatch(requested.url, /test-delivery-health-key/);
  } finally {
    if (previous === undefined) delete process.env.PROPLINE_API_KEY;
    else process.env.PROPLINE_API_KEY = previous;
  }
});

test('delivery monitor fails closed while the webhook subscription is unavailable', async () => {
  __resetProplineDeliveryHealth();
  const previous = process.env.PROPLINE_API_KEY;
  process.env.PROPLINE_API_KEY = 'test-delivery-health-key';
  try {
    await refreshProplineDeliveryHealth({ subscriptionId: null, fetcher: async () => { throw new Error('should not fetch'); } });
    assert.equal(proplineDeliveryHealth().lastError, 'PROPLINE_WEBHOOK_NOT_READY');
  } finally {
    if (previous === undefined) delete process.env.PROPLINE_API_KEY;
    else process.env.PROPLINE_API_KEY = previous;
  }
});

// Production read this ledger one second after each event was queued and saw
// fifty rows still marked "pending" with no HTTP status. Counting those as
// failures reported the pipeline unhealthy while it was accepting every single
// event, so a not-yet-attempted delivery must count towards neither column.
test('queued deliveries are pending, not failures', async () => {
  __resetProplineDeliveryHealth();
  const previous = process.env.PROPLINE_API_KEY;
  process.env.PROPLINE_API_KEY = 'test-delivery-health-key';
  try {
    const out = await refreshProplineDeliveryHealth({
      subscriptionId: 580,
      fetcher: async () => new Response(JSON.stringify({ deliveries: [
        { id: 3, status: 'pending', http_status: null, attempt_count: 0, created_at: '2026-09-16T10:01:54Z' },
        { id: 2, status: 'queued', http_status: null, attempt_count: 0, created_at: '2026-09-16T10:01:53Z' },
        { id: 1, status: 'delivered', http_status: 200, attempt_count: 1, created_at: '2026-09-16T10:01:00Z' },
      ] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    });
    assert.equal(out.deliveries, 3);
    assert.equal(out.successful, 1);
    assert.equal(out.pending, 2);
    assert.equal(out.failed, 0, 'a delivery that has not been attempted has not failed');
    assert.equal(out.healthy, true, 'a pipeline with no terminal failure is healthy');
  } finally {
    if (previous === undefined) delete process.env.PROPLINE_API_KEY;
    else process.env.PROPLINE_API_KEY = previous;
  }
});

test('a terminal failure with no HTTP status still counts against health', async () => {
  __resetProplineDeliveryHealth();
  const previous = process.env.PROPLINE_API_KEY;
  process.env.PROPLINE_API_KEY = 'test-delivery-health-key';
  try {
    const out = await refreshProplineDeliveryHealth({
      subscriptionId: 580,
      fetcher: async () => new Response(JSON.stringify({ deliveries: [
        { id: 2, status: 'exhausted', http_status: null, attempt_count: 5, created_at: '2026-09-16T10:01:54Z' },
        { id: 1, status: 'pending', http_status: null, attempt_count: 0, created_at: '2026-09-16T10:01:53Z' },
      ] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    });
    assert.equal(out.failed, 1);
    assert.equal(out.pending, 1);
    assert.equal(out.healthy, false);
  } finally {
    if (previous === undefined) delete process.env.PROPLINE_API_KEY;
    else process.env.PROPLINE_API_KEY = previous;
  }
});
