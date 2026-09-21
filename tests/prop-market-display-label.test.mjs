import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanMarketLabel, propType } from '../lib/ui/prop-board.mjs';

test('market labels keep only the stat category when provider text repeats player, side and line', () => {
  assert.equal(
    cleanMarketLabel('Alec Bohm Home Runs Alternate Over 1.5', { playerName: 'Alec Bohm' }),
    'Home Runs',
  );
  assert.equal(
    cleanMarketLabel('Alec Bohm · Home Runs · Full Game · O 1.5', { playerName: 'Alec Bohm' }),
    'Home Runs',
  );
  assert.equal(cleanMarketLabel('Abimelec Ortiz Doubles Over/Under', { playerName: 'Abimelec Ortiz' }), 'Doubles');
  assert.equal(cleanMarketLabel('Abimelec Ortiz Hits + Runs + RBIs Over/Under', { playerName: 'Abimelec Ortiz' }), 'Hits + Runs + RBIs');
  assert.equal(cleanMarketLabel('Abimelec Ortiz Hits Over/Under', { playerName: 'Abimelec Ortiz' }), 'Hits');
  assert.equal(cleanMarketLabel('Abimelec Ortiz Home Runs Over/Under', { playerName: 'Abimelec Ortiz' }), 'Home Runs');
  assert.equal(cleanMarketLabel('Abimelec Ortiz Runs Batted In Over/Under', { playerName: 'Abimelec Ortiz' }), 'Runs Batted In');
  assert.equal(cleanMarketLabel('Abimelec Ortiz Runs Over/Under', { playerName: 'Abimelec Ortiz' }), 'Runs');
  assert.equal(cleanMarketLabel('Abimelec Ortiz Singles Over/Under', { playerName: 'Abimelec Ortiz' }), 'Singles');
});

test('source-qualified market ids still resolve to canonical display labels', () => {
  assert.equal(
    cleanMarketLabel('Alec Bohm Home Runs Over', {
      sport: 'MLB',
      playerName: 'Alec Bohm',
      marketId: 'propline:batter_home_runs',
    }),
    'Home runs',
  );
  assert.equal(
    cleanMarketLabel('Alec Bohm Total Bases Over', {
      sport: 'MLB',
      playerName: 'Alec Bohm',
      marketId: 'sportsgameodds:batter_total_bases',
    }),
    'Total bases',
  );
});

test('propType uses the same cleaned stat category everywhere', () => {
  assert.equal(
    propType({
      sport: 'MLB',
      playerName: 'Alec Bohm',
      marketId: 'propline:batter_home_runs',
      market: 'Alec Bohm Home Runs Alternate Over 1.5',
    }),
    'Home runs',
  );
});

test('label cleanup does not mutate normal stat names', () => {
  assert.equal(cleanMarketLabel('Points + Rebounds + Assists'), 'Points + Rebounds + Assists');
  assert.equal(cleanMarketLabel('Turnovers'), 'Turnovers');
});
