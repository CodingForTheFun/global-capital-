import assert from 'node:assert/strict';
import test from 'node:test';

function response(body, status = 200) {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => text,
  };
}

test('Pinnacle shares one cold sports-catalog request across concurrent sports', async () => {
  const { fetchPinnaclePublic } = await import('../lib/ingestion/pinnacle-public.mjs?catalog-singleflight');
  let sportsCalls = 0;
  const fetcher = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith('/sports')) {
      sportsCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return response([{ id: 15, name: 'American Football' }]);
    }
    if (parsed.pathname.endsWith('/sports/15/matchups')) return response([]);
    throw new Error(`unexpected URL ${url}`);
  };

  const [nfl, ncaaf] = await Promise.all([
    fetchPinnaclePublic('NFL', { fetcher, force: true }),
    fetchPinnaclePublic('NCAAF', { fetcher, force: true }),
  ]);

  assert.equal(sportsCalls, 1);
  assert.equal(nfl.eventsChecked, 0);
  assert.equal(ncaaf.eventsChecked, 0);
});

test('Pinnacle may reuse an expired verified sports catalog when only catalog refresh fails', async () => {
  const { fetchPinnaclePublic } = await import('../lib/ingestion/pinnacle-public.mjs?catalog-stale-fallback');
  const realNow = Date.now;
  let now = realNow();
  let failCatalog = false;
  let sportsCalls = 0;
  Date.now = () => now;

  const fetcher = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith('/sports')) {
      sportsCalls += 1;
      if (failCatalog) throw Object.assign(new Error('catalog transport failed'), { code: 'TEST_CATALOG_FAILED' });
      return response([{ id: 15, name: 'American Football' }]);
    }
    if (parsed.pathname.endsWith('/sports/15/matchups')) return response([]);
    throw new Error(`unexpected URL ${url}`);
  };

  try {
    const first = await fetchPinnaclePublic('NFL', { fetcher, force: true });
    assert.equal(first.eventsChecked, 0);
    assert.equal(sportsCalls, 1);

    now += 31 * 60_000;
    failCatalog = true;

    const second = await fetchPinnaclePublic('NCAAF', { fetcher, force: true });
    assert.equal(second.eventsChecked, 0);
    assert.equal(sportsCalls, 2);
  } finally {
    Date.now = realNow;
  }
});
