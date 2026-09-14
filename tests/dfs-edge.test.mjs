import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dfsFairValue, describeDfsEdge, hasMeaningfulEdge, isDfsBook,
  MAX_PRICE_AGE_MS, MEANINGFUL_EDGE,
} from '../lib/props/dfs-edge.mjs';

const NOW = Date.parse('2026-09-14T02:00:00.000Z');
const fresh = new Date(NOW - 60_000).toISOString();

const offer = (sportsbookKey, side, line, price, updatedAt = fresh) =>
  ({ sportsbookKey, side, line, price, updatedAt });
const dfs = (key, line) => ({ sportsbookKey: key, side: 'OVER', line, price: null, updatedAt: fresh });

test('DFS boards are told apart from sportsbooks', () => {
  assert.equal(isDfsBook('prizepicks'), true);
  assert.equal(isDfsBook('underdog'), true);
  assert.equal(isDfsBook('pinnacle'), false);
  assert.equal(isDfsBook('fanduel'), false);
});

test('a sharp two-sided price becomes the fair probability for the DFS line', () => {
  // -130/+110 on the same number: 56.52% / 47.62% raw, 54.28% after the vig.
  const value = dfsFairValue([
    dfs('prizepicks', 1.5),
    offer('pinnacle', 'OVER', 1.5, -130),
    offer('pinnacle', 'UNDER', 1.5, 110),
  ], { now: NOW });
  assert.equal(value.reason, undefined);
  assert.equal(value.basis, 'sharp');
  assert.equal(value.line, 1.5);
  assert.equal(value.side, 'OVER');
  assert.ok(Math.abs(value.overProbability - 0.5428) < 0.001, `got ${value.overProbability}`);
  assert.ok(Math.abs(value.edge - 0.0428) < 0.001, `got ${value.edge}`);
  assert.deepEqual(value.dfsBooks, ['prizepicks']);
});

test('the favoured side is reported even when it is the under', () => {
  const value = dfsFairValue([
    dfs('prizepicks', 24.5),
    offer('pinnacle', 'OVER', 24.5, 120),
    offer('pinnacle', 'UNDER', 24.5, -140),
  ], { now: NOW });
  assert.equal(value.side, 'UNDER');
  assert.ok(value.sideProbability > 0.5);
  assert.ok(Math.abs(value.sideProbability - (1 - value.overProbability)) < 1e-12);
});

// The whole point of the module: a price on a different number is a different
// bet, and borrowing it would be inventing a probability.
test('a book priced at another number is never borrowed for this line', () => {
  const value = dfsFairValue([
    dfs('prizepicks', 0.5),
    offer('pinnacle', 'OVER', 1.5, -130),
    offer('pinnacle', 'UNDER', 1.5, 110),
  ], { now: NOW });
  assert.equal(value.reason, 'NO_MATCHING_BOOK_LINE');
});

test('a one-sided price is refused because there is no vig to remove', () => {
  const value = dfsFairValue([
    dfs('prizepicks', 1.5),
    offer('pinnacle', 'OVER', 1.5, -130),
  ], { now: NOW });
  assert.equal(value.reason, 'NO_TWO_SIDED_PRICE');
});

test('prices older than the freshness window are not treated as the market', () => {
  const stale = new Date(NOW - MAX_PRICE_AGE_MS - 60_000).toISOString();
  const value = dfsFairValue([
    dfs('prizepicks', 1.5),
    offer('pinnacle', 'OVER', 1.5, -130, stale),
    offer('pinnacle', 'UNDER', 1.5, 110, stale),
  ], { now: NOW });
  assert.equal(value.reason, 'NO_BOOK_PRICES');
});

test('a lone retail book is not a consensus', () => {
  const value = dfsFairValue([
    dfs('prizepicks', 1.5),
    offer('fanduel', 'OVER', 1.5, -130),
    offer('fanduel', 'UNDER', 1.5, 110),
  ], { now: NOW });
  assert.equal(value.reason, 'NEEDS_MORE_BOOKS');
});

test('corroborated retail books stand in for a sharp one and say so', () => {
  const value = dfsFairValue([
    dfs('prizepicks', 1.5),
    offer('fanduel', 'OVER', 1.5, -130), offer('fanduel', 'UNDER', 1.5, 110),
    offer('bvda', 'OVER', 1.5, -125), offer('bvda', 'UNDER', 1.5, 105),
  ], { now: NOW });
  assert.equal(value.basis, 'consensus');
  assert.equal(value.books.length, 2);
});

