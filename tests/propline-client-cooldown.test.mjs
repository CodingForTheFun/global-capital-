import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Import without credentials so the readiness timer cannot call the provider.
// Every request below uses a deterministic fake transport and injected clock.
const originalKey = process.env.PROPLINE_API_KEY;
const originalReserve = process.env.PROPLINE_RESERVE_PERCENT;
delete process.env.PROPLINE_API_KEY;
const { proplineGet, proplineHealth, __resetProplineClient } = await import('../lib/data-sources/propline/client.mjs');
let clock;
const now = () => clock;
const ok = (body = { available: true }) => new Response(JSON.stringify(body), { status: 200 });
const limited = (retryAfter = '5', error = 'burst_limit_exceeded') => new Response(JSON.stringify({ error }), {
  status: 429,
  headers: retryAfter === null ? {} : { 'retry-after': retryAfter },
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
beforeEach(() => {
  clock = Date.parse('2026-09-17T20:00:00Z');
  process.env.PROPLINE_API_KEY = 'unit-test-placeholder';
  process.env.PROPLINE_RESERVE_PERCENT = '10';
  __resetProplineClient();
});
afterEach(() => {
  if (originalKey === undefined) delete process.env.PROPLINE_API_KEY;
  else process.env.PROPLINE_API_KEY = originalKey;
  if (originalReserve === undefined) delete process.env.PROPLINE_RESERVE_PERCENT;
  else process.env.PROPLINE_RESERVE_PERCENT = originalReserve;
  __resetProplineClient();
});

test('429 Retry-After gates different endpoints and bypassCache until the deadline', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return calls === 1 ? limited('5') : ok(); };
  await assert.rejects(proplineGet('/v1/sports', {}, { fetcher, now }), { code: 'PROPLINE_BURST_LIMIT', retryMs: 5000 });
  clock += 2000;
  await assert.rejects(proplineGet('/v1/freshness', {}, { fetcher, now, bypassCache: true }), {
    code: 'PROPLINE_BURST_LIMIT', status: 429, retryMs: 3000,
  });
  assert.equal(calls, 1, 'a new endpoint must not evade the provider cooldown');
  assert.equal(proplineHealth().requests, 1);
  clock += 2999;
  await assert.rejects(proplineGet('/v1/freshness', {}, { fetcher, now }), { retryMs: 1 });
  assert.equal(calls, 1);
  clock += 1;
  assert.deepEqual(await proplineGet('/v1/freshness', {}, { fetcher, now }), { available: true });
  assert.equal(calls, 2, 'the next normal call resumes at the deadline; no retry timer');
});

test('429 on an expired cache entry preserves its payload and does not re-age it', async () => {
  const payload = { last_update: '2026-09-17T19:59:00Z', prices: [-110, -110] };
  let calls = 0;
  const fetcher = async () => { calls++; return calls === 2 ? limited('10') : ok(payload); };
  const options = { fetcher, now, ttlSeconds: 1 };
  const first = await proplineGet('/v1/board', {}, options);
  clock += 1001;
  assert.strictEqual(await proplineGet('/v1/board', {}, options), first);
  clock += 500;
  assert.strictEqual(await proplineGet('/v1/board', {}, { ...options, bypassCache: true }), first);
  assert.equal(calls, 2, 'even bypassCache serves the exact cached payload during cooldown');
  assert.equal(first.last_update, payload.last_update);
  clock += 9500;
  await proplineGet('/v1/board', {}, options);
  assert.equal(calls, 3, 'cooldown must not extend the cached odds TTL');
});

test('fresh cached results remain readable during a cooldown on another endpoint', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return calls === 1 ? ok({ cached: true }) : limited('5'); };
  await proplineGet('/v1/cached', {}, { fetcher, now });
  await assert.rejects(proplineGet('/v1/new', {}, { fetcher, now }), { status: 429 });
  assert.deepEqual(await proplineGet('/v1/cached', {}, { fetcher, now }), { cached: true });
  assert.equal(calls, 2);
});

test('daily-cap and generic 429 responses enforce their own Retry-After without quota headers', async () => {
  for (const [error, code] of [['daily_limit_exceeded', 'PROPLINE_DAILY_LIMIT'], ['unknown_limit', 'PROPLINE_RATE_LIMITED']]) {
    __resetProplineClient();
    let calls = 0;
    const fetcher = async () => { calls++; return limited('60', error); };
    await assert.rejects(proplineGet('/v1/a', {}, { fetcher, now }), { code });
    clock += 1000;
    await assert.rejects(proplineGet('/v1/b', {}, { fetcher, now }), { code, retryMs: 59000 });
    assert.equal(calls, 1);
  }
});

test('HTTP-date Retry-After uses the injected clock and permits recovery at expiry', async () => {
  let calls = 0;
  const at = new Date(clock + 7000).toUTCString();
  const fetcher = async () => { calls++; return calls === 1 ? limited(at) : ok(); };
  await assert.rejects(proplineGet('/v1/a', {}, { fetcher, now }), { retryMs: 7000 });
  clock += 3000;
  await assert.rejects(proplineGet('/v1/b', {}, { fetcher, now }), { retryMs: 4000 });
  assert.equal(calls, 1);
  clock += 4000;
  await proplineGet('/v1/b', {}, { fetcher, now });
  assert.equal(calls, 2);
});

