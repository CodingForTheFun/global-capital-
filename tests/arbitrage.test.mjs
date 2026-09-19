import test from 'node:test';
import assert from 'node:assert/strict';
import {
  arbitrageLabel,
  bestArbitrage,
  findArbitrageOpportunities,
  MAX_ARBITRAGE_AGE_MS,
} from '../lib/markets/arbitrage.mjs';

const NOW = Date.parse('2026-09-19T15:00:00.000Z');
const quote = (sportsbookKey, side, line, price, ageMinutes = 1, extra = {}) => ({
  sportsbookKey,
  sportsbook: sportsbookKey.toUpperCase(),
  side,
  line,
  price,
  providerUpdatedAt: new Date(NOW - ageMinutes * 60_000).toISOString(),
  ...extra,
});

test('finds a fresh exact-line cross-book two-way arbitrage', () => {
  const signal = bestArbitrage([
    quote('book-a', 'OVER', 22.5, 150),
    quote('book-b', 'UNDER', 22.5, 150),
  ], { now: NOW, bankroll: 100 });

  assert.ok(signal);
  assert.equal(signal.kind, 'exact-line-cross-book-arbitrage');
  assert.equal(signal.line, 22.5);
  assert.equal(signal.roiPct, 25);
  assert.deepEqual(signal.example, {
    totalStake: 100,
    overStake: 50,
    underStake: 50,
    equalizedPayout: 125,
    theoreticalProfit: 25,
  });
  assert.match(arbitrageLabel(signal), /25\.00% theoretical/);
});

test('requires different books and the exact same line', () => {
  assert.equal(bestArbitrage([
    quote('book-a', 'OVER', 22.5, 150),
    quote('book-a', 'UNDER', 22.5, 150),
  ], { now: NOW }), null);

  assert.equal(bestArbitrage([
    quote('book-a', 'OVER', 21.5, 150),
    quote('book-b', 'UNDER', 22.5, 150),
  ], { now: NOW }), null);
});

test('drops stale, future, alternate, suspended, stale-marked and live quotes by default', () => {
  const staleMinutes = MAX_ARBITRAGE_AGE_MS / 60_000 + 1;
  const invalidOvers = [
    quote('stale', 'OVER', 10.5, 150, staleMinutes),
    quote('future', 'OVER', 10.5, 150, -2),
    quote('alt', 'OVER', 10.5, 150, 1, { isAlternate: true }),
    quote('suspended', 'OVER', 10.5, 150, 1, { suspended: true }),
    quote('marked-stale', 'OVER', 10.5, 150, 1, { stale: true }),
    quote('live', 'OVER', 10.5, 150, 1, { live: true }),
  ];
  assert.deepEqual(findArbitrageOpportunities([
    ...invalidOvers,
    quote('under', 'UNDER', 10.5, 150),
  ], { now: NOW }), []);
});

test('selects the strongest valid pair across multiple books', () => {
  const signals = findArbitrageOpportunities([
    quote('over-a', 'OVER', 8.5, 105),
    quote('over-b', 'OVER', 8.5, 130),
    quote('under-a', 'UNDER', 8.5, 105),
    quote('under-b', 'UNDER', 8.5, 125),
  ], { now: NOW });

  assert.ok(signals.length >= 1);
  assert.equal(signals[0].over.bookKey, 'over-b');
  assert.equal(signals[0].under.bookKey, 'under-b');
  assert.ok(signals[0].roiPct > 0);
});

test('accepts ingestedAt when providerUpdatedAt is absent but still enforces freshness', () => {
  const signal = bestArbitrage([
    {
      sportsbookKey: 'book-a', sportsbook: 'A', side: 'OVER', line: 4.5, price: 120,
      ingestedAt: new Date(NOW - 30_000).toISOString(),
    },
    {
      sportsbookKey: 'book-b', sportsbook: 'B', side: 'UNDER', line: 4.5, price: 120,
      ingestedAt: new Date(NOW - 45_000).toISOString(),
    },
  ], { now: NOW });
  assert.ok(signal);
  assert.equal(signal.line, 4.5);
});


test('uses last-seen or ingestion freshness instead of an old last-change timestamp', () => {
  const oldChange = new Date(NOW - 2 * 60 * 60_000).toISOString();
  const freshSeen = new Date(NOW - 20_000).toISOString();
  const signal = bestArbitrage([
    {
      ...quote('book-a', 'OVER', 6.5, 125),
      providerUpdatedAt: oldChange,
      lastSeenAt: freshSeen,
      ingestedAt: freshSeen,
    },
    {
      ...quote('book-b', 'UNDER', 6.5, 125),
      providerUpdatedAt: oldChange,
      lastSeenAt: freshSeen,
      ingestedAt: freshSeen,
    },
  ], { now: NOW });
  assert.ok(signal);
  assert.equal(signal.line, 6.5);
});
