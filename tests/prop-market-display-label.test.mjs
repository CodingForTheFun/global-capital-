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
});

test('source-qualified market ids still resolve to canonical stat labels', () => {
  assert.equal(
    propType({
      sport: 'MLB',
      playerName: 'Alec Bohm',
      marketId: 'propline:batter_home_runs',
      market: 'Alec Bohm Home Runs Over',
    }),
    'Home runs',
  );
  assert.equal(
    propType({
      sport: 'MLB',
      playerName: 'Alec Bohm',
      marketId: 'sportsgameodds:batter_total_bases',
      market: 'Alec Bohm Total Bases Over',
    }),
    'Total bases',
  );
});

test('label cleanup does not mutate normal stat names', () => {
  assert.equal(cleanMarketLabel('Points + Rebounds + Assists'), 'Points + Rebounds + Assists');
  assert.equal(cleanMarketLabel('Turnovers'), 'Turnovers');
});
