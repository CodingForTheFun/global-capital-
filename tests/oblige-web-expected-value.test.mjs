import test from 'node:test';
import assert from 'node:assert/strict';

import {
  expectedValueFor,
  expectedValueSourceLabel,
} from '../apps/oblige-web/lib/expected-value.mjs';

const NOW = Date.parse('2026-09-21T20:00:00.000Z');

const quote = (book, side, line, price, extra = {}) => ({
  sportsbookKey: book,
  sportsbook: book,
  side,
  line,
  price,
  period: 'game',
  entityType: 'player',
  payoutType: 'straight',
  lastSeenAt: new Date(NOW - 15_000).toISOString(),
  ...extra,
});

const group = (line, quotes, extra = {}) => ({
  line,
  sport: 'NCAAF',
  marketId: 'player_pass_yds',
  live: false,
  quotes,
  ...extra,
});

test('validated model EV includes push refunds instead of treating pushes as losses', () => {
  const result = expectedValueFor(group(10, [
    quote('book-a', 'OVER', 10, 100),
    quote('book-b', 'UNDER', 10, 100),
  ]), {
    available: true,
    probabilityOver: 0.45,
    probabilityUnder: 0.45,
    probabilityPush: 0.10,
  }, { now: NOW });

  assert.ok(result);
  assert.equal(result.source, 'model');
  assert.equal(result.side, 'OVER');
  assert.ok(Math.abs(result.ev) < 1e-9);
});

test('exact-line fair odds produce market EV when the player model is unavailable', () => {
  const result = expectedValueFor(group(42.5, [
    quote('underdog', 'OVER', 42.5, 100, {
      payoutType: 'pickem',
      requiresParlay: true,
      fairOdds: '+105',
      fairLine: 42.5,
    }),
    quote('hardrock', 'UNDER', 42.5, -120, {
      fairOdds: '-105',
      fairLine: 42.5,
      fairOddsAvailable: true,
    }),
  ]), {
    available: false,
    code: 'MODEL_NOT_READY',
  }, { now: NOW });

  assert.ok(result);
  assert.equal(result.source, 'fair-odds');
  assert.equal(result.side, 'UNDER');
  assert.equal(result.sportsbookKey, 'hardrock');
  assert.ok(Number.isFinite(result.ev));
  assert.equal(expectedValueSourceLabel(result), 'Exact-line no-vig fair odds');
});

test('cross-book no-vig consensus can price a best quote without using that same book as its own benchmark', () => {
  const result = expectedValueFor(group(37.5, [
    quote('book-a', 'OVER', 37.5, 120),
    quote('book-b', 'OVER', 37.5, -110),
    quote('book-b', 'UNDER', 37.5, -110),
  ]), { available: false }, { now: NOW });

  assert.ok(result);
  assert.equal(result.source, 'market-consensus');
  assert.equal(result.side, 'OVER');
  assert.equal(result.sportsbookKey, 'book-a');
  assert.ok(Math.abs(result.probability - 0.5) < 1e-9);
  assert.ok(Math.abs(result.ev - 10) < 1e-9);
});

test('model probability takes precedence over market-derived fair odds', () => {
  const result = expectedValueFor(group(24.5, [
    quote('book-a', 'OVER', 24.5, 100, { fairOdds: '+100', fairLine: 24.5 }),
    quote('book-b', 'UNDER', 24.5, 100, { fairOdds: '+100', fairLine: 24.5 }),
  ]), {
    available: true,
    probabilityOver: 0.6,
    probabilityUnder: 0.4,
    probabilityPush: 0,
  }, { now: NOW });

  assert.ok(result);
  assert.equal(result.source, 'model');
  assert.equal(result.side, 'OVER');
  assert.ok(Math.abs(result.ev - 20) < 1e-9);
});

test('DFS and parlay-only prices are never labelled as straight single-leg EV', () => {
  const result = expectedValueFor(group(1.5, [
    quote('underdog', 'OVER', 1.5, 100, { payoutType: 'pickem', requiresParlay: true }),
    quote('prizepicks', 'UNDER', 1.5, 100, { payoutType: 'pickem', requiresParlay: true }),
  ]), {
    available: true,
    probabilityOver: 0.7,
    probabilityUnder: 0.3,
    probabilityPush: 0,
  }, { now: NOW });

  assert.equal(result, null);
});

test('fair odds are ignored when their fair line does not match the displayed prop line', () => {
  const result = expectedValueFor(group(42.5, [
    quote('book-a', 'OVER', 42.5, 110, { fairOdds: '+105', fairLine: 41.5 }),
  ]), { available: false }, { now: NOW });

  assert.equal(result, null);
});

test('stale or suspended sportsbook quotes cannot create EV', () => {
  for (const extra of [{ stale: true }, { suspended: true }]) {
    const result = expectedValueFor(group(9.5, [
      quote('book-a', 'OVER', 9.5, 120, extra),
      quote('book-b', 'OVER', 9.5, -110),
      quote('book-b', 'UNDER', 9.5, -110),
    ]), { available: false }, { now: NOW });

    assert.notEqual(result?.sportsbookKey, 'book-a');
  }
});
