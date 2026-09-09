import test from 'node:test';
import assert from 'node:assert/strict';
import { rollingAnalytics, mergeHitRates, WINDOWS } from '../lib/analytics/rolling.mjs';

const log = (values) => values.map((value, i) => ({ value, date: `2026-09-${String(20 - i).padStart(2, '0')}`, isHome: i % 2 === 0 }));

test('hit rate is measured against the LINE, per game, not against the average', () => {
  // Average is 26.1, but only 6 of 10 games actually cleared 25.5.
  const games = log([28, 31, 22, 25, 27, 19, 30, 26, 24, 29]);
  const over = rollingAnalytics(games, 25.5, 'OVER');
  assert.equal(over.windows.l10.hitRate, 60);
  assert.equal(over.windows.l10.hits, 6);
  assert.equal(over.windows.l10.misses, 4);
  assert.equal(over.windows.l10.average, 26.1, 'the average is reported but is NOT the hit rate');
});

test('OVER and UNDER are answered separately and are complementary', () => {
  const games = log([28, 31, 22, 25, 27, 19, 30, 26, 24, 29]);
  const over = rollingAnalytics(games, 25.5, 'OVER').windows.l10.hitRate;
  const under = rollingAnalytics(games, 25.5, 'UNDER').windows.l10.hitRate;
  assert.equal(over, 60);
  assert.equal(under, 40);
  assert.equal(over + under, 100, 'with no pushes these must sum to 100');
});

test('a push is excluded from the denominator, as a book would settle it', () => {
  const result = rollingAnalytics(log([25, 30, 20]), 25, 'OVER').windows.l5;
  assert.equal(result.pushes, 1);
  assert.equal(result.hits, 1);
  assert.equal(result.misses, 1);
  assert.equal(result.hitRate, 50, '1 hit of 2 decided games, the push ignored');
});

test('every window is computed independently from the same log', () => {
  const games = log([40, 40, 40, 40, 40, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);
  const r = rollingAnalytics(games, 25.5, 'OVER');
  assert.equal(r.windows.l5.hitRate, 100, 'hot recent form');
  assert.equal(r.windows.l10.hitRate, 50);
  assert.equal(r.windows.season.games, 15);
  for (const w of WINDOWS) assert.ok(r.windows[w.id], `missing window ${w.id}`);
});

test('sample size, median and volatility come from the real log', () => {
  const r = rollingAnalytics(log([10, 20, 30, 40, 50]), 25, 'OVER').windows.l5;
  assert.equal(r.sampleSize, 5);
  assert.equal(r.median, 30);
  assert.ok(r.volatility > 0, 'a spread-out log has non-zero volatility');
  assert.equal(rollingAnalytics(log([20, 20, 20]), 25, 'OVER').windows.l5.volatility, 0, 'a flat log has none');
});

test('an empty or unusable log yields null, never zero', () => {
  const empty = rollingAnalytics([], 25.5, 'OVER');
  assert.equal(empty.windows.l10.hitRate, null);
  assert.equal(empty.windows.l10.average, null);
  assert.equal(empty.windows.l10.sampleSize, 0);

  const junk = rollingAnalytics([{ value: null }, { value: undefined }, {}], 25.5, 'OVER');
  assert.equal(junk.windows.l5.hitRate, null, 'missing values are dropped, not counted as 0');
});

test('with no line there are averages but no hit rate', () => {
  const r = rollingAnalytics(log([28, 22]), null, 'OVER').windows.l5;
  assert.equal(r.average, 25);
  assert.equal(r.hitRate, null, 'a hit rate is meaningless without a line');
  assert.equal(r.hits, null);
});

test('trend compares recent form against the longer baseline', () => {
  assert.equal(rollingAnalytics(log([40, 40, 40, 40, 40, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]), 25, 'OVER').trend.direction, 'UP');
  assert.equal(rollingAnalytics(log([10, 10, 10, 10, 10, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40]), 25, 'OVER').trend.direction, 'DOWN');
  assert.equal(rollingAnalytics(log(Array(15).fill(25)), 20, 'OVER').trend.direction, 'FLAT');
});

test('home and away splits are computed only where venue is marked', () => {
  const r = rollingAnalytics(log([30, 20, 30, 20]), 25, 'OVER');
  assert.ok(r.splits.home);
  assert.ok(r.splits.away);
  assert.equal(r.splits.home.hitRate, 100, 'home games were 30, 30');
  assert.equal(r.splits.away.hitRate, 0, 'away games were 20, 20');

  const unmarked = rollingAnalytics([{ value: 30 }, { value: 20 }], 25, 'OVER');
  assert.equal(unmarked.splits, null, 'no venue data means no split, not a guessed one');
});

test('the game log marks each game as a hit or miss for the detail chart', () => {
  const r = rollingAnalytics(log([30, 20, 25]), 25, 'OVER');
  assert.equal(r.gameLog[0].hit, true);
  assert.equal(r.gameLog[1].hit, false);
  assert.equal(r.gameLog[2].hit, null, 'a push is neither');
});

test('computed rates fill gaps but never overwrite verified PickFinder rates', () => {
  const analytics = rollingAnalytics(log([30, 30, 30, 30, 30]), 25, 'OVER');
  const merged = mergeHitRates({ l5: 42, l10: null }, analytics);
  assert.equal(merged.l5, 42, 'PickFinder\'s own verified rate wins');
  assert.equal(merged.l10, 100, 'the gap is filled from the computed window');
});