test('a sharp book outranks retail books quoting the same line', () => {
  const value = dfsFairValue([
    dfs('prizepicks', 1.5),
    offer('fanduel', 'OVER', 1.5, 200), offer('fanduel', 'UNDER', 1.5, -260),
    offer('bvda', 'OVER', 1.5, 200), offer('bvda', 'UNDER', 1.5, -260),
    offer('pinnacle', 'OVER', 1.5, -130), offer('pinnacle', 'UNDER', 1.5, 110),
  ], { now: NOW });
  assert.equal(value.basis, 'sharp');
  assert.deepEqual(value.books, ['pinnacle']);
  assert.ok(value.overProbability > 0.5, 'the sharp price, not the retail one, must drive the answer');
});

test('with no DFS line there is nothing to price', () => {
  const value = dfsFairValue([
    offer('pinnacle', 'OVER', 1.5, -130),
    offer('pinnacle', 'UNDER', 1.5, 110),
  ], { now: NOW });
  assert.equal(value.reason, 'NO_DFS_LINE');
});

test('when DFS boards disagree the more widely posted number wins', () => {
  const value = dfsFairValue([
    dfs('prizepicks', 1.5), dfs('underdog', 1.5), dfs('dk_pick6', 2.5),
    offer('pinnacle', 'OVER', 1.5, -130), offer('pinnacle', 'UNDER', 1.5, 110),
  ], { now: NOW });
  assert.equal(value.line, 1.5);
  assert.deepEqual(value.dfsBooks, ['prizepicks', 'underdog']);
});

test('an empty or malformed board is refused rather than guessed at', () => {
  assert.equal(dfsFairValue([]).reason, 'NO_DFS_LINE');
  assert.equal(dfsFairValue(null).reason, 'NO_DFS_LINE');
  assert.equal(dfsFairValue([dfs('prizepicks', 1.5)], { now: NOW }).reason, 'NO_BOOK_PRICES');
});

test('a coin-flip price is reported as no edge rather than a small one', () => {
  const value = dfsFairValue([
    dfs('prizepicks', 1.5),
    offer('pinnacle', 'OVER', 1.5, -110), offer('pinnacle', 'UNDER', 1.5, -110),
  ], { now: NOW });
  assert.ok(Math.abs(value.edge) < MEANINGFUL_EDGE);
  assert.equal(hasMeaningfulEdge(value), false);
  assert.match(describeDfsEdge(value), /^Pinnacle prices over 1\.5 at 50\.0% — no real edge either way$/);
});

test('copy is produced only when there is something honest to say', () => {
  assert.equal(describeDfsEdge({ reason: 'NO_DFS_LINE' }), null);
  assert.equal(describeDfsEdge(null), null);
  const value = dfsFairValue([
    dfs('prizepicks', 1.5),
    offer('pinnacle', 'OVER', 1.5, -200), offer('pinnacle', 'UNDER', 1.5, 170),
  ], { now: NOW });
  assert.equal(hasMeaningfulEdge(value), true);
  assert.match(describeDfsEdge(value), /^Pinnacle makes over 1\.5 a 6[0-9]\.[0-9]% shot — 1[0-9]\.[0-9]% better than the coin flip this pays like$/);
});

test('copy agrees in number whether one book or several priced the line', () => {
  const fresh = new Date(NOW - 60_000).toISOString();
  const many = dfsFairValue([
    dfs('prizepicks', 1.5),
    { sportsbookKey: 'fanduel', side: 'OVER', line: 1.5, price: -200, updatedAt: fresh },
    { sportsbookKey: 'fanduel', side: 'UNDER', line: 1.5, price: 170, updatedAt: fresh },
    { sportsbookKey: 'bvda', side: 'OVER', line: 1.5, price: -200, updatedAt: fresh },
    { sportsbookKey: 'bvda', side: 'UNDER', line: 1.5, price: 170, updatedAt: fresh },
  ], { now: NOW });
  assert.match(describeDfsEdge(many), /^2 books make over 1\.5 a /);
});
