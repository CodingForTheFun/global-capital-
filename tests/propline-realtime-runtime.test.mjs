import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { patchProplineRealtimeCore, patchProplineRealtimeFrontdoor, patchProplineRealtimeUi } from '../lib/autoscout/propline-realtime-runtime-patch.mjs';

test('runtime patches mount signed PropLine callbacks, customer moves API and UI', () => {
  const core = patchProplineRealtimeCore(readFileSync(new URL('../apex-v2/server-core.mjs', import.meta.url), 'utf8'));
  assert.match(core, /onEvent: handleProplineRealtimeEvent/);
  assert.match(core, /\/api\/propline\/live/);
  assert.match(core, /startProplineRealtime\(\)/);
  assert.match(core, /proplineRealtime: proplineRealtimeHealth\(\)/);

  const front = patchProplineRealtimeFrontdoor(readFileSync(new URL('../frontdoor-prod.mjs', import.meta.url), 'utf8'));
  assert.match(front, /\.server-core-propline-runtime\.mjs/);
  assert.match(front, /\/api\/apex\/live-moves/);
  assert.match(front, /url\.pathname === '\/api\/propline\/webhook'\) return false/);

  const ui = patchProplineRealtimeUi(readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8'));
  assert.match(ui, /Market Moves/);
  assert.match(ui, /asMovesMainTab/);
  assert.match(ui, /Live market signals/);
  new Function(ui);
});

test('realtime store ingests, filters and deduplicates single and batched events', async () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'propline-realtime-'));
  process.env.DATA_DIR = temp;
  process.env.AUTOPROP_MASTER_KEY = 'test-master-key-not-production';
  const href = pathToFileURL(new URL('../lib/data-sources/propline/realtime.mjs', import.meta.url).pathname).href + `?test=${Date.now()}`;
  const realtime = await import(href);
  realtime.__resetProplineRealtimeForTests();
  const now = new Date().toISOString();

  await realtime.handleProplineRealtimeEvent({
    type: 'line_movement', sequence: 7,
    payload: {
      sport_key: 'basketball_nba', player_name: 'Test Player', player_id: 'nba:1',
      market_key: 'player_points', bookmaker_key: 'fanduel', outcome_name: 'Over',
      previous: { price_american: -110, point: 20.5 }, current: { price_american: -125, point: 20.5 },
      price_change_pct: 13.6, timestamp: now,
    },
  });
  let snapshot = realtime.proplineRealtimeSnapshot({ sport: 'NBA', type: 'line_movement' });
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.events[0].playerName, 'Test Player');
  assert.equal(snapshot.events[0].current.price, -125);
  assert.equal(snapshot.summary.lineMovements, 1);

  const batch = {
    batch: true, event_type: 'steam', events: [{ delivery_id: 'steam-1', data: {
      sport_key: 'basketball_nba', player_name: 'Test Player', market_key: 'player_points', outcome_name: 'Over',
      consensus_direction: 'shorter', books_moved: 4, books_quoting: 7, steam_score: 82, timestamp: now,
    }}],
  };
  await realtime.handleProplineRealtimeEvent({ type: 'steam', sequence: 8, payload: batch });
  await realtime.handleProplineRealtimeEvent({ type: 'steam', sequence: 9, payload: batch });
  snapshot = realtime.proplineRealtimeSnapshot({ sport: 'NBA' });
  assert.equal(snapshot.events.filter((row) => row.type === 'steam').length, 1, 'delivery_id dedupes retried batched events');
  assert.equal(snapshot.summary.steam, 1);
  assert.equal(snapshot.trendingPlayers[0].playerName, 'Test Player');

  const disk = readFileSync(path.join(temp, 'propline-realtime.json'), 'utf8');
  assert.doesNotMatch(disk, /test-master-key-not-production/);
});

