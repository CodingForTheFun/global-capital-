import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createVerifiedArtwork, pruneVerifiedArtworkCache } from '../lib/autoscout/providers/verified-artwork.mjs';
import { createPublicFeeds } from '../lib/ingestion/public-feeds.mjs';

test('verified artwork retention removes expired/orphaned files and enforces its byte budget', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'oblige-artwork-retention-'));
  const directory = path.join(root, 'verified-player-artwork-v2');
  const now = Date.now();
  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'older.img'), Buffer.alloc(60));
    writeFileSync(path.join(directory, 'newer.img'), Buffer.alloc(60));
    writeFileSync(path.join(directory, 'expired.img'), Buffer.alloc(40));
    writeFileSync(path.join(directory, 'orphan.img'), Buffer.alloc(30));

    const index = {
      older: { file: 'older.img', expires: now + 60_000 },
      newer: { file: 'newer.img', expires: now + 120_000 },
      expired: { file: 'expired.img', expires: now - 1 },
      missing: { file: 'missing.img', expires: now + 120_000 },
      placeholder: { file: null, expires: now + 120_000 },
    };

    const result = pruneVerifiedArtworkCache(directory, index, { nowMs: now, maxBytes: 100, maxEntries: 50 });

    assert.equal(index.expired, undefined);
    assert.equal(index.missing, undefined);
    assert.equal(index.older, undefined);
    assert.ok(index.newer);
    assert.ok(index.placeholder);
    assert.equal(existsSync(path.join(directory, 'expired.img')), false);
    assert.equal(existsSync(path.join(directory, 'orphan.img')), false);
    assert.equal(existsSync(path.join(directory, 'older.img')), false);
    assert.equal(existsSync(path.join(directory, 'newer.img')), true);
    assert.equal(result.retainedBytes, 60);
    assert.ok(result.freedBytes >= 130);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('verified artwork startup removes only the superseded legacy artwork namespace', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'oblige-artwork-legacy-'));
  try {
    const legacy = path.join(root, 'player-artwork');
    const verified = path.join(root, 'verified-player-artwork-v2');
    mkdirSync(legacy, { recursive: true });
    mkdirSync(verified, { recursive: true });
    writeFileSync(path.join(legacy, 'old.png'), Buffer.alloc(32));
    writeFileSync(path.join(verified, 'index.json'), '{}');

    createVerifiedArtwork({ dataDir: root, fetchImpl: async () => { throw new Error('network should not run'); } });

    assert.equal(existsSync(legacy), false);
    assert.equal(existsSync(verified), true);
    assert.deepEqual(JSON.parse(readFileSync(path.join(verified, 'index.json'), 'utf8')), {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('public feed startup removes stale atomic temp snapshots but leaves a recent writer alone', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'oblige-public-feed-temp-'));
  const canonical = path.join(root, 'public-feeds-v1.json');
  const stale = canonical + '.old.tmp';
  const recent = canonical + '.recent.tmp';
  try {
    writeFileSync(canonical, JSON.stringify({ version: 1, feeds: {} }));
    writeFileSync(stale, 'stale');
    writeFileSync(recent, 'recent');
    const old = new Date(Date.now() - 20 * 60 * 1000);
    utimesSync(stale, old, old);

    const feeds = createPublicFeeds({ storeDir: root, feeds: [] });
    await feeds.load();

    assert.equal(existsSync(canonical), true);
    assert.equal(existsSync(stale), false);
    assert.equal(existsSync(recent), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
