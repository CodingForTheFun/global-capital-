import test from 'node:test';
import assert from 'node:assert/strict';
import {
  __resetProplineClient,
  proplineGet,
  proplineHealth,
  proplineReserve,
} from '../lib/data-sources/propline/client.mjs';

const headers = (extra = {}) => ({ get: (name) => (name in extra ? String(extra[name]) : null) });
const ok = (body, extra = {}) => ({ ok: true, status: 200, headers: headers(extra), json: async () => body });

test('the shared PropLine client protects the daily reserve before another request is sent', async () => {
  const previousKey = process.env.PROPLINE_API_KEY;
  const previousReserve = process.env.PROPLINE_RESERVE_PERCENT;
  try {
    __resetProplineClient();
    process.env.PROPLINE_API_KEY = 'test-key';
    process.env.PROPLINE_RESERVE_PERCENT = '10';
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return ok({ ok: true }, {
        'x-daily-limit': '250000',
        'x-daily-used': '225000',
        'x-daily-remaining': '25000',
        'x-daily-reset': '1789516800',
      });
    };

    await proplineGet('/v1/prime-quota', {}, { fetcher, ttlSeconds: 1 });
    assert.equal(proplineReserve(), 25000);
    assert.equal(proplineHealth().reserve, 25000);

    await assert.rejects(
      () => proplineGet('/v1/would-spend-reserve', {}, { fetcher, ttlSeconds: 1 }),
      (error) => error.code === 'PROPLINE_QUOTA_RESERVE' && error.reserve === 25000,
    );
    assert.equal(calls, 1, 'no upstream request may spend the protected reserve');
  } finally {
    __resetProplineClient();
    if (previousKey === undefined) delete process.env.PROPLINE_API_KEY;
    else process.env.PROPLINE_API_KEY = previousKey;
    if (previousReserve === undefined) delete process.env.PROPLINE_RESERVE_PERCENT;
    else process.env.PROPLINE_RESERVE_PERCENT = previousReserve;
  }
});

test('the PropLine reserve guard reopens after the reported daily reset', async () => {
  const previousKey = process.env.PROPLINE_API_KEY;
  const previousReserve = process.env.PROPLINE_RESERVE_PERCENT;
  try {
    __resetProplineClient();
    process.env.PROPLINE_API_KEY = 'test-key';
    process.env.PROPLINE_RESERVE_PERCENT = '10';
    const resetSeconds = 1789516800;
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      if (calls === 1) {
        return ok({ window: 'old' }, {
          'x-daily-limit': '250000',
          'x-daily-used': '225000',
          'x-daily-remaining': '25000',
          'x-daily-reset': String(resetSeconds),
        });
      }
      return ok({ window: 'new' }, {
        'x-daily-limit': '250000',
        'x-daily-used': '1',
        'x-daily-remaining': '249999',
        'x-daily-reset': String(resetSeconds + 86400),
      });
    };

    await proplineGet('/v1/old-window', {}, {
      fetcher,
      ttlSeconds: 1,
      now: () => resetSeconds * 1000 - 60_000,
    });
    const reopened = await proplineGet('/v1/new-window', {}, {
      fetcher,
      ttlSeconds: 1,
      now: () => resetSeconds * 1000 + 1_000,
    });

    assert.deepEqual(reopened, { window: 'new' });
    assert.equal(calls, 2, 'a new quota window must allow one request to refresh counters');
    assert.equal(proplineHealth().quota.remaining, 249999);
  } finally {
    __resetProplineClient();
    if (previousKey === undefined) delete process.env.PROPLINE_API_KEY;
    else process.env.PROPLINE_API_KEY = previousKey;
    if (previousReserve === undefined) delete process.env.PROPLINE_RESERVE_PERCENT;
    else process.env.PROPLINE_RESERVE_PERCENT = previousReserve;
  }
});
