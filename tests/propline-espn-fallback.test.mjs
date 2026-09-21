import test from 'node:test';
import assert from 'node:assert/strict';
import { researchPlayerProp } from '../lib/autoscout/research-service-v2.mjs';
import { __resetProplineClient } from '../lib/data-sources/propline/client.mjs';

const oldKey = process.env.PROPLINE_API_KEY;
const oldFetch = globalThis.fetch;

test('PropLine outage falls back to verified ESPN history without fabricating lines', async () => {
  process.env.PROPLINE_API_KEY = 'fixture-only-not-a-real-key';
  __resetProplineClient();
  let propLineCalls = 0, espnCalls = 0;
  globalThis.fetch = async input => {
    const url = new URL(input);
    if (url.hostname === 'api.prop-line.com') {
      propLineCalls++;
      return new Response(JSON.stringify({ error: 'temporary' }), { status: 503, headers: { 'content-type': 'application/json' } });
    }
    if (url.hostname.includes('espn.com')) {
      espnCalls++;
      // This regression only proves routing: malformed/empty ESPN data must
      // fail closed rather than invent a line or statistic.
      return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error('unexpected host');
  };
  try {
    const result = await researchPlayerProp({
      sport: 'NBA', playerName: 'Fallback Regression Player',
      market: 'Points', providerMarketKey: 'player_points',
      line: 20.5, side: 'OVER', games: 20,
    });
    assert.ok(propLineCalls >= 1);
    assert.ok(espnCalls >= 1);
    assert.equal(result.available, false);
    assert.notEqual(result.source, 'PropLine raw game archive');
    assert.equal(result.projectedStat ?? null, null);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.PROPLINE_API_KEY; else process.env.PROPLINE_API_KEY = oldKey;
    __resetProplineClient();
  }
});
