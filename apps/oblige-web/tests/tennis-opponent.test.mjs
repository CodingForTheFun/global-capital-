import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../lib/opponent-options.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
const { currentOpponentLabels } = module.exports;

test('a tennis player posted as one participant faces the other', () => {
  assert.deepEqual(currentOpponentLabels({ player: 'Daniil Medvedev', team: null, opponent: null, homeTeam: 'Valentin Royer', awayTeam: 'Daniil Medvedev' }), ['Valentin Royer']);
  assert.deepEqual(currentOpponentLabels({ player: 'Daniil Medvedev', team: '', opponent: null, homeTeam: 'Daniil Medvedev', awayTeam: 'Valentin Royer' }), ['Valentin Royer']);
});

test('no exact participant match means no derived opponent', () => {
  assert.deepEqual(currentOpponentLabels({ player: 'D. Medvedev', team: null, opponent: null, homeTeam: 'Valentin Royer', awayTeam: 'Daniil Medvedev' }), []);
  assert.deepEqual(currentOpponentLabels({ player: 'Someone', team: null, opponent: null, homeTeam: 'A Player', awayTeam: 'B Player' }), []);
});

test('team sports keep the team-based rule and ignore the player name', () => {
  assert.deepEqual(currentOpponentLabels({ player: 'Jalen Hurts', team: 'PHI', opponent: null, homeTeam: 'DAL', awayTeam: 'PHI' }), ['DAL']);
});
