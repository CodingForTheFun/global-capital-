import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('watchlist stores bounded optional event and market identity', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'oblige-watchlist-identity-'));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  try {
    const watchlist = await import('../lib/auth/watchlist.mjs?identity=' + Date.now());
    const item = watchlist.sanitizeWatchlistItem({
      key: 'prop-1',
      sport: 'NBA',
      player: 'Player One',
      market: 'Points',
      line: 20.5,
      period: 'game',
      eventId: 'event-123',
      marketId: 'player_points',
    });
    assert.equal(item.eventId, 'event-123');
    assert.equal(item.marketId, 'player_points');

    const oversized = watchlist.sanitizeWatchlistItem({
      key: 'prop-2',
      sport: 'NBA',
      player: 'Player Two',
      market: 'Points',
      line: 21.5,
      period: 'game',
      eventId: 'e'.repeat(241),
      marketId: 'm'.repeat(201),
    });
    assert.equal(oversized.eventId, null);
    assert.equal(oversized.marketId, null);
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
