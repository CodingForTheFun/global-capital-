import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
function load(relative) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
  return module.exports;
}
const { espnEventId, teammateOptions, withWithoutSplit } = load('../lib/with-without.ts');

const athlete = (id, name, played, minutes = played ? 30 : 0) => ({ id, name, played, reason: played ? null : 'KNEE', minutes });
const games = [
  { key: 'nba:1', eventId: '1', athletes: [athlete('10', 'Star Player', true), athlete('20', 'Big Teammate', true, 32), athlete('30', 'Bench Guy', true, 8)] },
  { key: 'nba:2', eventId: '2', athletes: [athlete('10', 'Star Player', true), athlete('20', 'Big Teammate', false), athlete('30', 'Bench Guy', true, 10)] },
  { key: 'nba:3', eventId: '3', athletes: [athlete('10', 'Star Player', true), athlete('20', 'Big Teammate', false), athlete('30', 'Bench Guy', false)] },
  // Traded in: not listed in the earlier games.
  { key: 'nba:4', eventId: '4', athletes: [athlete('10', 'Star Player', true), athlete('20', 'Big Teammate', true, 34), athlete('40', 'New Guy', true)] },
];

test('only ESPN game-log rows for the same sport carry a joinable event id', () => {
  assert.equal(espnEventId('wnba:401857217', 'WNBA'), '401857217');
  assert.equal(espnEventId('nba:401857217', 'WNBA'), null);
  assert.equal(espnEventId('propline:abc', 'WNBA'), null);
  assert.equal(espnEventId(null, 'NBA'), null);
});

test('teammates offered have both played and missed; the player and ever-present teammates are not offered', () => {
  const options = teammateOptions(games, { id: '10', name: 'Star Player' });
  assert.deepEqual(options.map((o) => o.id), ['20', '30'], 'heaviest minutes first; New Guy never missed');
  assert.deepEqual([options[0].played, options[0].missed, options[0].minutes], [2, 2, 33]);
  // Without an id the player is excluded by exact name.
  assert.ok(!teammateOptions(games, { name: 'Star Player' }).some((o) => o.id === '10'));
});

test('the split joins by the game-log row\'s own id and counts only games where the teammate is listed', () => {
  const playerGames = [
    { gameId: 'nba:1', value: 30 }, { gameId: 'nba:2', value: 20 }, { gameId: 'nba:3', value: 26 },
    { gameId: 'nba:4', value: 24 }, { gameId: 'propline:x', value: 50 }, { gameId: 'nba:9', value: 40 },
  ];
  const split = withWithoutSplit(playerGames, games, '20', 'NBA', 24.5, true);
  assert.deepEqual(split.with, { games: 2, average: 27, hits: 1, pushes: 0 });
  assert.deepEqual(split.without, { games: 2, average: 23, hits: 1, pushes: 0 });
  assert.equal(split.noBoxScore, 2, 'another source and a game with no box score are left out');
  assert.equal(split.notListed, 0);
  const under = withWithoutSplit(playerGames, games, '20', 'NBA', 24.5, false);
  assert.equal(under.with.hits, 1);
  // A traded-in teammate splits only the games they are listed in.
  const traded = withWithoutSplit(playerGames, games, '40', 'NBA', 24.5, true);
  assert.equal(traded.with.games + traded.without.games, 1);
  assert.equal(traded.notListed, 3, 'games before the teammate joined are counted apart');
});
