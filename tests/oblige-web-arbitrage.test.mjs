import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MARKET_ARB_POLICY,
  marketArbitrage,
  marketArbitrageLabel,
} from '../apps/oblige-web/lib/arbitrage.mjs';

const NOW = Date.parse('2026-09-19T15:30:00.000Z');

const quote = (book, side, line, price, ageMs = 20_000, extra = {}) => ({
  sportsbookKey: book,
  sportsbook: book.toUpperCase(),
  side,
  line,
  price,
  period: 'game',
  entityType: 'player',
  payoutType: 'straight',
  updatedAt: new Date(NOW - ageMs).toISOString(),
  ...extra,
});

const group = (line, quotes, extra = {}) => ({
  sport: 'NBA',
  marketId: 'player_points',
  line,
  live: false,
  quotes,
  ...extra,
});

test('half-point exact-line cross-book prices produce a positive minimum return', () => {
  const result = marketArbitrage(group(22.5, [
    quote('book-a', 'OVER', 22.5, 110),
    quote('book-b', 'UNDER', 22.5, 110),
  ]), { now: NOW });

  assert.ok(result);
  assert.equal(result.possiblePush, false);
  assert.ok(Math.abs(result.minimumReturnPct - 5) < 1e-9);
  assert.ok(Math.abs(result.decidedReturnPct - 5) < 1e-9);
  assert.equal(marketArbitrageLabel(result), 'ARB +5.00% min');
});

test('integer exact line treats the shared push as break-even, not guaranteed profit', () => {
  const result = marketArbitrage(group(22, [
    quote('book-a', 'OVER', 22, 110),
    quote('book-b', 'UNDER', 22, 110),
  ]), { now: NOW });

  assert.ok(result);
  assert.equal(result.possiblePush, true);
  assert.equal(result.minimumReturnPct, 0);
  assert.ok(Math.abs(result.decidedReturnPct - 5) < 1e-9);
  assert.match(result.note, /pushes both sides and refunds stakes/i);
  assert.equal(marketArbitrageLabel(result), 'ARB +5.00% decided · push 0%');
});

test('requires different books, the exact same line, and real American prices', () => {
  assert.equal(marketArbitrage(group(10.5, [
    quote('book-a', 'OVER', 10.5, 120),
    quote('book-a', 'UNDER', 10.5, 120),
  ]), { now: NOW }), null);

  assert.equal(marketArbitrage(group(10.5, [
    quote('book-a', 'OVER', 10.5, 120),
    quote('book-b', 'UNDER', 11.5, 120),
  ]), { now: NOW }), null);

  assert.equal(marketArbitrage(group(10.5, [
    quote('book-a', 'OVER', 10.5, 90),
    quote('book-b', 'UNDER', 10.5, 120),
  ]), { now: NOW }), null);
});

test('freshness and inter-book timestamp skew are bounded', () => {
  assert.equal(marketArbitrage(group(5.5, [
    quote('book-a', 'OVER', 5.5, 125, MARKET_ARB_POLICY.maxQuoteAgeMs + 1),
    quote('book-b', 'UNDER', 5.5, 125),
  ]), { now: NOW }), null);

  assert.equal(marketArbitrage(group(5.5, [
    quote('book-a', 'OVER', 5.5, 125, 10_000),
    quote('book-b', 'UNDER', 5.5, 125, MARKET_ARB_POLICY.maxQuoteSkewMs + 20_000),
  ]), { now: NOW }), null);
});

test('DFS books and non-straight or unsafe quote states cannot form sportsbook arbitrage', () => {
  for (const invalid of [
    quote('prizepicks', 'OVER', 7.5, 130),
    quote('underdog', 'OVER', 7.5, 130),
    quote('book-a', 'OVER', 7.5, 130, 20_000, { isAlternate: true }),
    quote('book-a', 'OVER', 7.5, 130, 20_000, { suspended: true }),
    quote('book-a', 'OVER', 7.5, 130, 20_000, { requiresParlay: true }),
    quote('book-a', 'OVER', 7.5, 130, 20_000, { payoutType: 'exchange' }),
    quote('book-a', 'OVER', 7.5, 130, 20_000, { live: true }),
  ]) {
    assert.equal(marketArbitrage(group(7.5, [
      invalid,
      quote('book-b', 'UNDER', 7.5, 130),
    ]), { now: NOW }), null);
  }
});

test('unknown or non-integer outcome domains stay unavailable instead of being guessed', () => {
  assert.equal(marketArbitrage(group(41.5, [
    quote('book-a', 'OVER', 41.5, 130),
    quote('book-b', 'UNDER', 41.5, 130),
  ], { marketId: 'prizepicks:player_fantasy_score' }), { now: NOW }), null);

  assert.equal(marketArbitrage(group(2.5, [
    quote('book-a', 'OVER', 2.5, 130),
    quote('book-b', 'UNDER', 2.5, 130),
  ], { sport: 'TENNIS', marketId: 'player_aces' }), { now: NOW }), null);
});

test('uses last-seen observation time ahead of an old price-change timestamp', () => {
  const freshSeen = new Date(NOW - 15_000).toISOString();
  const oldChanged = new Date(NOW - 2 * 60 * 60_000).toISOString();
  const result = marketArbitrage(group(3.5, [
    quote('book-a', 'OVER', 3.5, 120, 20_000, { lastSeenAt: freshSeen, providerUpdatedAt: oldChanged, updatedAt: oldChanged }),
    quote('book-b', 'UNDER', 3.5, 120, 20_000, { lastSeenAt: freshSeen, providerUpdatedAt: oldChanged, updatedAt: oldChanged }),
  ]), { now: NOW });

  assert.ok(result);
  assert.equal(result.line, 3.5);
});
