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

const { applyFilters, restByGame, upcomingRest, filterCoverage, advancedFilterCount, EMPTY_FILTERS } = load('../lib/analytics.ts');

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
  assert.deepEqual(coverage, { result: true, role: true, seasonType: true, rest: true, minutes: true });
  assert.deepEqual(filterCoverage([{ date: '2026-10-01', value: 3 }]), { result: false, role: false, seasonType: false, rest: false, minutes: false });
  assert.equal(advancedFilterCount({ ...EMPTY_FILTERS, result: 'W', minutes: '20' }), 2);
  assert.equal(advancedFilterCount({ opponent: 'all', season: 'all', venue: 'home' }), 0);
});
