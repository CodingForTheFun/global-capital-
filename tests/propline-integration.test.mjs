import test from 'node:test';
import assert from 'node:assert/strict';

import {
  __resetProplineClient,
  proplineGet,
  proplineQuota,
} from '../lib/data-sources/propline/client.mjs';
import {
  bookKey,
  defaultPlayerPropMarkets,
  proplineSportKey,
} from '../lib/data-sources/propline/markets.mjs';
import {
  __resetProplineProvider,
  fetchBoard,
} from '../lib/autoscout/providers/propline.mjs';
import { proplineSupplementPolicy } from '../lib/ingestion/propline-supplement.mjs';

const originalKey = process.env.PROPLINE_API_KEY;
const originalMarkets = process.env.PROPLINE_MARKETS;
const originalBooks = process.env.PROPLINE_BOOKMAKERS;
const originalFetch = globalThis.fetch;

function quotaHeaders({ limit = 1000, used = 1, remaining = 999 } = {}) {
  return {
    'content-type': 'application/json',
    'x-daily-limit': String(limit),
    'x-daily-used': String(used),
    'x-daily-remaining': String(remaining),
    'x-daily-reset': String(Math.floor(Date.now() / 1000) + 3600),
  };
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { ...quotaHeaders(init.quota), ...(init.headers || {}) },
  });
}

function restoreEnv() {
  if (originalKey === undefined) delete process.env.PROPLINE_API_KEY;
  else process.env.PROPLINE_API_KEY = originalKey;
  if (originalMarkets === undefined) delete process.env.PROPLINE_MARKETS;
  else process.env.PROPLINE_MARKETS = originalMarkets;
  if (originalBooks === undefined) delete process.env.PROPLINE_BOOKMAKERS;
  else process.env.PROPLINE_BOOKMAKERS = originalBooks;
  globalThis.fetch = originalFetch;
  __resetProplineProvider();
}

test.afterEach(restoreEnv);

test('PropLine client authenticates by header, records quota, and de-duplicates cached requests', async () => {
  process.env.PROPLINE_API_KEY = 'test-only-key';
  __resetProplineClient();
  let calls = 0;
  let seenHeaders = null;
  const fetcher = async (_url, options) => {
    calls += 1;
    seenHeaders = options.headers;
    return jsonResponse([{ key: 'football_nfl' }], { quota: { limit: 5000, used: 20, remaining: 4980 } });
  };

  const first = await proplineGet('/v1/sports', {}, { fetcher, ttlSeconds: 60 });
  const second = await proplineGet('/v1/sports', {}, { fetcher, ttlSeconds: 60 });

  assert.deepEqual(first, second);
  assert.equal(calls, 1);
  assert.equal(seenHeaders['x-api-key'], 'test-only-key');
  assert.equal(proplineQuota().limit, 5000);
  assert.equal(proplineQuota().remaining, 4980);
  assert.equal(proplineQuota().tier, 'hobby');
});

test('PropLine client distinguishes burst throttling from the daily allowance', async () => {
  process.env.PROPLINE_API_KEY = 'test-only-key';
  __resetProplineClient();

  await assert.rejects(
    () => proplineGet('/v1/sports', {}, {
      fetcher: async () => jsonResponse({ detail: { error: 'burst_limit_exceeded' } }, {
        status: 429,
        headers: { 'retry-after': '2' },
        quota: { limit: 1000, used: 10, remaining: 990 },
      }),
    }),
    (error) => error?.code === 'PROPLINE_BURST_LIMIT' && error?.retryMs === 2000,
  );

  __resetProplineClient();
  await assert.rejects(
    () => proplineGet('/v1/sports', {}, {
      fetcher: async () => jsonResponse({ detail: { error: 'daily_limit_exceeded' } }, {
        status: 429,
        quota: { limit: 1000, used: 1000, remaining: 0 },
      }),
    }),
    (error) => error?.code === 'PROPLINE_DAILY_LIMIT',
  );
});

