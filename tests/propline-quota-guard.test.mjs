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
