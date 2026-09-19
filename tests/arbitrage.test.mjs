import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { proToolsAnalysis } from '../lib/analytics/pro-tools.mjs';

const now = Date.parse('2026-09-19T15:00:00.000Z');
const group = {
  sport: 'NBA',
  eventId: 'event',
  playerId: 'player',
  playerName: 'Fixture Player',
  marketId: 'player_points',
  market: 'Points',
  gameStartTime: new Date(now + 60 * 60_000).toISOString(),
  period: 'game',
  entityType: 'player',
  live: false,
  archived: false,
};
const quote = (book, side, line, price = 110, ageMs = 10_000) => ({
  ...group,
  sportsbookKey: book,
  sportsbook: book,
  side,
  line,
  price,
  providerUpdatedAt: new Date(now - ageMs).toISOString(),
});

test('main prop card reuses the settlement-aware Pro Tools arb engine', () => {
  const source = readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');
  assert.match(source, /function arbitrageFor\(g\)[\s\S]*proToolsAnalysis/);
  assert.match(source, /Worst case/);
  assert.match(source, /push can break even/);
  assert.match(source, /section\('Arbitrage check',arbitragePanel\(g\)/);
  assert.doesNotMatch(source, /assets\/lib\/markets\/arbitrage\.mjs/);
});

test('integer shared lines expose push-aware break-even instead of guaranteed profit', () => {
  const result = proToolsAnalysis({
    ...group,
    rows: [quote('book-a', 'OVER', 20), quote('book-b', 'UNDER', 20)],
  }, { now });
  const signal = result.arbitrage[0];
  assert.ok(signal);
  assert.equal(signal.possiblePush, true);
  assert.equal(signal.minimumReturnPercent, 0);
  assert.ok(signal.decidedReturnPercent > 0);
  assert.ok(signal.scenarios.some(row =>
    row.overResult === 'push' &&
    row.underResult === 'push' &&
    row.returnPercent === 0
  ));
});

test('half-point arb candidate has no push case and retains a positive worst case', () => {
  const result = proToolsAnalysis({
    ...group,
    rows: [quote('book-a', 'OVER', 20.5), quote('book-b', 'UNDER', 20.5)],
  }, { now });
  const signal = result.arbitrage[0];
  assert.ok(signal);
  assert.equal(signal.possiblePush, false);
  assert.ok(signal.minimumReturnPercent > 0);
});

test('stale and noncontemporaneous offers do not reach the customer arb surface engine', () => {
  const stale = proToolsAnalysis({
    ...group,
    rows: [quote('book-a', 'OVER', 20.5), quote('book-b', 'UNDER', 20.5, 110, 6 * 60_000)],
  }, { now });
  assert.equal(stale.arbitrage.length, 0);

  const skewed = proToolsAnalysis({
    ...group,
    rows: [quote('book-a', 'OVER', 20.5, 110, 1_000), quote('book-b', 'UNDER', 20.5, 110, 70_000)],
  }, { now });
  assert.equal(skewed.arbitrage.length, 0);
});