test('PropLine defaults use documented sport keys and comparable player markets', () => {
  assert.equal(proplineSportKey('NFL'), 'football_nfl');
  assert.equal(proplineSportKey('MLB'), 'baseball_mlb');
  assert.equal(proplineSportKey('MLS'), 'soccer_mls');
  assert.ok(defaultPlayerPropMarkets('NFL').includes('player_pass_yds'));
  assert.ok(defaultPlayerPropMarkets('NBA').includes('player_points'));
  assert.ok(defaultPlayerPropMarkets('TENNIS').includes('player_aces'));
  assert.deepEqual(defaultPlayerPropMarkets('MLS'), []);
});

test('PropLine keeps distinct bookmaker identities while normalizing spelling aliases', () => {
  assert.equal(bookKey('polymarket'), 'polymarket');
  assert.equal(bookKey('polymarket_us'), 'polymarket_us');
  assert.equal(bookKey('hardrock'), 'hardrockbet');
  assert.equal(bookKey('tab_au'), 'tab');
});

test('cacheOnly PropLine board reads never make an upstream request', async () => {
  process.env.PROPLINE_API_KEY = 'test-only-key';
  __resetProplineProvider();
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('should not fetch'); };

  const board = await fetchBoard('NFL', { cacheOnly: true });
  assert.equal(calls, 0);
  assert.equal(board.meta.cacheHit, true);
  assert.equal(board.meta.stale, true);
  assert.deepEqual(board.props, []);
});

test('PropLine board always sends markets and emits the existing flat prop contract', async () => {
  process.env.PROPLINE_API_KEY = 'test-only-key';
  delete process.env.PROPLINE_MARKETS;
  process.env.PROPLINE_BOOKMAKERS = 'draftkings';
  __resetProplineProvider();

  const start = new Date(Date.now() + 3_600_000).toISOString();
  let oddsUrl = null;
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls += 1;
    const url = new URL(String(input));
    if (url.pathname === '/v1/sports/football_nfl/events') {
      return jsonResponse([{ id: 'evt-1', sport_key: 'football_nfl', commence_time: start, home_team: 'Home', away_team: 'Away' }], {
        quota: { limit: 25000, used: 10, remaining: 24990 },
      });
    }
    if (url.pathname === '/v1/sports/football_nfl/events/evt-1/odds') {
      oddsUrl = url;
      return jsonResponse({
        id: 'evt-1',
        sport_key: 'football_nfl',
        commence_time: start,
        home_team: 'Home',
        away_team: 'Away',
        bookmakers: [{
          key: 'draftkings',
          title: 'DraftKings',
          markets: [{
            key: 'player_pass_yds',
            title: 'Passing Yards',
            outcomes: [
              { name: 'Over', description: 'Example Quarterback', player_id: 'pl-123', point: 249.5, price: -110 },
              { name: 'Under', description: 'Example Quarterback', player_id: 'pl-123', point: 249.5, price: -110 },
            ],
          }],
        }],
      }, { quota: { limit: 25000, used: 11, remaining: 24989 } });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const board = await fetchBoard('NFL', { force: true, eventLimit: 1 });
  assert.equal(calls, 2);
  assert.ok(oddsUrl);
  assert.ok(oddsUrl.searchParams.get('markets'));
  assert.ok(oddsUrl.searchParams.get('markets').includes('player_pass_yds'));
  assert.equal(oddsUrl.searchParams.get('bookmakers'), 'draftkings');
  assert.equal(oddsUrl.searchParams.get('includeLinks'), 'true');
  assert.equal(oddsUrl.searchParams.get('includeBookIds'), 'true');
  assert.equal(board.props.length, 2);
  assert.equal(board.props[0].provider, 'propline');
  assert.equal(board.props[0].providerPlayerId, 'pl-123');
  assert.equal(board.props[0].sportsbookKey, 'draftkings');
  assert.equal(board.meta.lineCount, 2);
});

test('Free-tier PropLine supplement stays within a conservative daily request budget', () => {
  const policy = proplineSupplementPolicy({ limit: 1000, remaining: 1000, tier: 'free' });
  assert.equal(policy.intervalSeconds, 900);
  assert.equal(policy.eventLimit, 2);
  assert.equal(policy.reserve, 100);
  // 96 cycles/day * (1 event-list + 2 event-odds requests) = 288 before
  // additional cache hits, safely below the 1000-request daily allowance.
  assert.ok((86400 / policy.intervalSeconds) * (1 + policy.eventLimit) <= 288);
});
