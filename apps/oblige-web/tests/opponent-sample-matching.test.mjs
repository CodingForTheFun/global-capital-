import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

/**
 * analytics.ts imports opponent-options.ts, so both are compiled and the
 * import is resolved by hand rather than mocked -- the behaviour under test is
 * precisely how the two modules agree on team identity.
 */
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

const { applyFilters, headToHead, EMPTY_FILTERS } = load('../lib/analytics.ts');

/** Four completed games, two of them against Houston under two spellings. */
const games = [
  { gameId: '1', date: '2026-09-14T17:00:00Z', opponent: 'HOU', value: 31, isHome: true, season: '2026' },
  { gameId: '2', date: '2026-09-07T17:00:00Z', opponent: 'TEN', value: 12, isHome: false, season: '2026' },
  { gameId: '3', date: '2025-12-01T17:00:00Z', opponent: 'Houston Texans', value: 44, isHome: false, season: '2025' },
  { gameId: '4', date: '2025-11-24T17:00:00Z', opponent: 'IND', value: 9, isHome: true, season: '2025' },
];

test('H2H covers every game against the opponent regardless of how each source spells it', () => {
  const window = headToHead(games, 'Houston Texans', 29.5, 'OVER');
  assert.equal(window.games, 2, 'the abbreviated game counts too');
  assert.equal(window.hits, 2);
});

test('H2H reaches the same games when the matchup names the opponent by abbreviation', () => {
  assert.equal(headToHead(games, 'HOU', 29.5, 'OVER').games, 2);
});

test('H2H stays empty rather than borrowing an unrelated opponent', () => {
  assert.equal(headToHead(games, 'Indianapolis Colts', 29.5, 'OVER').games, 1);
  assert.equal(headToHead(games, 'Denver Broncos', 29.5, 'OVER').games, 0);
  assert.equal(headToHead(games, null, 29.5, 'OVER'), null);
});

test('the opponent filter selects a team by identity, not by exact spelling', () => {
  const rows = applyFilters(games, { ...EMPTY_FILTERS, opponent: 'Houston Texans' });
  assert.deepEqual(rows.map((game) => game.gameId), ['1', '3']);
});

test('the opponent filter still narrows to one team and keeps the other filters intact', () => {
  assert.deepEqual(
    applyFilters(games, { opponent: 'HOU', season: '2026', venue: 'all' }).map((game) => game.gameId),
    ['1'],
  );
  assert.deepEqual(
    applyFilters(games, { opponent: 'HOU', season: 'all', venue: 'away' }).map((game) => game.gameId),
    ['3'],
  );
  assert.deepEqual(applyFilters(games, EMPTY_FILTERS).map((game) => game.gameId), ['1', '2', '3', '4']);
});

test('the research card derives the opponent and matches the sample on team identity', () => {
  const card = readFileSync(new URL('../components/player-prop-research-card.tsx', import.meta.url), 'utf8');
  assert.match(card, /currentOpponentLabels\(group\)\[0\]/, 'falls back to the matchup when no opponent field is posted');
  assert.match(card, /sameTeamLabel\(game\.opponent, currentOpponent\)/, 'the H2H chart matches the H2H window');
});
