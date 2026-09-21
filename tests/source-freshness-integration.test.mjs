import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http2 from 'node:http2';
import { createPublicFeeds } from '../lib/ingestion/public-feeds.mjs';
import { createPublicIngestionRunner } from '../lib/ingestion/public-worker.mjs';

const BASE = Date.parse('2026-09-19T10:00:00Z');
const feed = { id: 'underdog', urls: ['https://feed.example/primary', 'https://feed.example/spare'], ttl: 180_000 };

test('primary timeout plus spare 426 retains genuine last-known-good and respects existing backoff', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oblige-source-'));
  let calls = 0, cancellations = 0;
  const record = { id: 'fixture', sport: 'NFL', gameStartTime: '2026-09-20T10:00:00Z', line: 2.5 };
  const lastGood = '2026-09-19T09:55:00Z';
  await fs.writeFile(path.join(dir, 'public-feeds-v1.json'), JSON.stringify({ version: 1, feeds: {
    underdog: { records: [record], players: [], contracts: [], specials: [], fetchedAt: lastGood,
      nextAt: 0, status: 'available', failures: 0, configVersion: 5 },
  } }));
  try {
    const feeds = createPublicFeeds({ storeDir: dir, now: () => BASE, feeds: [feed], fetcher: async url => {
      calls++;
      if (url.endsWith('/primary')) throw new DOMException('timed out', 'TimeoutError');
      return { ok: false, status: 426, headers: new Headers(), body: { cancel() { cancellations++; return Promise.resolve(); } } };
    } });
    const snapshot = await feeds.refreshFeed('underdog');
    assert.equal(snapshot.primaryCode, 'PUBLIC_FEED_TIMEOUT');
    assert.equal(snapshot.httpStatus, 426);
    assert.equal(snapshot.fetchedAt, lastGood); assert.deepEqual(snapshot.records, [record]);
    assert.equal(snapshot.observability.attempts.length, 2);
    assert.equal(snapshot.observability.primaryHttpStatus, null);
    assert.equal(feeds.health()[0].freshness.primaryCode, 'PUBLIC_FEED_TIMEOUT');
    assert.equal(cancellations, 1); assert.equal(calls, 2);
    assert.ok(snapshot.nextAt >= BASE + 60_000 && snapshot.nextAt < BASE + 70_000);
    await feeds.refreshFeed('underdog'); assert.equal(calls, 2);
    const reloaded = createPublicFeeds({ storeDir: dir, now: () => BASE, feeds: [feed], fetcher: async () => { throw new Error('unexpected request'); } });
    await reloaded.load();
    assert.equal(reloaded.health()[0].freshness.lastAttemptAt, new Date(BASE).toISOString());
    assert.equal((await reloaded.refreshFeed('underdog')).fetchedAt, lastGood);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('passive coverage read runs from existing refresh and cannot prevent later sources progressing', async () => {
  let observed = 0, requests = 0;
  const feeds = createPublicFeeds({ now: () => BASE, feeds: [{ id: 'sleeper', url: 'https://feed.example', ttl: 180_000 }],
    fetcher: async () => { requests++; return new Response('{}'); },
    observeCoverage: async health => { observed++; assert.equal(health[0].id, 'sleeper'); throw new Error('diagnostic-only'); },
  });
  await feeds.refresh(); await feeds.refresh();
  assert.equal(observed, 2); assert.equal(requests, 1);
});

test('worker skips every fallback and all Underdog writes on a primary timeout, while releasing its real lease', async () => {
  const before = process.env.AUTOSCOUT_DRAFTKINGS_PUBLIC_ENABLED;
  const connect = http2.connect;
  let connections = 0;
  process.env.AUTOSCOUT_DRAFTKINGS_PUBLIC_ENABLED = 'false';
  http2.connect = () => { connections++; throw new Error('unexpected HTTP2 request'); };
  const writes = [], statuses = [], releases = [];
  try {
    const runner = createPublicIngestionRunner({ now: () => BASE,
      feeds: { refreshFeed: async source => source === 'underdog'
        ? { status: 'unavailable', primaryCode: 'PUBLIC_FEED_TIMEOUT', httpStatus: 426, fetchedAt: '2026-09-19T09:55:00Z', nextAt: BASE + 60_000 }
        : { status: 'no_props', records: [], fetchedAt: new Date(BASE).toISOString() } },
      claim: async () => ({ claimed: true, owner: 'test-owned-lease' }),
      release: async owner => { releases.push(owner); },
      persistSnapshot: async source => { writes.push(source); return { written: 0 }; },
      recordStatus: async (source, state) => { statuses.push({ source, ...state }); },
    });
    const result = await runner.cycle();
    assert.deepEqual(writes, ['prizepicks']); assert.equal(connections, 0);
    assert.deepEqual(releases, ['test-owned-lease']);
    const underdog = result.results.find(row => row.source === 'underdog');
    assert.equal(underdog.retained, true); assert.equal(underdog.fallbackDeferred, true); assert.equal(underdog.persisted, false);
    assert.equal(statuses.find(row => row.source === 'underdog').fetchedAt, '2026-09-19T09:55:00Z');
  } finally {
    http2.connect = connect;
    if (before === undefined) delete process.env.AUTOSCOUT_DRAFTKINGS_PUBLIC_ENABLED;
    else process.env.AUTOSCOUT_DRAFTKINGS_PUBLIC_ENABLED = before;
  }
});
