import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTheOddsApiFixture } from '../apex-v2/the-odds-api-v2.mjs';

function nbaFixture() {
  return {
    id: 'event-1',
    commence_time: '2099-01-01T00:00:00Z',
    home_team: 'Home',
    away_team: 'Away',
    bookmakers: [
      {
        key: 'prizepicks',
        title: 'PrizePicks',
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
            outcomes: [{ name: 'Over', description: 'Player One', price: 100, point: 29.5 }],
          },
        ],
      },
      {
        key: 'fanduel',
        title: 'FanDuel',
        markets: [{
          key: 'player_points',
          outcomes: [
            { name: 'Over', description: 'Player One', price: -105, point: 25.5 },
            { name: 'Under', description: 'Player One', price: -115, point: 25.5 },
          ],
        }],
      },
      {
        key: 'draftkings',
        title: 'DraftKings',
        markets: [{
          key: 'player_points',
          outcomes: [
            { name: 'Over', description: 'Player One', price: 100, point: 26.5 },
            { name: 'Under', description: 'Player One', price: -120, point: 26.5 },
          ],
        }],
      },
    ],
  };
}

test('normalizes regular NBA over/under props and excludes alternates', () => {
  const rows = normalizeTheOddsApiFixture(nbaFixture(), 'NBA');
  assert.equal(rows.length, 6);
  assert.ok(rows.every(row => row.marketId === 'player_points'));
  assert.ok(rows.every(row => !row.marketId.includes('alternate')));
  assert.deepEqual(new Set(rows.map(row => row.sportsbookKey)), new Set(['prizepicks', 'fanduel', 'draftkings']));
});

test('adds a zero-cost cross-book median line', () => {
  const rows = normalizeTheOddsApiFixture(nbaFixture(), 'NBA');
  assert.ok(rows.every(row => row.fairLine === 25.5));
});

test('preserves American prices and computes implied probabilities', () => {
  const rows = normalizeTheOddsApiFixture(nbaFixture(), 'NBA');
  const plus100 = rows.find(row => row.side === 'OVER' && row.sportsbookKey === 'draftkings');
  const minus110 = rows.find(row => row.side === 'OVER' && row.sportsbookKey === 'prizepicks');
  assert.equal(plus100.price, 100);
  assert.equal(plus100.impliedProbability, 0.5);
  assert.ok(Math.abs(minus110.impliedProbability - 110 / 210) < 1e-12);
});

test('supports MLB batter and pitcher regular prop keys while excluding milestone alternates', () => {
  const fixture = {
    id: 'mlb-1',
    commence_time: '2099-01-01T00:00:00Z',
    home_team: 'Home',
    away_team: 'Away',
    bookmakers: [{
      key: 'fanduel',
      title: 'FanDuel',
      markets: [
        { key: 'batter_hits', outcomes: [
          { name: 'Over', description: 'Batter One', price: -120, point: 1.5 },
          { name: 'Under', description: 'Batter One', price: 100, point: 1.5 },
        ] },
        { key: 'pitcher_strikeouts', outcomes: [
          { name: 'Over', description: 'Pitcher One', price: -110, point: 6.5 },
          { name: 'Under', description: 'Pitcher One', price: -110, point: 6.5 },
        ] },
        { key: 'batter_hits_alternate', outcomes: [
          { name: 'Over', description: 'Batter One', price: 140, point: 2.5 },
        ] },
        { key: 'pitcher_record_a_win', outcomes: [
          { name: 'Yes', description: 'Pitcher One', price: 130 },
        ] },
      ],
    }],
  };
  const rows = normalizeTheOddsApiFixture(fixture, 'MLB');
  assert.equal(rows.length, 4);
  assert.deepEqual(new Set(rows.map(row => row.marketId)), new Set(['batter_hits', 'pitcher_strikeouts']));
});
