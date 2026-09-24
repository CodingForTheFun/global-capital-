import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

function load(relative) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (specifier) =>
    specifier === './opponent-options' ? load('../lib/opponent-options.ts') : require(specifier);
  new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
  return module.exports;
}

const { applyFilters, restByGame, upcomingRest, filterCoverage, advancedFilterCount, winBand, rankBand, EMPTY_FILTERS } = load('../lib/analytics.ts');

// Oldest to newest: 10/1, 10/2 (back-to-back), 10/4 (1 day), 10/5 DNP, 10/8 (3 days after 10/4).
const games = [
  { gameId: 'e', date: '2026-10-08T23:30:00Z', value: 30, gameResult: 'W', started: true, minutes: 36, seasonType: 3 },
  { gameId: 'd', date: '2026-10-05T23:30:00Z', value: null, gameResult: 'L', started: false, minutes: 0, seasonType: 2 },
  { gameId: 'c', date: '2026-10-04T02:00:00Z', value: 18, gameResult: 'L', started: false, minutes: 22, seasonType: 2 },
  { gameId: 'b', date: '2026-10-02T23:00:00Z', value: 25, gameResult: 'W', started: true, minutes: 31, seasonType: 2 },
  { gameId: 'a', date: '2026-10-01T23:00:00Z', value: 12, gameResult: 'L', started: true, minutes: 28, seasonType: 2 },
];
const ids = (rows) => rows.map((row) => row.gameId).join('');

test('rest is measured between played games and the oldest game has none', () => {
  const rest = restByGame(games);
  assert.equal(rest.get(games[4]), undefined, 'no earlier game to measure from');
  assert.equal(rest.get(games[3]), 0, 'back-to-back');
  assert.equal(rest.get(games[2]), 1);
  assert.equal(rest.get(games[1]), undefined, 'a DNP is not a game played');
  assert.equal(rest.get(games[0]), 3);
});

test('rest filter buckets 3+ and fails closed on games without a rest value', () => {
  assert.equal(ids(applyFilters(games, { ...EMPTY_FILTERS, rest: '0' })), 'b');
  assert.equal(ids(applyFilters(games, { ...EMPTY_FILTERS, rest: '3+' })), 'e');
});

test('upcoming rest counts from the latest played game', () => {
  assert.equal(upcomingRest(games, '2026-10-10T23:00:00Z'), 1);
  assert.equal(upcomingRest(games, null), null);
  assert.equal(upcomingRest(games, '2026-10-01T00:00:00Z'), null, 'a start before the log is not a rest value');
});

test('result, role, minutes and game type filters use only recorded fields', () => {
  assert.equal(ids(applyFilters(games, { ...EMPTY_FILTERS, result: 'W' })), 'eb');
  assert.equal(ids(applyFilters(games, { ...EMPTY_FILTERS, role: 'bench' })), 'dc');
  assert.equal(ids(applyFilters(games, { ...EMPTY_FILTERS, minutes: '30' })), 'eb');
  assert.equal(ids(applyFilters(games, { ...EMPTY_FILTERS, seasonType: 'post' })), 'e');
  const unknown = [{ gameId: 'x', date: '2026-10-01', value: 5 }];
  for (const key of ['result', 'role', 'seasonType']) {
    const value = { result: 'W', role: 'starter', seasonType: 'regular' }[key];
    assert.equal(applyFilters(unknown, { ...EMPTY_FILTERS, [key]: value }).length, 0, `${key} fails closed`);
  }
});

test('coverage hides filters the log cannot answer and counts active ones', () => {
  const coverage = filterCoverage(games);
  assert.deepEqual(coverage, { result: true, role: true, seasonType: true, rest: true, minutes: true, setsPlayed: false, matchFormat: false, defenseTier: false, winProb: false, opponentRank: false, opponentHand: false, surface: false });
  assert.deepEqual(filterCoverage([{ date: '2026-10-01', value: 3 }]), { result: false, role: false, seasonType: false, rest: false, minutes: false, setsPlayed: false, matchFormat: false, defenseTier: false, winProb: false, opponentRank: false, opponentHand: false, surface: false });
  assert.equal(advancedFilterCount({ ...EMPTY_FILTERS, result: 'W', minutes: '20' }), 2);
  assert.equal(advancedFilterCount({ opponent: 'all', season: 'all', venue: 'home' }), 0);
});

