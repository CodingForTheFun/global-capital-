import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchPublicFeedJson } from '../lib/ingestion/public-feed-transport.mjs';
import { createSourceCoverageObserver } from '../lib/ingestion/source-coverage-observer.mjs';
import { feedFreshness, feedObservation } from '../lib/ingestion/source-freshness.mjs';

test('transport diagnostics cannot accidentally make other sources fallback-eligible', async () => {
  await assert.rejects(fetchPublicFeedJson('https://feed.example', {
    fetcher: async () => { throw new DOMException('timed out', 'TimeoutError'); },
  }), error => error.name === 'TimeoutError' && error.endpoint === undefined);
  await assert.rejects(fetchPublicFeedJson('https://feed.example', {
    fetcher: async () => { throw new TypeError('fetch failed'); },
  }), error => error instanceof TypeError && error.endpoint === undefined);
});

test('a late successful body after diagnostic timeout never emits healthy coverage', async () => {
  const clock = Date.parse('2026-09-19T10:00:00Z');
  const logs = [];
  const source = id => ({ source: id, activeRows: 10, freshRows: 10, staleRows: 0,
    expiringRows: 0, expiredUpcomingRows: 0, fetchStatus: 'available', fetchedAt: new Date(clock).toISOString(), retained: false });
  const observer = createSourceCoverageObserver({ now: () => clock, timeoutMs: 2, emit: row => logs.push(row),
    config: () => ({ url: 'https://db.example', key: 'test', token: 'test' }),
    fetcher: async () => ({ ok: true, json: async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return { dbNow: new Date(clock).toISOString(), sources: [source('underdog'), source('prizepicks')] };
    } }),
  });
  assert.equal((await observer.observe()).ok, false);
  assert.equal(logs.some(row => row.level === 'healthy'), false);
});

test('malformed optional persisted telemetry cannot break source health', () => {
  assert.equal(feedFreshness({ observability: { history: {} } }, Date.now()).flapping, false);
  const now = Date.now();
  const next = feedObservation({ observability: { history: [null, {}] } }, { startedAt: now, endedAt: now, ok: false });
  assert.equal(next.history.length, 1);
});