test('missing or malformed Retry-After gets a bounded one-second cooldown', async () => {
  for (const header of [null, 'not-a-date']) {
    __resetProplineClient();
    let calls = 0;
    const fetcher = async () => { calls++; return calls === 1 ? limited(header) : ok(); };
    await assert.rejects(proplineGet('/v1/a', {}, { fetcher, now }), { status: 429 });
    await assert.rejects(proplineGet('/v1/b', {}, { fetcher, now }), { retryMs: 1000 });
    assert.equal(calls, 1);
    clock += 1000;
    await proplineGet('/v1/b', {}, { fetcher, now });
    assert.equal(calls, 2);
  }
});

test('successful in-flight responses cannot erase another endpoint cooldown', async () => {
  const pending = deferred();
  let calls = 0;
  const fetcher = async (url) => {
    calls++;
    return url.pathname === '/v1/slow' ? pending.promise : limited('8');
  };
  const slow = proplineGet('/v1/slow', {}, { fetcher, now });
  const deduped = proplineGet('/v1/slow', {}, { fetcher, now });
  await assert.rejects(proplineGet('/v1/limited', {}, { fetcher, now }), { status: 429 });
  pending.resolve(ok({ completed: true }));
  assert.deepEqual(await slow, { completed: true });
  assert.deepEqual(await deduped, { completed: true });
  await assert.rejects(proplineGet('/v1/other', {}, { fetcher, now }), { retryMs: 8000 });
  assert.equal(calls, 2, 'in-flight dedupe and the shared gate both remain active');
  assert.equal(proplineHealth().lastError.code, 'PROPLINE_BURST_LIMIT');
});

test('overlapping 429 responses keep the longest deadline regardless of arrival order', async () => {
  for (const delays of [[20, 2], [2, 20]]) {
    __resetProplineClient();
    const first = deferred();
    const second = deferred();
    let calls = 0;
    const fetcher = async (url) => {
      calls++;
      if (url.pathname === '/v1/first') return first.promise;
      if (url.pathname === '/v1/second') return second.promise;
      return ok();
    };
    const a = assert.rejects(proplineGet('/v1/first', {}, { fetcher, now }), { status: 429 });
    const b = assert.rejects(proplineGet('/v1/second', {}, { fetcher, now }), { status: 429 });
    first.resolve(limited(String(delays[0])));
    await a;
    second.resolve(limited(String(delays[1])));
    await b;
    clock += 5000;
    await assert.rejects(proplineGet('/v1/third', {}, { fetcher, now }), { retryMs: 15000 });
    assert.equal(calls, 2);
    clock += 15000;
    await proplineGet('/v1/third', {}, { fetcher, now });
    assert.equal(calls, 3);
  }
});

test('zero Retry-After does not invent a positive delay and credentials stay out of URLs', async () => {
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++;
    assert.equal(options.headers['x-api-key'], 'unit-test-placeholder');
    assert.equal(url.searchParams.has('apiKey'), false);
    assert.equal(String(url).includes('unit-test-placeholder'), false);
    return calls === 1 ? limited('0') : ok();
  };
  await assert.rejects(proplineGet('/v1/a', {}, { fetcher, now }), { retryMs: 0 });
  await proplineGet('/v1/b', {}, { fetcher, now });
  assert.equal(calls, 2);
  assert.equal(JSON.stringify(proplineHealth()).includes('unit-test-placeholder'), false);
});

test('HTTP errors other than 429 do not start a cooldown', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return calls === 1 ? new Response('{}', { status: 503, headers: { 'retry-after': '30' } }) : ok();
  };
  await assert.rejects(proplineGet('/v1/a', {}, { fetcher, now }), { code: 'PROPLINE_HTTP_503' });
  await proplineGet('/v1/b', {}, { fetcher, now });
  assert.equal(calls, 2);
});

test('cooldown expiry does not bypass the configured daily reserve', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return new Response(JSON.stringify({ error: 'burst_limit_exceeded' }), {
      status: 429,
      headers: {
        'retry-after': '1', 'x-daily-limit': '1000', 'x-daily-used': '900',
        'x-daily-remaining': '100', 'x-daily-reset': String((clock + 60000) / 1000),
      },
    });
  };
  await assert.rejects(proplineGet('/v1/a', {}, { fetcher, now }), { code: 'PROPLINE_BURST_LIMIT' });
  clock += 1000;
  await assert.rejects(proplineGet('/v1/b', {}, { fetcher, now }), { code: 'PROPLINE_QUOTA_RESERVE' });
  assert.equal(calls, 1);
  assert.equal(proplineHealth().reserve, 100);
});

test('daily allowance and cooldown recover together at the advertised reset', async () => {
  let calls = 0;
  const reset = clock + 60000;
  const fetcher = async () => {
    calls++;
    return calls === 1 ? new Response(JSON.stringify({ error: 'daily_limit_exceeded' }), {
      status: 429,
      headers: {
        'retry-after': '60', 'x-daily-limit': '1000', 'x-daily-used': '1000',
        'x-daily-remaining': '0', 'x-daily-reset': String(reset / 1000),
      },
    }) : ok();
  };
  await assert.rejects(proplineGet('/v1/a', {}, { fetcher, now }), { code: 'PROPLINE_DAILY_LIMIT' });
  clock = reset - 1;
  await assert.rejects(proplineGet('/v1/b', {}, { fetcher, now }), { code: 'PROPLINE_DAILY_LIMIT', retryMs: 1 });
  assert.equal(calls, 1);
  clock = reset;
  await proplineGet('/v1/b', {}, { fetcher, now });
  assert.equal(calls, 2);
});
