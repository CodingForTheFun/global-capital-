import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldsFor, marketKey, statFromRow } from '../lib/data-sources/sportsdataio/markets.mjs';

test('SportsDataIO Player prefixes normalize to canonical NFL stat markets', () => {
  assert.equal(marketKey('Player Receptions'), 'receptions');
  assert.deepEqual(fieldsFor('NFL', 'Player Receptions'), ['Receptions']);
  assert.deepEqual(fieldsFor('NFL', 'Player Rushing Attempts'), ['RushingAttempts']);
  assert.deepEqual(fieldsFor('NFL', 'Player Passing Yards'), ['PassingYards']);
  assert.equal(statFromRow('NFL', 'Player Receptions', { Receptions: 7 }), 7);
});

test('provider Player prefixes work for baseball and basketball without guessing missing values', () => {
  assert.deepEqual(fieldsFor('MLB', 'Player Hits'), ['Hits']);
  assert.deepEqual(fieldsFor('NBA', 'Player Points'), ['Points']);
  assert.equal(statFromRow('MLB', 'Player Hits', { Hits: 2 }), 2);
  assert.equal(statFromRow('NBA', 'Player Points', { Points: null }), null);
});

test('MLB earned runs maps to the actual earned-runs stat, not ERA', () => {
  assert.deepEqual(fieldsFor('MLB', 'Player Earned Runs'), ['EarnedRuns']);
  assert.equal(statFromRow('MLB', 'Player Earned Runs', { EarnedRuns: 3, EarnedRunAverage: 9.99 }), 3);
});
