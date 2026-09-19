import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyCustomerPropFreshness,
  customerPropMaxAgeMs,
  filterCustomerBoardFreshness,
  isCustomerObservationFresh,
} from '../lib/ingestion/customer-prop-freshness.mjs';

const NOW = Date.parse('2026-09-19T11:00:00.000Z');
const futureGame = '2026-09-19T19:00:00.000Z';

function row(overrides = {}) {
  return {
    id: 'line-1',
    provider: 'propline',
    sport: 'NFL',
    eventId: 'event-1',
    playerId: 'player-1',
    playerName: 'Fixture Player',
    marketId: 'player_passing_yards',
    market: 'Passing Yards',
    period: 'game',
    side: 'OVER',
    line: 251.5,
    sportsbook: 'DraftKings',
    sportsbookKey: 'draftkings',
    gameStartTime: futureGame,
    ingestedAt: new Date(NOW - 5 * 60_000).toISOString(),
    isAlternate: false,
    ...overrides,
  };
}

test('customer prop freshness accepts only observations inside the hard ten-minute ceiling', () => {
  assert.equal(classifyCustomerPropFreshness(row(), { now: NOW }).fresh, true);
  assert.equal(classifyCustomerPropFreshness(row({ ingestedAt: new Date(NOW - 10 * 60_000).toISOString() }), { now: NOW }).fresh, true);
  const stale = classifyCustomerPropFreshness(row({ ingestedAt: new Date(NOW - 10 * 60_000 - 1).toISOString() }), { now: NOW });
  assert.equal(stale.fresh, false);
  assert.equal(stale.reason, 'stale');
});

test('explicit last-good fallback rows are never presented as current even when recently stored', () => {
  const result = classifyCustomerPropFreshness(row({ cacheFallback: true }), { now: NOW });
  assert.equal(result.fresh, false);
  assert.equal(result.reason, 'last_good_fallback');
});

test('unverifiable, completed, expired, and already-started pregame props fail closed', () => {
  assert.equal(classifyCustomerPropFreshness(row({ ingestedAt: null, providerUpdatedAt: null, updatedAt: null }), { now: NOW }).reason, 'unverified_timestamp');
  assert.equal(classifyCustomerPropFreshness(row({ completed: true }), { now: NOW }).reason, 'completed');
  assert.equal(classifyCustomerPropFreshness(row({ expiresAt: new Date(NOW - 1).toISOString() }), { now: NOW }).reason, 'expired');
  assert.equal(classifyCustomerPropFreshness(row({ gameStartTime: new Date(NOW - 1).toISOString(), live: false }), { now: NOW }).reason, 'game_started');
  assert.equal(classifyCustomerPropFreshness(row({ gameStartTime: new Date(NOW - 1).toISOString(), live: true }), { now: NOW }).fresh, true);
});

test('realtime update timestamp can refresh an otherwise old normalized observation', () => {
  const result = classifyCustomerPropFreshness(row({
    realtime: true,
    ingestedAt: new Date(NOW - 60 * 60_000).toISOString(),
    updatedAt: new Date(NOW - 15_000).toISOString(),
  }), { now: NOW });
  assert.equal(result.fresh, true);
});

test('customer board filtering removes stale rows and their normalized line/entity data together', () => {
  const fresh = row();
  const stale = row({
    id: 'line-2',
    playerId: 'player-2',
    playerName: 'Old Player',
    ingestedAt: new Date(NOW - 11 * 60_000).toISOString(),
  });
  const board = {
    props: [fresh, stale],
    data: {
      events: [{ id: 'event-1' }],
      players: [{ id: 'player-1' }, { id: 'player-2' }],
      props: [
        { id: 'prop-1', eventId: 'event-1', playerId: 'player-1', marketKey: fresh.marketId, period: 'game' },
        { id: 'prop-2', eventId: 'event-1', playerId: 'player-2', marketKey: stale.marketId, period: 'game' },
      ],
      lines: [
        { id: 'line-1', propId: 'prop-1' },
        { id: 'line-2', propId: 'prop-2' },
      ],
    },
    meta: { stale: true, lineCount: 2, propCount: 2 },
  };
  const filtered = filterCustomerBoardFreshness(board, { now: NOW });
  assert.deepEqual(filtered.props.map((x) => x.id), ['line-1']);
  assert.deepEqual(filtered.data.lines.map((x) => x.id), ['line-1']);
  assert.deepEqual(filtered.data.props.map((x) => x.id), ['prop-1']);
  assert.deepEqual(filtered.data.players.map((x) => x.id), ['player-1']);
  assert.equal(filtered.meta.stale, false);
  assert.equal(filtered.meta.lineCount, 1);
  assert.equal(filtered.meta.customerFreshness.dropped.stale, 1);
});

test('configuration may tighten but can never loosen the ten-minute customer ceiling', () => {
  const previous = process.env.AUTOSCOUT_CUSTOMER_PROP_MAX_AGE_SECONDS;
  try {
    process.env.AUTOSCOUT_CUSTOMER_PROP_MAX_AGE_SECONDS = '1200';
    assert.equal(customerPropMaxAgeMs(), 600_000);
    process.env.AUTOSCOUT_CUSTOMER_PROP_MAX_AGE_SECONDS = '300';
    assert.equal(customerPropMaxAgeMs(), 300_000);
  } finally {
    if (previous === undefined) delete process.env.AUTOSCOUT_CUSTOMER_PROP_MAX_AGE_SECONDS;
    else process.env.AUTOSCOUT_CUSTOMER_PROP_MAX_AGE_SECONDS = previous;
  }
});

test('source snapshots use the same customer freshness ceiling', () => {
  assert.equal(isCustomerObservationFresh(new Date(NOW - 9 * 60_000).toISOString(), { now: NOW }), true);
  assert.equal(isCustomerObservationFresh(new Date(NOW - 11 * 60_000).toISOString(), { now: NOW }), false);
});
