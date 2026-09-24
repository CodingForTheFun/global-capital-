import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('watchlist persistence is bounded, deduped and account-scoped', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'oblige-watchlist-'));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  try {
    const watchlist = await import('../lib/auth/watchlist.mjs?test=' + Date.now());
    const base = { sport: 'NBA', player: 'Player One', market: 'Points', line: 20.5, period: 'game' };

    let items = await watchlist.upsertWatchlistItem('user-a', { ...base, key: 'prop-1' });
    assert.equal(items.length, 1);
    assert.equal(items[0].key, 'prop-1');

    items = await watchlist.upsertWatchlistItem('user-a', { ...base, key: 'prop-1', line: 21.5 });
    assert.equal(items.length, 1, 'same key is replaced, not duplicated');
    assert.equal(items[0].line, 21.5);

    assert.deepEqual(await watchlist.listWatchlist('user-b'), [], 'another account cannot see the saved prop');

    for (let i = 0; i < 110; i += 1) {
      await watchlist.upsertWatchlistItem('user-a', { ...base, key: 'prop-' + (i + 2), line: i + 0.5 });
    }
    items = await watchlist.listWatchlist('user-a');
    assert.equal(items.length, 100, 'watchlist is bounded to 100 items');

    items = await watchlist.removeWatchlistItem('user-a', items[0].key);
    assert.equal(items.length, 99);
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test('watchlist rejects incomplete and oversized input', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'oblige-watchlist-invalid-'));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  try {
    const watchlist = await import('../lib/auth/watchlist.mjs?invalid=' + Date.now());
    assert.throws(
      () => watchlist.sanitizeWatchlistItem({ key: 'x', sport: 'NBA', player: 'P', market: 'Points', line: 'not-a-number' }),
      /incomplete/,
    );
    assert.throws(
      () => watchlist.sanitizeWatchlistItem({ key: 'x'.repeat(321), sport: 'NBA', player: 'P', market: 'Points', line: 1 }),
      /incomplete/,
    );
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