test('tennis sets played and match format filter on verified set scores only', () => {
  const matches = [
    { gameId: 's1', date: '2026-09-06', value: 30, setsPlayed: 3, matchFormat: 'BO3', gameResult: 'W' },
    { gameId: 's2', date: '2026-09-04', value: 38, setsPlayed: 5, matchFormat: 'BO5', gameResult: 'W' },
    { gameId: 's3', date: '2026-09-02', value: 22, setsPlayed: 2, matchFormat: 'BO3', gameResult: 'L' },
    { gameId: 's4', date: '2026-08-30', value: 28 },
  ];
  const coverage = filterCoverage(matches);
  assert.equal(coverage.setsPlayed, true);
  assert.equal(coverage.matchFormat, true);
  assert.equal(ids(applyFilters(matches, { ...EMPTY_FILTERS, setsPlayed: '3' })), 's1');
  assert.equal(ids(applyFilters(matches, { ...EMPTY_FILTERS, matchFormat: 'BO3' })), 's1s3');
  assert.equal(ids(applyFilters(matches, { ...EMPTY_FILTERS, matchFormat: 'BO5', result: 'W' })), 's2');
  assert.equal(advancedFilterCount({ ...EMPTY_FILTERS, setsPlayed: '5', matchFormat: 'BO5' }), 2);
  assert.equal(filterCoverage([matches[0], matches[3]]).matchFormat, false, 'one format cannot split a sample');
});

test('win probability bands are inclusive at the bottom and fail closed when missing', () => {
  assert.deepEqual([70, 69.9, 55, 54.9, 45, 44.9, null, 101].map(winBand), ['fav70', 'fav55', 'fav55', 'even', 'even', 'dog', null, null]);
  const matches = [
    { gameId: 'm1', date: '2026-09-06', value: 30, winProbability: 82 },
    { gameId: 'm2', date: '2026-09-04', value: 38, winProbability: 40 },
    { gameId: 'm3', date: '2026-09-02', value: 22 },
  ];
  assert.equal(filterCoverage(matches).winProb, true);
  assert.equal(ids(applyFilters(matches, { ...EMPTY_FILTERS, winProb: 'dog' })), 'm2');
  assert.equal(ids(applyFilters(matches, { ...EMPTY_FILTERS, winProb: 'fav70' })), 'm1');
});

test('tennis opponent rank, hand and surface filters need two values and fail closed', () => {
  assert.deepEqual([1, 10, 11, 50, 51, 100, 101, 0, 2.5, null].map(rankBand), ['top10', 'top10', 'top50', 'top50', 'top100', 'top100', 'over100', null, null, null]);
  const matches = [
    { gameId: 't1', date: '2026-09-06', value: 30, opponentRank: 8, opponentHand: 'R', surface: 'Hard' },
    { gameId: 't2', date: '2026-09-04', value: 26, opponentRank: 140, opponentHand: 'L', surface: 'Clay' },
    { gameId: 't3', date: '2026-09-02', value: 22 },
  ];
  const coverage = filterCoverage(matches);
  assert.deepEqual([coverage.opponentRank, coverage.opponentHand, coverage.surface], [true, true, true]);
  assert.equal(ids(applyFilters(matches, { ...EMPTY_FILTERS, opponentRank: 'top10' })), 't1');
  assert.equal(ids(applyFilters(matches, { ...EMPTY_FILTERS, opponentHand: 'L' })), 't2');
  assert.equal(ids(applyFilters(matches, { ...EMPTY_FILTERS, surface: 'Hard', opponentHand: 'R' })), 't1');
  assert.equal(filterCoverage([matches[0], matches[2]]).surface, false);
});