test('webhook creation retries one validation 422 without the giant market filter', async () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'propline-webhook-create-'));
  const previous = {
    DATA_DIR: process.env.DATA_DIR,
    PROPLINE_API_KEY: process.env.PROPLINE_API_KEY,
    AUTOPROP_MASTER_KEY: process.env.AUTOPROP_MASTER_KEY,
    PUBLIC_SITE_ORIGIN: process.env.PUBLIC_SITE_ORIGIN,
    PROPLINE_WEBHOOK_SECRET: process.env.PROPLINE_WEBHOOK_SECRET,
  };
  const originalFetch = globalThis.fetch;
  const requests = [];
  process.env.DATA_DIR = temp;
  process.env.PROPLINE_API_KEY = 'test-propline-api-key';
  process.env.AUTOPROP_MASTER_KEY = 'test-master-key-not-production';
  process.env.PUBLIC_SITE_ORIGIN = 'https://www.obligeprops.com';
  delete process.env.PROPLINE_WEBHOOK_SECRET;

  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body || null });
    const parsed = new URL(String(url));
    if (parsed.pathname === '/v1/webhooks' && (init.method || 'GET') === 'GET') {
      return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (parsed.pathname === '/v1/webhooks' && init.method === 'POST') {
      const postNo = requests.filter((row) => row.method === 'POST').length;
      if (postNo === 1) {
        return new Response(JSON.stringify({
          detail: [{ loc: ['body', 'filter_market_key'], msg: 'value is not valid for this subscription', type: 'value_error' }],
        }), { status: 422, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ id: 41, secret: 'test-signing-secret', active: true }), {
        status: 201, headers: { 'content-type': 'application/json' },
      });
    }
    if (parsed.pathname === '/v1/webhooks/41/replay') {
      return new Response(JSON.stringify({
        webhook_id: 41, since_seq: 0, events: [], next_seq: 0, has_more: false,
        oldest_available_seq: 0, latest_seq: 0, truncated: false,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected request ${init.method || 'GET'} ${parsed.pathname}`);
  };

  try {
    const href = pathToFileURL(new URL('../lib/data-sources/propline/realtime.mjs', import.meta.url).pathname).href + `?create=${Date.now()}-${Math.random()}`;
    const realtime = await import(href);
    realtime.__resetProplineRealtimeForTests();
    const result = await realtime.ensureProplineRealtimeSubscription();
    assert.equal(result.configured, true);
    assert.equal(result.id, 41);

    const posts = requests.filter((row) => row.method === 'POST');
    assert.equal(posts.length, 2);
    const first = JSON.parse(posts[0].body);
    const second = JSON.parse(posts[1].body);
    assert.ok(first.filter_market_key, 'the narrow market filter is attempted first');
    assert.ok(first.filter_sport_key);
    assert.equal(first.format, 'json');
    assert.equal(first.batch_max, 100);
    assert.equal(Object.hasOwn(second, 'filter_market_key'), false, 'fallback removes only the rejected market filter');
    assert.equal(second.filter_sport_key, first.filter_sport_key);
    assert.equal(second.format, 'json');
    assert.equal(second.batch_max, 100);
    assert.ok(requests.every((row) => !row.url.includes('test-propline-api-key')), 'API key never enters a URL');

    const disk = readFileSync(path.join(temp, 'propline-realtime.json'), 'utf8');
    assert.doesNotMatch(disk, /test-signing-secret|test-master-key-not-production|test-propline-api-key/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('webhook capacity 422 fails closed without a second create attempt', async () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'propline-webhook-capacity-'));
  const previous = {
    DATA_DIR: process.env.DATA_DIR,
    PROPLINE_API_KEY: process.env.PROPLINE_API_KEY,
    AUTOPROP_MASTER_KEY: process.env.AUTOPROP_MASTER_KEY,
    PUBLIC_SITE_ORIGIN: process.env.PUBLIC_SITE_ORIGIN,
    PROPLINE_WEBHOOK_SECRET: process.env.PROPLINE_WEBHOOK_SECRET,
  };
  const originalFetch = globalThis.fetch;
  let postCount = 0;
  process.env.DATA_DIR = temp;
  process.env.PROPLINE_API_KEY = 'test-propline-api-key';
  process.env.AUTOPROP_MASTER_KEY = 'test-master-key-not-production';
  process.env.PUBLIC_SITE_ORIGIN = 'https://www.obligeprops.com';
  delete process.env.PROPLINE_WEBHOOK_SECRET;

  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(String(url));
    if (parsed.pathname === '/v1/webhooks' && (init.method || 'GET') === 'GET') {
      return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (parsed.pathname === '/v1/webhooks' && init.method === 'POST') {
      postCount += 1;
      return new Response(JSON.stringify({ detail: 'Maximum active webhook limit reached for this subscription.' }), {
        status: 422, headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected request ${init.method || 'GET'} ${parsed.pathname}`);
  };

  try {
    const href = pathToFileURL(new URL('../lib/data-sources/propline/realtime.mjs', import.meta.url).pathname).href + `?capacity=${Date.now()}-${Math.random()}`;
    const realtime = await import(href);
    realtime.__resetProplineRealtimeForTests();
    const result = await realtime.ensureProplineRealtimeSubscription();
    assert.equal(result.configured, false);
    assert.equal(result.reason, 'PROPLINE_WEBHOOK_HTTP_422');
    assert.equal(postCount, 1, 'capacity rejection must not retry or hammer webhook creation');
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
