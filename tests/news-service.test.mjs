import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyNewsTitle, parseFeedItems } from '../lib/news/service.mjs';

const espn = {
  id: 'espn-nfl',
  publisher: 'ESPN',
  attribution: 'Provided by ESPN',
  sport: 'NFL',
  hosts: ['espn.com'],
};

test('news classifier labels line-moving updates without changing headlines', () => {
  assert.equal(classifyNewsTitle('Quarterback ruled out with hamstring injury'), 'INJURY');
  assert.equal(classifyNewsTitle('Team trades veteran receiver to contender'), 'TRADE');
  assert.equal(classifyNewsTitle('Club signs All-Star to contract extension'), 'SIGNING');
  assert.equal(classifyNewsTitle('Player waived before Week 2'), 'TRANSACTION');
  assert.equal(classifyNewsTitle('Sources: coach expected to return Sunday'), 'REPORT');
  assert.equal(classifyNewsTitle('Trade rumor: team linked to star guard'), 'RUMOR');
  assert.equal(classifyNewsTitle('Power rankings after Week 1'), 'NEWS');
});

test('RSS parser keeps publisher headline, attribution, sport, date, and safe source link', () => {
  const xml = `<?xml version="1.0"?><rss><channel><item>
    <title><![CDATA[Star receiver traded to Chicago &amp; agrees to extension]]></title>
    <link>https://www.espn.com/nfl/story/_/id/123/example?x=1&amp;y=2</link>
    <pubDate>Tue, 15 Sep 2026 13:30:00 GMT</pubDate>
  </item></channel></rss>`;
  const items = parseFeedItems(xml, espn);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Star receiver traded to Chicago & agrees to extension');
  assert.equal(items[0].publisher, 'ESPN');
  assert.equal(items[0].attribution, 'Provided by ESPN');
  assert.equal(items[0].sport, 'NFL');
  assert.equal(items[0].category, 'TRADE');
  assert.equal(items[0].publishedAt, '2026-09-15T13:30:00.000Z');
  assert.match(items[0].url, /^https:\/\/www\.espn\.com\//);
});

test('RSS parser drops links outside the publisher allowlist', () => {
  const xml = `<rss><channel><item><title>Fake redirect</title><link>https://evil.example/phish</link></item></channel></rss>`;
  assert.deepEqual(parseFeedItems(xml, espn), []);
});

test('Atom parser accepts safe alternate links', () => {
  const xml = `<feed><entry><title>League news update</title><link rel="alternate" href="https://www.espn.com/nfl/story/example"/><updated>2026-09-15T12:00:00Z</updated></entry></feed>`;
  const items = parseFeedItems(xml, espn);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'League news update');
});
