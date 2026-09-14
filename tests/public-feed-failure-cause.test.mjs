// PrizePicks is the single largest source on the board. Its projections
// response outgrew the size this replica will buffer, so the primary endpoint
// was rejected before it could be parsed, the request fell through to a spare
// URL that answers 403, and health reported the 403 - an access problem that
// was never the cause. The feed looked like a permissions issue for as long as
// nobody read the code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicFeeds } from '../lib/ingestion/public-feeds.mjs';

const feed = { id: 'probe', urls: ['https://primary.test/a', 'https://spare.test/a'], ttl: 1000 };
const health = feeds => feeds.health().find(f => f.id === 'probe');

test('an oversized response is reported as oversized, not as the spare URL 403', async () => {
  const big = 'x'.repeat(17 * 1024 * 1024);
  const feeds = createPublicFeeds({ feeds: [feed], fetcher: async url =>
    url.includes('primary')
      ? new Response(big, { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response('no', { status: 403 }) });
  await feeds.refresh();
  const row = health(feeds);
  assert.equal(row.status, 'unavailable');
  assert.equal(row.reason, 'PUBLIC_FEED_TOO_LARGE', 'the first cause must survive the fallback');
  assert.equal(row.httpStatus, 403, 'the spare URL response is still recorded');
});

test('a plain outage still reports the status it actually got', async () => {
  const feeds = createPublicFeeds({ feeds: [feed], fetcher: async () => new Response('no', { status: 500 }) });
  await feeds.refresh();
  assert.equal(health(feeds).httpStatus, 500);
  assert.notEqual(health(feeds).reason, 'PUBLIC_FEED_TOO_LARGE');
});

test('the size ceiling is configurable, because it is a memory decision', async () => {
  const payload = JSON.stringify({ ok: true, pad: 'x'.repeat(2 * 1024 * 1024) });
  const build = () => createPublicFeeds({ feeds: [{ ...feed, urls: ['https://primary.test/a'] }],
    fetcher: async () => new Response(payload, { status: 200 }) });
  process.env.AUTOSCOUT_MAX_FEED_BYTES = String(1024 * 1024);
  const tight = build(); await tight.refresh();
  assert.equal(health(tight).reason, 'PUBLIC_FEED_TOO_LARGE');
  process.env.AUTOSCOUT_MAX_FEED_BYTES = String(8 * 1024 * 1024);
  const roomy = build(); await roomy.refresh();
  assert.notEqual(health(roomy).reason, 'PUBLIC_FEED_TOO_LARGE');
  delete process.env.AUTOSCOUT_MAX_FEED_BYTES;
});

// A healthy feed has no failure to explain.
test('a working feed reports no reason at all', async () => {
  const feeds = createPublicFeeds({ feeds: [{ ...feed, id: 'sleeper', urls: ['https://primary.test/a'] }],
    fetcher: async () => new Response(JSON.stringify({ a: { player_id: 'a', full_name: 'A B', team: 'NE', position: 'QB' } }), { status: 200 }) });
  await feeds.refresh();
  assert.equal(feeds.health().find(f => f.id === 'sleeper').reason, null);
});
