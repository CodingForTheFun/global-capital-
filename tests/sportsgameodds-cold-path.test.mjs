import test from 'node:test';
import assert from 'node:assert/strict';

function freshPersistedRow() {
  const now = new Date().toISOString();
  return {
    id: 'sgo-cold-path-dk-over',
    source: 'SportsGameOdds',
    provider: 'sportsgameodds',
    sport: 'NBA',
    eventId: 'sgo-cold-event',
    playerId: 'sgo-cold-player',
    providerPlayerId: 'PLAYER_1_NBA',
    playerName: 'Cold Path Player',
    team: 'Home Team',
    position: 'PG',
    marketId: 'player_points',
    market: 'Points',
    period: 'game',
    side: 'OVER',
    line: 24.5,
    price: -110,
    sportsbook: 'DraftKings',
    sportsbookKey: 'draftkings',
    gameStartTime: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
    homeTeam: 'Home Team',
    awayTeam: 'Away Team',
    live: false,
    completed: false,
    isAlternate: false,
    ingestedAt: now,
    observedAt: now,
    providerUpdatedAt: now,
    updatedAt: now,
  };
}

test('fresh persisted SGO board resolves before demand refresh starts', async () => {
  const previous = {
    mode: process.env.OBLIGE_PROP_PROVIDER_MODE,
    key: process.env.SPORTS_ODDS_API_KEY_HEADER,
    url: process.env.AUTOSCOUT_SUPABASE_URL,
    anon: process.env.AUTOSCOUT_SUPABASE_PUBLISHABLE_KEY,
    token: process.env.AUTOSCOUT_SUPABASE_INGEST_TOKEN,
    radar: process.env.SPORTRADAR_API_KEY,
  };
  const oldFetch = globalThis.fetch;
  const order = [];
  let eventCalls = 0;

  process.env.OBLIGE_PROP_PROVIDER_MODE = 'SGO';
  process.env.SPORTS_ODDS_API_KEY_HEADER = 'test-sgo-key';
  process.env.AUTOSCOUT_SUPABASE_URL = 'https://test.supabase.local';
  process.env.AUTOSCOUT_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
  process.env.AUTOSCOUT_SUPABASE_INGEST_TOKEN = 'test-ingest-token';
  delete process.env.SPORTRADAR_API_KEY;

  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'test.supabase.local') {
      order.push('persisted-read');
      return new Response(JSON.stringify({ rows: [freshPersistedRow()] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname.endsWith('/account/usage')) {
      order.push('sgo-usage');
      return new Response(JSON.stringify({
        success: true,
        data: {
          tier: 'rookie',
          rateLimits: {
            'per-month': { 'max-entities': 100000, 'current-entities': 1000 },
          },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname.endsWith('/events')) {
      order.push('sgo-events');
      eventCalls += 1;
      return new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error('Unexpected cold-path test URL: ' + url);
  };

  try {
    const { __resetSportsGameOddsClient } = await import('../lib/data-sources/sportsgameodds/client.mjs');
    const { __resetSportsGameOddsProvider } = await import('../lib/autoscout/providers/sportsgameodds.mjs');
    __resetSportsGameOddsClient();
    __resetSportsGameOddsProvider();

    const { fetchUnifiedBoard } = await import(`../apex-v2/provider.mjs?issue520=${Date.now()}`);
    const board = await fetchUnifiedBoard('NBA');
    order.push('board-resolved');

    assert.equal(board.props.length, 1);
    assert.equal(board.props[0].provider, 'sportsgameodds');
    assert.equal(board.meta.requestTimingMs.source, 'persisted');
    assert.equal(board.meta.requestTimingMs.liveFetch, 0);
    assert.equal(board.meta.requestTimingMs.backgroundRefreshScheduled, true);
    assert.equal(order[0], 'persisted-read');
    assert.equal(order.includes('sgo-usage'), false, 'live SGO work must not enter the response critical path');
    assert.equal(order.includes('sgo-events'), false, 'paid event fetch must not enter the response critical path');

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.ok(order.indexOf('sgo-usage') > order.indexOf('board-resolved'));
    assert.ok(order.indexOf('sgo-events') > order.indexOf('board-resolved'));
    assert.equal(eventCalls, 1, 'cold persisted hit still schedules exactly one deduplicated live refresh');
  } finally {
    globalThis.fetch = oldFetch;
    for (const [name, value] of [
      ['OBLIGE_PROP_PROVIDER_MODE', previous.mode],
      ['SPORTS_ODDS_API_KEY_HEADER', previous.key],
      ['AUTOSCOUT_SUPABASE_URL', previous.url],
      ['AUTOSCOUT_SUPABASE_PUBLISHABLE_KEY', previous.anon],
      ['AUTOSCOUT_SUPABASE_INGEST_TOKEN', previous.token],
      ['SPORTRADAR_API_KEY', previous.radar],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    const { __resetSportsGameOddsClient } = await import('../lib/data-sources/sportsgameodds/client.mjs');
    const { __resetSportsGameOddsProvider } = await import('../lib/autoscout/providers/sportsgameodds.mjs');
    __resetSportsGameOddsClient();
    __resetSportsGameOddsProvider();
  }
});
