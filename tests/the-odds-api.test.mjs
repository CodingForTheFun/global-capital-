import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTheOddsApiFixture } from '../apex-v2/the-odds-api.mjs';

function fixture() {
  return {
    id: 'event-1',
    commence_time: '2099-01-01T00:00:00Z',
    home_team: 'Home',
    away_team: 'Away',
    bookmakers: [
      {
        key: 'prizepicks',
        title: 'PrizePicks',
        last_update: '2026-09-09T20:00:00Z',
        markets: [
          {
            key: 'player_points',
            outcomes: [
              { name: 'Over', description: 'Player One', price: -110, point: 24.5 },
              { name: 'Under', description: 'Player One', price: -110, point: 24.5 },
            ],
          },
          {
            key: 'player_points_alternate',
            outcomes: [
              { name: 'Over', description: 'Player One', price: 100, point: 29.5 },
            ],
          },
        ],
      },
      {
        key: 'fanduel',
        title: 'FanDuel',
        markets: [
          {
            key: 'player_points',
            outcomes: [
              { name: 'Over', description: 'Player One', price: -105, point: 25.5 },
              { name: 'Under', description: 'Player One', price: -115, point: 25.5 },
            ],
          },
        ],
      },
      {
        key: 'draftkings',
        title: 'DraftKings',
        markets: [
          {
            key: 'player_points',
            outcomes: [
              { name: 'Over', description: 'Player One', price: 100, point: 26.5 },
              { name: 'Under', description: 'Player One', price: -120, point: 26.5 },
            ],
          },
        ],
      },
    ],
  };
}

test('normalizes standard player over/under props and drops alternate lines', () => {
  const rows = normalizeTheOddsApiFixture(fixture(), 'NBA');
  assert.equal(rows.length, 6);
  assert.ok(rows.every(row => row.marketId === 'player_points'));
  assert.ok(rows.every(row => !row.marketId.includes('alternate')));
  assert.deepEqual(new Set(rows.map(row => row.sportsbookKey)), new Set(['prizepicks', 'fanduel', 'draftkings']));
});

test('adds cross-book median lines without another provider request', () => {
  const rows = normalizeTheOddsApiFixture(fixture(), 'NBA');
  const overs = rows.filter(row => row.side === 'OVER');
  const unders = rows.filter(row => row.side === 'UNDER');
  assert.ok(overs.every(row => row.fairLine === 25.5));
  assert.ok(unders.every(row => row.fairLine === 25.5));
});

test('preserves American prices and computes implied probabilities', () => {
  const rows = normalizeTheOddsApiFixture(fixture(), 'NBA');
  const plus100 = rows.find(row => row.side === 'OVER' && row.sportsbookKey === 'draftkings');
  const minus110 = rows.find(row => row.side === 'OVER' && row.sportsbookKey === 'prizepicks');
  assert.equal(plus100.price, 100);
  assert.equal(plus100.impliedProbability, 0.5);
  assert.ok(Math.abs(minus110.impliedProbability - 110 / 210) < 1e-12);
});
