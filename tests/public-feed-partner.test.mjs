import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPublicFeeds, PUBLIC_FEEDS } from '../lib/ingestion/public-feeds.mjs';

const start = new Date(Date.now() + 24 * 3600_000).toISOString();
const fixture = {
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
    { id: 'game-1', type: 'game', attributes: { start_time: start, home_team: 'BOS', away_team: 'NYK', status: 'scheduled' } },
  ],
};

test('production PrizePicks feed uses the keyless partner projection host', () => {
  const feed = PUBLIC_FEEDS.find((row) => row.id === 'prizepicks');
  assert.ok(feed);
  assert.equal(new URL(feed.url).hostname, 'partner-api.prizepicks.com');
  assert.equal(new URL(feed.url).pathname, '/projections');
});

test('changing a feed revision clears only the saved failed cooldown and retries once', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoscout-public-feed-'));
  const saved = {
    version: 1,
    feeds: {
      prizepicks: {
        records: [], contracts: [], players: [], failures: 5, status: 'unavailable', httpStatus: 403,
        nextAt: Date.now() + 3600_000,
        revision: 1,
      },
    },
  };
  await fs.writeFile(path.join(dir, 'public-feeds-v1.json'), JSON.stringify(saved));
  let calls = 0;
  const feed = { id: 'prizepicks', url: 'https://partner-api.prizepicks.com/projections?per_page=250', ttl: 180000, revision: 2 };
  const feeds = createPublicFeeds({
    storeDir: dir,
    feeds: [feed],
    fetcher: async (url) => {
      calls++;
      assert.equal(new URL(url).hostname, 'partner-api.prizepicks.com');
      return new Response(JSON.stringify(fixture), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  try {
    const snapshot = await feeds.refreshFeed('prizepicks');
    assert.equal(calls, 1);
    assert.equal(snapshot.status, 'available');
    assert.equal(snapshot.httpStatus, 200);
    assert.equal(snapshot.failures, 0);
    assert.equal(snapshot.revision, 2);
    assert.equal(snapshot.records.length, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
