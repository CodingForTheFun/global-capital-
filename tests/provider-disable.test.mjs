import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, isConfigured, resolveKey } from '../lib/data-sources/sportsdataio/client.mjs';

test('disabled legacy provider performs no HTTP and cannot serve previously cached data', async () => {
  const names = ['AUTOSCOUT_DISABLE_SPORTSDATAIO', 'SPORTSDATAIO_API_KEY'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  let requests = 0;
  try {
    delete process.env.AUTOSCOUT_DISABLE_SPORTSDATAIO;
    process.env.SPORTSDATAIO_API_KEY = 'unit-test-only';
    const client = createClient({ fetchImpl: async () => { requests++; return new Response('[]'); } });
    assert.equal((await client.get('https://example.test/stats', 'stats', { ttlMs: 60000 })).ok, true);
    process.env.AUTOSCOUT_DISABLE_SPORTSDATAIO = 'true';
    assert.equal(isConfigured(), false);
    assert.equal(resolveKey('NFL'), '');
    for (const path of ['stats', 'new-stats']) {
      const result = await client.get('https://example.test/' + path, path);
      assert.equal(result.ok, false);
      assert.equal(result.data, null);
      assert.equal(result.reason, 'disabled');
    }
    assert.equal(requests, 1);
  } finally {
    for (const name of names) if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
  }
});
