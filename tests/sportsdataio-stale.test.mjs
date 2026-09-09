import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../lib/data-sources/sportsdataio/client.mjs';

test('expired positive cache is retained for stale-on-error fallback', async () => {
  const previous = process.env.SPORTSDATAIO_API_KEY;
  process.env.SPORTSDATAIO_API_KEY = 'test-key-that-is-never-logged';
  let clock = 0;
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls === 1) {
      return {
        ok: true,
        status: 200,
        json: async () => [{ Name: 'Player A', Points: 24 }],
        headers: { get: () => null },
      };
    }
    return {
      ok: false,
      status: 500,
      json: async () => ({ ignored: true }),
      headers: { get: () => null },
    };
  };

  try {
    const client = createClient({ fetchImpl, now: () => clock });
    const first = await client.get('https://example.invalid/feed', 'feed', { ttlMs: 1000, sport: 'NBA' });
    assert.equal(first.ok, true);
    assert.equal(first.cached, false);

    clock = 2000;
    const second = await client.get('https://example.invalid/feed', 'feed', { ttlMs: 1000, sport: 'NBA', allowStale: true });
    assert.equal(second.ok, true);
    assert.equal(second.cached, true);
    assert.equal(second.stale, true);
    assert.deepEqual(second.data, first.data);
    assert.equal(calls, 2);
  } finally {
    if (previous === undefined) delete process.env.SPORTSDATAIO_API_KEY;
    else process.env.SPORTSDATAIO_API_KEY = previous;
  }
});
