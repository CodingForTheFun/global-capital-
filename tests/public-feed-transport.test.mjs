import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicFeeds } from '../lib/ingestion/public-feeds.mjs';

const start = new Date(Date.now() + 24 * 3600_000).toISOString();
const prizePicksFixture = {
  data: [{
    id: 'projection-1',
    type: 'projection',
    attributes: { stat_type: 'Points', line_score: 24.5, start_time: start, status: 'pre_game' },
    relationships: {
      new_player: { data: { id: 'player-1', type: 'new_player' } },
      league: { data: { id: 'league-1', type: 'league' } },
      game: { data: { id: 'game-1', type: 'game' } },
    },
  }],
  included: [
    { id: 'player-1', type: 'new_player', attributes: { name: 'Fixture Player', team: 'BOS', position: 'G' } },
    { id: 'league-1', type: 'league', attributes: { name: 'NBA' } },
    { id: 'game-1', type: 'game', attributes: { start_time: start, home_team: 'BOS', away_team: 'NYK' } },
  ],
};

test('PrizePicks direct feed uses HTTP2 and fails over to the public partner origin on 403', async () => {
  const calls = [];
  let fetchCalls = 0;
  const feeds = createPublicFeeds({
    fetcher: async () => { fetchCalls++; throw new Error('HTTP1 fetch must not be used'); },
    http2Fetcher: async (url, headers) => {
      calls.push({ url, headers });
      const host = new URL(url).hostname;
      if (host === 'api.prizepicks.com') throw Object.assign(new Error('blocked'), { status: 403 });
      assert.equal(host, 'partner-api.prizepicks.com');
      return prizePicksFixture;
    },
    feeds: [{
      id: 'prizepicks',
      url: 'https://api.prizepicks.com/projections?per_page=250',
      ttl: 180000,
      http2: true,
      origin: 'https://app.prizepicks.com',
      referer: 'https://app.prizepicks.com/',
      fallbackOrigins: ['https://partner-api.prizepicks.com'],
    }],
  });

  const snapshot = await feeds.refreshFeed('prizepicks');
  assert.equal(fetchCalls, 0);
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[0].url).hostname, 'api.prizepicks.com');
  assert.equal(new URL(calls[1].url).hostname, 'partner-api.prizepicks.com');
  assert.equal(calls[0].headers.referer, 'https://app.prizepicks.com/');
  assert.ok(calls[0].headers['x-device-id']);
  assert.equal(snapshot.status, 'available');
  assert.equal(snapshot.httpStatus, 200);
  assert.equal(snapshot.records.length, 1);
  assert.equal(snapshot.records[0].book, 'prizepicks');
});
