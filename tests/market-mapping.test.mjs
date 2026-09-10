import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldsFor, statFromRow, marketFromProviderKey, marketKey, MARKETS } from '../lib/data-sources/sportsdataio/markets.mjs';

test('the live label "Reception Yards" maps — this unmapped 40% of the NFL board', () => {
  assert.deepEqual(fieldsFor('NFL', 'Reception Yards'), ['ReceivingYards']);
  assert.deepEqual(fieldsFor('NFL', 'Receiving Yards'), ['ReceivingYards']);
  assert.deepEqual(fieldsFor('NFL', 'Rec Yards'), ['ReceivingYards']);
});

test('other drifted NFL labels the feed actually sends now map', () => {
  assert.deepEqual(fieldsFor('NFL', 'Pass TDs'), ['PassingTouchdowns']);
  assert.deepEqual(fieldsFor('NFL', 'Rush Yards'), ['RushingYards']);
  assert.deepEqual(fieldsFor('NFL', 'Pass Attempts'), ['PassingAttempts']);
});

test('space-separated NBA combos map, not just the "+" shorthand', () => {
  assert.deepEqual(fieldsFor('NBA', 'Points Rebounds Assists'), ['Points', 'Rebounds', 'Assists']);
  assert.deepEqual(fieldsFor('NBA', 'Points Rebounds'), ['Points', 'Rebounds']);
  assert.deepEqual(fieldsFor('NBA', 'Points Assists'), ['Points', 'Assists']);
  assert.deepEqual(fieldsFor('NBA', 'PRA'), ['Points', 'Rebounds', 'Assists']);
});

test('MLB markets the feed sends now map', () => {
  assert.deepEqual(fieldsFor('MLB', 'Hits Runs RBIs'), ['Hits', 'Runs', 'RunsBattedIn']);
  assert.deepEqual(fieldsFor('MLB', 'Home Runs'), ['HomeRuns']);
  assert.deepEqual(fieldsFor('MLB', 'Hits Allowed'), ['PitchingHits']);
});

test('WNBA and the college leagues have tables at all — they were null or absent', () => {
  assert.ok(MARKETS.WNBA, 'WNBA was null, so every WNBA prop reported "not mapped"');
  assert.ok(MARKETS.NCAAF, 'NCAAF had no table');
  assert.ok(MARKETS.NCAAB, 'NCAAB had no table');
  assert.deepEqual(fieldsFor('WNBA', 'Points'), ['Points']);
  assert.deepEqual(fieldsFor('NCAAF', 'Reception Yards'), ['ReceivingYards']);
  assert.deepEqual(fieldsFor('NCAAB', 'Points Rebounds Assists'), ['Points', 'Rebounds', 'Assists']);
});

test('the stable provider key wins over a drifted display label', () => {
  // The label is wrong/renamed but the provider key is authoritative.
  assert.deepEqual(fieldsFor('NFL', 'Some Renamed Label', 'player_reception_yds'), ['ReceivingYards']);
  assert.deepEqual(fieldsFor('NBA', 'Nonsense', 'player_points_rebounds_assists'), ['Points', 'Rebounds', 'Assists']);
  assert.deepEqual(fieldsFor('MLB', '???', 'batter_home_runs'), ['HomeRuns']);
});

test('an unknown provider key falls back to the label rather than failing', () => {
  assert.deepEqual(fieldsFor('NFL', 'Receptions', 'player_brand_new_market'), ['Receptions']);
  assert.equal(marketFromProviderKey('player_brand_new_market'), null);
  assert.equal(marketFromProviderKey(''), null);
  assert.equal(marketFromProviderKey(null), null);
});

test('markets with no honest game-log equivalent stay unmapped', () => {
  // A quarter-scoped market cannot be answered from full-game logs.
  assert.equal(fieldsFor('WNBA', 'Points Q1', 'player_points_q1'), null);
  // Kicking points needs weighted scoring the summing model cannot express.
  assert.equal(fieldsFor('NFL', 'Kicking Points', 'player_kicking_points'), null);
  // "TDs Over" does not say which touchdowns are counted.
  assert.equal(fieldsFor('NCAAF', 'TDs Over', 'player_tds_over'), null);
});

test('statFromRow honours the provider key and refuses partial combos', () => {
  const row = { Points: 20, Rebounds: 8, Assists: 5 };
  assert.equal(statFromRow('NBA', 'Anything', row, 'player_points_rebounds_assists'), 33);
  assert.equal(statFromRow('NBA', 'Points Rebounds Assists', { Points: 20, Rebounds: 8 }), null,
    'a missing component must yield null, never a partial sum');
});

test('marketKey still normalises the provider prefix and punctuation', () => {
  assert.equal(marketKey('Player Receptions'), 'receptions');
  assert.equal(marketKey('  Pass   Yards  '), 'pass yards');
  assert.equal(marketKey('Pts + Reb'), 'pts+reb');
});

test('an unknown sport or market yields null, not a guess', () => {
  assert.equal(fieldsFor('CRICKET', 'Runs'), null);
  assert.equal(fieldsFor('NFL', 'Completely Invented Market'), null);
  assert.equal(fieldsFor('NFL', ''), null);
});
