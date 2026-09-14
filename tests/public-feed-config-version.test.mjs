import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPublicFeeds } from '../lib/ingestion/public-feeds.mjs';

// Underdog's beta endpoints started answering 426 permanently. Each failure
// lengthened the backoff, and that backoff is persisted. Pointing the feed at a
// working endpoint therefore changed nothing until the stale cooldown expired,
// because refreshOne() honours a persisted nextAt. FEED_CONFIG_VERSION exists
// to invalidate exactly that, so a feed whose config has changed must refetch
// immediately rather than serve out a cooldown earned by a dead URL.
async function storeWith(state) {
  const dir = await mkdtemp(path.join(tmpdir(), 'feed-config-'));
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'public-feeds-v1.json'),
    JSON.stringify({ version: 1, feeds: state }));
  return dir;
}

const stalled = (configVersion, now) => ({
  underdog: {
    records: [], contracts: [], players: [],
    status: 'unavailable', httpStatus: 426, failures: 17,
    nextAt: now + 3600_000, configVersion,
  },
});

const feed = { id: 'underdog', urls: ['https://example.invalid/v1'], ttl: 180000 };

test('a persisted cooldown from an older config does not suppress the refetch', async () => {
  const now = Date.now();
  const dir = await storeWith(stalled(3, now));
  let called = 0;
  const fetcher = async () => { called++; return {
    ok: true, status: 200, headers: new Map(),
    json: async () => ({ over_under_lines: [], players: [], appearances: [] }),
    text: async () => JSON.stringify({ over_under_lines: [], players: [], appearances: [] }),
  }; };
  const feeds = createPublicFeeds({ fetcher, storeDir: dir, feeds: [feed], now: () => now });
  await feeds.refreshFeed('underdog');
  assert.equal(called, 1, 'a changed feed config must refetch despite the stored backoff');
});

const shippedVersion = async () => {
  const fs = await import('node:fs/promises');
  const source = await fs.readFile(new URL('../lib/ingestion/public-feeds.mjs', import.meta.url), 'utf8');
  return Number(/const FEED_CONFIG_VERSION=(\d+);/.exec(source)[1]);
};

test('a cooldown from the current config is still honoured', async () => {
  const now = Date.now();
  const dir = await storeWith(stalled(await shippedVersion(), now));
  let called = 0;
  const fetcher = async () => { called++; throw new Error('should not be called'); };
  const feeds = createPublicFeeds({ fetcher, storeDir: dir, feeds: [feed], now: () => now });
  await feeds.refreshFeed('underdog');
  assert.equal(called, 0, 'an unchanged config must still back off as intended');
});

test('the shipped config version is ahead of the one that stalled Underdog', async () => {
  const version = await shippedVersion();
  assert.ok(version > 3, `changing the Underdog endpoints requires a bump, got ${version}`);
});
