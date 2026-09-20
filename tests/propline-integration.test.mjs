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
  isAlternateOutcome,
  proplineSportKey,
} from '../lib/data-sources/propline/markets.mjs';
import {
  __resetProplineProvider,
  fetchBoard,
} from '../lib/autoscout/providers/propline.mjs';
import { proplineSupplementPolicy, maybeRefreshProplineSupplement, mergeCachedPropline, __resetProplineSupplement } from '../lib/ingestion/propline-supplement.mjs';

const originalKey = process.env.PROPLINE_API_KEY;
const originalMarkets = process.env.PROPLINE_MARKETS;
const originalBooks = process.env.PROPLINE_BOOKMAKERS;
const originalNflMarkets = process.env.PROPLINE_MARKETS_NFL;
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
  if (originalNflMarkets === undefined) delete process.env.PROPLINE_MARKETS_NFL;
  else process.env.PROPLINE_MARKETS_NFL = originalNflMarkets;
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
        home_team_key: 'home_key',
        away_team_key: 'away_key',
        home_team_id: 'espn:1',
        away_team_id: 'espn:2',
        home_team_logo_url: 'https://cdn.example.test/home.png',
        away_team_logo_url: 'https://cdn.example.test/away.png',
        espn_event_id: '401123456',
        bookmakers: [{
          key: 'draftkings',
          title: 'DraftKings',
          markets: [{
            key: 'player_pass_yds',
            title: 'Passing Yards',
            outcomes: [
              { name: 'Over', description: 'Example Quarterback', player_id: 'pl-123', point: 249.5, price: -110, outcome_id: 'out-1', book_outcome_id: 'book-out-1', last_change_at: '2026-09-19T20:00:00Z', last_seen_at: '2026-09-19T20:00:10Z', liquidity: 1200, liquidity_updated_at: '2026-09-19T20:00:09Z' },
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
  assert.equal(board.props[0].proplinePlayerId, 'pl-123');
  assert.equal(board.props[0].proplineEventId, 'evt-1');
  assert.equal(board.props[0].proplineOutcomeId, 'out-1');
  assert.equal(board.props[0].sportsbookKey, 'draftkings');
  assert.equal(board.props[0].providerOutcomeId, 'out-1');
  assert.equal(board.props[0].bookOutcomeId, 'book-out-1');
  assert.equal(board.props[0].lastSeenAt, '2026-09-19T20:00:10Z');
  assert.equal(board.props[0].liquidity, 1200);
  assert.equal(board.props[0].homeTeamLogoUrl, 'https://cdn.example.test/home.png');
  assert.equal(board.props[0].awayTeamLogoUrl, 'https://cdn.example.test/away.png');
  assert.equal(board.props[0].espnEventId, '401123456');
  assert.equal(board.meta.lineCount, 2);
});

test('PropLine flat rows retain verified PrizePicks and Underdog modifiers without extra requests', async () => {
  process.env.PROPLINE_API_KEY = 'test-only-key';
  delete process.env.PROPLINE_BOOKMAKERS;
  process.env.PROPLINE_MARKETS_NFL = 'player_pass_yds';
  __resetProplineProvider();

  const start = new Date(Date.now() + 3_600_000).toISOString();
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/v1/sports/football_nfl/events') {
      return jsonResponse([{ id: 'evt-dfs', sport_key: 'football_nfl', commence_time: start, home_team: 'Home', away_team: 'Away' }], {
        quota: { limit: 250000, used: 10, remaining: 249990 },
      });
    }
    if (url.pathname === '/v1/sports/football_nfl/events/evt-dfs/odds') {
      return jsonResponse({
        id: 'evt-dfs',
        sport_key: 'football_nfl',
        commence_time: start,
        home_team: 'Home',
        away_team: 'Away',
        bookmakers: [
          { key: 'prizepicks', title: 'PrizePicks', markets: [{ key: 'player_pass_yds', outcomes: [
            { name: 'Over', description: 'Example Quarterback', player_id: 'espn:7', point: 249.5, price: 100, dfs_odds_type: 'standard', outcome_id: 'pp-standard' },
            { name: 'Over', description: 'Example Quarterback', player_id: 'espn:7', point: 259.5, price: 100, dfs_odds_type: 'demon', line_gap: 10, outcome_id: 'pp-demon', book_outcome_id: 'projection-9' },
          ] }] },
          { key: 'underdog', title: 'Underdog', markets: [{ key: 'player_pass_yds', outcomes: [
            { name: 'Over', description: 'Example Quarterback', player_id: 'espn:7', point: 249.5, price: 100, payout_multiplier: 1.0, outcome_id: 'ud-standard' },
            { name: 'Over', description: 'Example Quarterback', player_id: 'espn:7', point: 255.5, price: 100, payout_multiplier: 1.4, outcome_id: 'ud-boost', book_outcome_id: 'option-4' },
            { name: 'Over', description: 'Example Quarterback', player_id: 'espn:7', point: 240.5, price: 100, payout_multiplier: null, outcome_id: 'ud-null' },
            { name: 'Over', description: 'Example Quarterback', player_id: 'espn:7', point: 239.5, price: 100, payout_multiplier: '', outcome_id: 'ud-empty' },
          ] }] },
        ],
      }, { quota: { limit: 250000, used: 11, remaining: 249989 } });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const board = await fetchBoard('NFL', { force: true, eventLimit: 1, includeAlternates: true });
  const demon = board.props.find((row) => row.providerOutcomeId === 'pp-demon');
  const boost = board.props.find((row) => row.providerOutcomeId === 'ud-boost');
  assert.equal(demon.specialVerified, true);
  assert.equal(demon.specialSideVerified, true);
  assert.equal(demon.specialType, 'demon');
  assert.equal(demon.dfsOddsType, 'demon');
  assert.equal(demon.lineGap, 10);
  assert.equal(demon.bookOutcomeId, 'projection-9');
  assert.equal(boost.specialVerified, true);
  assert.equal(boost.specialType, 'boost');
  assert.equal(boost.payoutMultiplier, 1.4);
  assert.equal(boost.bookOutcomeId, 'option-4');
  for (const id of ['ud-null', 'ud-empty']) {
    const regular = board.props.find(row => row.providerOutcomeId === id);
    assert.ok(regular);
    assert.equal(regular.isAlternate, false);
    assert.equal(regular.specialVerified, false);
    assert.equal(regular.specialType, null);
  }
});

test('missing and invalid payout multipliers never hide regular props as alternates', () => {
  for (const payout_multiplier of [undefined, null, '', false, true, 0, -1, 'unknown', 1]) assert.equal(isAlternateOutcome({ payout_multiplier }), false);
  assert.equal(isAlternateOutcome({ payout_multiplier: 0.8 }), true);
  assert.equal(isAlternateOutcome({ payout_multiplier: 1.4 }), true);
  assert.equal(isAlternateOutcome({ dfs_odds_type: 'goblin', payout_multiplier: null }), true);
});

test('cached supplement attaches native IDs only to the verified game and exact quote period', async t => {
  const env = ['PROPLINE_SUPPLEMENT_ENABLED', 'PROPLINE_SUPPLEMENT_SPORTS'];
  const saved = Object.fromEntries(env.map(key => [key, process.env[key]]));
  t.after(() => { for (const key of env) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } __resetProplineSupplement(); });
  process.env.PROPLINE_API_KEY = 'test-only-key';
  process.env.PROPLINE_SUPPLEMENT_ENABLED = 'true';
  process.env.PROPLINE_SUPPLEMENT_SPORTS = 'NFL';
  process.env.PROPLINE_MARKETS_NFL = 'player_pass_yds';
  process.env.PROPLINE_BOOKMAKERS = 'prizepicks';
  __resetProplineProvider(); __resetProplineClient(); __resetProplineSupplement();
  const start = new Date(Date.now() + 3_600_000).toISOString();
  const event = { id: 'native-enrichment-game', sport_key: 'football_nfl', commence_time: start, home_team: 'Home', away_team: 'Away' };
  let calls = 0;
  globalThis.fetch = async input => {
    calls++;
    const path = new URL(String(input)).pathname;
    const quota = { limit: 25000, remaining: 24990 };
    if (path === '/v1/sports') return jsonResponse([], { quota });
    if (path.endsWith('/events')) return jsonResponse([event], { quota });
    if (path.endsWith('/odds')) return jsonResponse({ ...event, bookmakers: [{ key: 'prizepicks', markets: [{ key: 'player_pass_yds', outcomes: [{ name: 'Over', description: 'Fixture Quarterback', player_id: 'native-player', point: 250.5, price: 100, dfs_odds_type: 'standard', outcome_id: 'native-outcome' }] }] }] }, { quota });
    throw new Error('Unexpected fixture request');
  };
  await proplineGet('/v1/sports');
  const refreshed = await maybeRefreshProplineSupplement();
  assert.equal(refreshed.skipped, false, JSON.stringify(refreshed));
  const before = calls;
  const base = { sport: 'NFL', provider: 'prizepicks', eventId: 'public-event', playerName: 'Fixture Quarterback', marketId: 'player_pass_yds', sportsbookKey: 'prizepicks', side: 'OVER', line: 250.5, gameStartTime: start, homeTeam: 'Home', awayTeam: 'Away' };
  const merged = mergeCachedPropline({ props: [{ ...base, id: 'exact' }, { ...base, id: 'period', period: 'h1' }, { ...base, id: 'other-player', playerName: 'Different Player' }, { ...base, id: 'other-game', gameStartTime: new Date(Date.parse(start) + 3_600_000).toISOString() }] }, 'NFL');
  const exact = merged.props.find(row => row.id === 'exact');
  assert.equal(exact.eventId, 'public-event');
  assert.equal(exact.proplineEventId, 'native-enrichment-game');
  assert.equal(exact.proplinePlayerId, 'native-player');
  assert.equal(exact.proplineOutcomeId, 'native-outcome');
  for (const id of ['period', 'other-player']) {
    const row = merged.props.find(row => row.id === id);
    assert.equal(row.proplineEventId, 'native-enrichment-game');
    assert.equal(row.proplineOutcomeId, undefined);
  }
  assert.equal(merged.props.find(row => row.id === 'other-game').proplineEventId, undefined);
  assert.equal(calls, before, 'enrichment is a zero-network cache operation');
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
