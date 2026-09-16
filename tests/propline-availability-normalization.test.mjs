import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEventOdds, mergeNormalized } from '../lib/data-sources/propline/normalize.mjs';

const base = (market) => ({
  id: 'event-1', sport_key: 'basketball_nba', home_team: 'Home', away_team: 'Away',
  bookmakers: [{ key: 'fanduel', title: 'FanDuel', pregame_only: true, markets: [market] }],
});

const outcome = (overrides = {}) => ({
  name: 'Over', description: 'Test Player', player_id: 'nba:1', point: 20.5, price: -110,
  outcome_id: 'outcome-1', last_change_at: '2026-09-16T02:00:00Z',
  ...overrides,
});

test('suspended PropLine markets never become customer board quotes', () => {
  const out = normalizeEventOdds(base({
    key: 'player_points', last_update: '2026-09-16T02:01:00Z', suspended_at: '2026-09-16T02:01:01Z',
    outcomes: [outcome()],
  }), { sport: 'NBA' });
  assert.equal(out.lines.length, 0);
  assert.equal(out.skipped.suspended, 1);
});

test('an outcome missing the market latest delivery is treated as withdrawn', () => {
  const out = normalizeEventOdds(base({
    key: 'player_points', last_update: '2026-09-16T02:01:00Z', suspended_at: null,
    outcomes: [outcome({ last_seen_at: '2026-09-16T02:00:59Z' })],
  }), { sport: 'NBA' });
  assert.equal(out.lines.length, 0);
  assert.equal(out.skipped.withdrawn, 1);
});

test('current outcomes remain available and preserve pregame-only metadata', () => {
  const out = normalizeEventOdds(base({
    key: 'player_points', last_update: '2026-09-16T02:01:00Z', suspended_at: null,
    outcomes: [outcome({ last_seen_at: '2026-09-16T02:01:00Z' })],
  }), { sport: 'NBA' });
  assert.equal(out.lines.length, 1);
  assert.equal(out.lines[0].pregameOnly, true);
  assert.equal(out.lines[0].lastSeenAt, '2026-09-16T02:01:00Z');
});

test('availability skip counters survive merged-board diagnostics', () => {
  const suspended = normalizeEventOdds(base({
    key: 'player_points', suspended_at: '2026-09-16T02:01:00Z', outcomes: [outcome()],
  }), { sport: 'NBA' });
  const withdrawn = normalizeEventOdds(base({
    key: 'player_rebounds', last_update: '2026-09-16T02:02:00Z', outcomes: [outcome({ outcome_id: 'outcome-2', last_seen_at: '2026-09-16T02:01:00Z' })],
  }), { sport: 'NBA' });
  const merged = mergeNormalized([suspended, withdrawn]);
  assert.equal(merged.skipped.suspended, 1);
  assert.equal(merged.skipped.withdrawn, 1);
});
