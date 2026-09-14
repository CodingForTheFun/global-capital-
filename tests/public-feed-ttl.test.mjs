import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveTtl, PUBLIC_FEEDS } from '../lib/ingestion/public-feeds.mjs';

const feed = id => PUBLIC_FEEDS.find(f => f.id === id);

// Exchange contracts only become props through mappingFor(), which needs a
// reviewed mapping for that exact contract. With none configured it can never
// match, so the hot three-minute refetch of ~13,000 contracts produces nothing.
test('exchange feeds back off when no mapping can ever match them', () => {
  for (const id of ['kalshi', 'polymarket']) {
    assert.ok(effectiveTtl(feed(id), []) > feed(id).ttl,
      `${id} must not refetch on the hot cycle with no mappings configured`);
    assert.equal(effectiveTtl(feed(id), []), 21600000);
  }
});

test('a configured mapping restores the hot refresh for that book only', () => {
  const mappings = [{ book: 'kalshi', sourceId: 'X', verified: true }];
  assert.equal(effectiveTtl(feed('kalshi'), mappings), feed('kalshi').ttl);
  assert.equal(effectiveTtl(feed('polymarket'), mappings), 21600000);
});

test('feeds that need no mapping keep their own interval', () => {
  for (const id of ['prizepicks', 'underdog', 'sleeper']) {
    assert.equal(effectiveTtl(feed(id), []), feed(id).ttl);
    assert.equal(effectiveTtl(feed(id), [{ book: 'kalshi' }]), feed(id).ttl);
  }
});

test('malformed mappings are treated as no mapping rather than throwing', () => {
  for (const bad of [null, undefined, 'nope', [null], [{}], [{ book: 'other' }]]) {
    assert.equal(effectiveTtl(feed('kalshi'), bad), 21600000);
  }
});
