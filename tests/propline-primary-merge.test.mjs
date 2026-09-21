import test from 'node:test';
import assert from 'node:assert/strict';

import { __resetProplineClient, proplineGet } from '../lib/data-sources/propline/client.mjs';
import { __resetProplineProvider } from '../lib/autoscout/providers/propline.mjs';
import {
  __resetProplineSupplement,
  maybeRefreshProplineSupplement,
  mergeCachedPropline,
} from '../lib/ingestion/propline-supplement.mjs';
import { changedSnapshots } from '../lib/autoscout/supabase-persistence.mjs';

function jsonResponse(body, { limit = 25000, used = 20, remaining = 24980 } = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'x-daily-limit': String(limit),
      'x-daily-used': String(used),
      'x-daily-remaining': String(remaining),
      'x-daily-reset': String(Math.floor(Date.now() / 1000) + 3600),
    },
  });
}

test('fresh PropLine wins conflicting quote slots while identical presence stays fresh without fake history', async t => {
  const keys = [
    'PROPLINE_API_KEY',
    'PROPLINE_SUPPLEMENT_ENABLED',
    'PROPLINE_SUPPLEMENT_SPORTS',
    'PROPLINE_MARKETS_NFL',
    'PROPLINE_BOOKMAKERS',
  ];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const oldFetch = globalThis.fetch;
  t.after(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    globalThis.fetch = oldFetch;
    __resetProplineClient();
    __resetProplineProvider();
    __resetProplineSupplement();
  });

  process.env.PROPLINE_API_KEY = 'test-key';
  process.env.PROPLINE_SUPPLEMENT_ENABLED = 'true';
  process.env.PROPLINE_SUPPLEMENT_SPORTS = 'NFL';
  process.env.PROPLINE_MARKETS_NFL = 'player_pass_yds';
  process.env.PROPLINE_BOOKMAKERS = 'draftkings,fanduel';

  __resetProplineClient();
  __resetProplineProvider();
  __resetProplineSupplement();

  const start = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
  const seenAt = new Date().toISOString();
  const changedAt = new Date(Date.now() - 30 * 60_000).toISOString();
  const event = {
    id: 'prop-event',
    sport_key: 'football_nfl',
    commence_time: start,
    home_team: 'Home',
    away_team: 'Away',
  };

  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/v1/sports') return jsonResponse([]);
    if (url.pathname.endsWith('/events')) return jsonResponse([event]);
    if (url.pathname.endsWith('/odds')) {
      return jsonResponse({
        ...event,
        bookmakers: ['draftkings', 'fanduel'].map((book) => ({
          key: book,
          title: book === 'draftkings' ? 'DraftKings' : 'FanDuel',
          last_update: seenAt,
          markets: [{
            key: 'player_pass_yds',
            title: 'Passing Yards',
            period: 'game',
            last_update: seenAt,
            outcomes: [{
              name: 'Over',
              description: 'Priority Quarterback',
              player_id: 'nfl:priority-player',
              point: 250.5,
              price: -110,
              outcome_id: `${book}-over`,
              last_change_at: changedAt,
              last_seen_at: seenAt,
            }],
          }],
        })),
      });
    }
    throw new Error('Unexpected PropLine URL: ' + url);
  };

  await proplineGet('/v1/sports');
  const refresh = await maybeRefreshProplineSupplement();
  assert.equal(refresh.skipped, false, JSON.stringify(refresh));

  const oldObservation = new Date(Date.now() - 20 * 60_000).toISOString();
  const common = {
    source: 'Public',
    provider: 'public',
    sport: 'NFL',
    eventId: 'public-event',
    playerId: 'public-player',
    providerPlayerId: 'public-player',
    playerName: 'Priority Quarterback',
    team: 'Home',
    position: 'QB',
    marketId: 'player_pass_yds',
    market: 'Passing Yards',
    side: 'OVER',
    gameStartTime: start,
    homeTeam: 'Home',
    awayTeam: 'Away',
    live: false,
    completed: false,
    isAlternate: false,
    ingestedAt: oldObservation,
    updatedAt: oldObservation,
  };
  const base = {
    props: [
      { ...common, id: 'same-dk', sportsbook: 'DraftKings', sportsbookKey: 'draftkings', period: 'game', line: 250.5, price: -110 },
      { ...common, id: 'stale-fd', sportsbook: 'FanDuel', sportsbookKey: 'fanduel', period: 'game', line: 249.5, price: -105 },
      { ...common, id: 'h1-dk', sportsbook: 'DraftKings', sportsbookKey: 'draftkings', period: 'h1', line: 121.5, price: -110 },
    ],
    data: { events: [], players: [], props: [], lines: [] },
    meta: { provider: 'Public', fetchedAt: oldObservation, ingestionTimestamp: oldObservation },
  };

  const merged = mergeCachedPropline(base, 'NFL');

  const same = merged.props.find((row) => row.id === 'same-dk');
  assert.ok(same);
  assert.equal(same.line, 250.5);
  assert.equal(same.price, -110);
  assert.equal(same.presenceSource, 'propline');
  assert.equal(same.proplinePlayerId, 'nfl:priority-player');
  assert.equal(same.ingestedAt, seenAt);

  const fanduelSlots = merged.props.filter((row) => row.sportsbookKey === 'fanduel' && row.period === 'game' && row.side === 'OVER');
  assert.equal(fanduelSlots.length, 1, 'primary replacement must not leave a duplicate stale slot');
  const fanduel = fanduelSlots[0];
  assert.ok(fanduel);
  assert.equal(fanduel.id, 'stale-fd', 'canonical row identity stays stable while its quote is refreshed');
  assert.equal(fanduel.provider, 'propline');
  assert.equal(fanduel.line, 250.5);
  assert.equal(fanduel.price, -110);
  assert.equal(fanduel.eventId, 'public-event', 'preferred quote must retain canonical event identity');
  assert.equal(fanduel.playerId, 'public-player', 'preferred quote must retain canonical player identity');
  assert.equal(fanduel.providerPlayerId, 'nfl:priority-player', 'providerPlayerId follows the quote provider while canonical playerId stays stable');
  assert.equal(fanduel.proplinePlayerId, 'nfl:priority-player');

  const half = merged.props.find((row) => row.id === 'h1-dk');
  assert.ok(half);
  assert.equal(half.line, 121.5, 'full-game PropLine quote must not replace 1H');
  assert.equal(half.proplineOutcomeId, undefined);

  assert.equal(merged.meta.proplineSupplement.prioritized, 1);
  assert.ok(merged.meta.proplineSupplement.presenceRefreshed >= 1);
  assert.deepEqual(
    new Set(merged.data.lines.map((row) => row.id)),
    new Set(merged.props.map((row) => row.id)),
    'normalized persistence must match the rows actually served',
  );
  const normalizedFanduelLine = merged.data.lines.find((row) => row.id === fanduel.id);
  const normalizedFanduelProp = merged.data.props.find((row) => row.id === normalizedFanduelLine?.propId);
  assert.ok(normalizedFanduelLine);
  assert.ok(normalizedFanduelProp);
  assert.equal(normalizedFanduelProp.eventId, 'public-event');
  assert.equal(normalizedFanduelProp.playerId, 'public-player');

  const seen = new Map();
  const before = { propId: 'quote', bookmakerKey: 'draftkings', side: 'OVER', line: 250.5, price: -110, ingestedAt: oldObservation };
  const presenceOnly = { ...before, ingestedAt: seenAt };
  assert.deepEqual(changedSnapshots([before], seen), []);
  assert.deepEqual(changedSnapshots([presenceOnly], seen), [], 'presence refresh cannot manufacture line history');
  const moved = changedSnapshots([{ ...presenceOnly, line: 251.5 }], seen);
  assert.equal(moved.length, 1);
});
