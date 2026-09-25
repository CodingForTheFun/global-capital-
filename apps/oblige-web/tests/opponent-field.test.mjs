import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../lib/opponent-field.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
const { opponentField, otherSideValue } = module.exports;

// The opponent's own log: value is the opponent's statistic.
const royer = [
  { gameId: 'a', date: '2026-09-20', opponent: 'Adam Walton', value: 12, matchTotalGames: 19, setsWon: 2, setsLost: 0, gameResult: 'W' },
  { gameId: 'b', date: '2026-08-30', opponent: 'Dalibor Svrcina', value: 25, matchTotalGames: 51, setsWon: 2, setsLost: 3, gameResult: 'L' },
  { gameId: 'c', date: '2026-08-20', opponent: 'Daniil Medvedev', value: 10, matchTotalGames: 22, setsWon: 0, setsLost: 2, gameResult: 'L' },
  { gameId: 'd', date: '2026-08-10', opponent: null, value: 13, matchTotalGames: 20 },
  { gameId: 'e', date: '2026-08-01', opponent: 'Pedro Martinez', value: 12, matchTotalGames: null },
];

test('games won for the other player is the match total minus the opponent\'s games', () => {
  const field = opponentField(royer, 'games_w', 'Daniil Medvedev', 12.5, 'OVER');
  assert.deepEqual(field.rows.map((row) => [row.player, row.value, row.result, row.setScore, row.hit]), [
    ['Adam Walton', 7, 'L', '0-2', false],
    ['Dalibor Svrcina', 26, 'W', '3-2', true],
  ]);
  assert.equal(field.hits, 1);
  assert.equal(field.decided, 2);
  assert.equal(field.averageDiff, 4);
});

test('match totals are shared; head-to-head and unnamed matches are left out', () => {
  const field = opponentField(royer, 'total_games', 'Daniil Medvedev', 21.5, 'UNDER');
  assert.deepEqual(field.rows.map((row) => [row.player, row.value]), [['Adam Walton', 12], ['Dalibor Svrcina', 25], ['Pedro Martinez', 12]]);
  assert.equal(field.hits, 2);
});

test('sets use the verified set score; serve statistics need the source mirror', () => {
  assert.equal(otherSideValue('sets_won', { value: 2, setsWon: 2, setsLost: 3 }), 3);
  assert.equal(otherSideValue('sets_won', { value: 2, setsWon: 1, setsLost: 2 }), null, 'value disagrees with the set score');
  assert.equal(opponentField(royer, 'aces', 'X', 5.5, 'OVER'), null);
  assert.equal(opponentField(royer, null, 'X', 5.5, 'OVER'), null);
});

test('a push is neither a hit nor a miss', () => {
  const field = opponentField([{ gameId: 'p', date: '2026-09-01', opponent: 'Someone', value: 20, matchTotalGames: 20 }], 'total_games', 'X', 20, 'OVER');
  assert.equal(field.rows[0].push, true);
  assert.equal(field.decided, 0);
});

test('the source mirror answers serve statistics and must agree with a derivation', () => {
  assert.equal(otherSideValue('aces', { value: 7, opponentValue: 3 }), 3);
  assert.equal(otherSideValue('aces', { value: 7, opponentValue: null }), null);
  assert.equal(otherSideValue('games_w', { value: 12, matchTotalGames: 19, opponentValue: 7 }), 7);
  assert.equal(otherSideValue('games_w', { value: 12, matchTotalGames: 19, opponentValue: 8 }), null, 'a conflict is skipped');
  const games = [
    { gameId: 'a', date: '2026-09-20', opponent: 'Adam Walton', value: 4, opponentValue: 9 },
    { gameId: 'b', date: '2026-09-10', opponent: 'Dalibor Svrcina', value: 6 },
  ];
  const field = opponentField(games, 'aces', 'Valentin Royer', 6.5, 'OVER');
  assert.deepEqual(field.rows.map((row) => [row.player, row.value, row.hit]), [['Adam Walton', 9, true]]);
  assert.equal(opponentField([{ gameId: 'x', opponent: 'A', value: 3 }], 'aces', 'Valentin Royer', 6.5, 'OVER'), null);
});
