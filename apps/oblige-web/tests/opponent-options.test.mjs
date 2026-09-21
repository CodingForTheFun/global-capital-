import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../lib/opponent-options.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
const { buildOpponentOptions, sameTeamLabel } = module.exports;

test('Opponent picker lists the entire verified league directory, not only historical opponents', () => {
  const options = buildOpponentOptions(
    ['FRES', 'SJSU'],
    {
      team: 'Fresno St.',
      opponent: 'San Jose St.',
      homeTeam: 'San Jose St.',
      awayTeam: 'Fresno St.',
    },
    [
      { id: '1', abbreviation: 'FRES', name: 'Fresno State Bulldogs' },
      { id: '2', abbreviation: 'SJSU', name: 'San José State Spartans' },
      { id: '3', abbreviation: 'BOIS', name: 'Boise State Broncos' },
      { id: '4', abbreviation: 'UNLV', name: 'UNLV Rebels' },
    ],
  );

  assert.equal(options[0].value, 'all');
  assert.equal(options[0].label, 'All opponents');
  assert.equal(options.some((option) => option.label === 'All'), false);
  assert.equal(options.length, 5);
  assert.ok(options.some((option) => option.label === 'Boise State Broncos'));
  assert.ok(options.some((option) => option.label === 'UNLV Rebels'));

  const current = options.find((option) => option.value === 'SJSU');
  assert.deepEqual(current, { value: 'SJSU', label: 'San José State Spartans ★' });
});

test('verified historical alias remains the filter value for an existing team', () => {
  const options = buildOpponentOptions(
    ['KC', 'LV'],
    {
      team: 'Las Vegas Raiders',
      opponent: 'Kansas City Chiefs',
      homeTeam: 'Las Vegas Raiders',
      awayTeam: 'Kansas City Chiefs',
    },
    [
      { id: '12', abbreviation: 'KC', name: 'Kansas City Chiefs' },
      { id: '13', abbreviation: 'LV', name: 'Las Vegas Raiders' },
      { id: '14', abbreviation: 'DEN', name: 'Denver Broncos' },
    ],
  );

  assert.equal(options.find((option) => option.label.startsWith('Kansas City Chiefs'))?.value, 'KC');
  assert.equal(options.find((option) => option.label === 'Denver Broncos')?.value, 'DEN');
});

test('current matchup opponent stays available even if the directory is temporarily unavailable', () => {
  const options = buildOpponentOptions(
    [],
    {
      team: 'Los Angeles Lakers',
      opponent: 'Phoenix Suns',
      homeTeam: 'Los Angeles Lakers',
      awayTeam: 'Phoenix Suns',
    },
    [],
  );

  assert.deepEqual(options, [
    { value: 'all', label: 'All opponents' },
    { value: 'Phoenix Suns', label: 'Phoenix Suns ★' },
  ]);
});

test('team matching handles state abbreviations without conflating Kansas and Kansas State', () => {
  assert.equal(sameTeamLabel('San Jose St.', 'San José State Spartans'), true);
  assert.equal(sameTeamLabel('Fresno St.', 'Fresno State Bulldogs'), true);
  assert.equal(sameTeamLabel('KC', 'Kansas City Chiefs'), true);
  assert.equal(sameTeamLabel('Kansas', 'Kansas State Wildcats'), false);
});


test('common city aliases do not create duplicate pro teams', () => {
  assert.equal(sameTeamLabel('LA Angels', 'Los Angeles Angels'), true);
  assert.equal(sameTeamLabel('NY Yankees', 'New York Yankees'), true);

  const options = buildOpponentOptions(
    ['LA Angels', 'St. Louis Cardinals'],
    {
      team: 'Detroit Tigers',
      opponent: 'LA Angels',
      homeTeam: 'Detroit Tigers',
      awayTeam: 'Los Angeles Angels',
    },
    [
      { id: '108', abbreviation: 'LAA', name: 'Los Angeles Angels' },
      { id: '119', abbreviation: 'LAD', name: 'Los Angeles Dodgers' },
      { id: '138', abbreviation: 'STL', name: 'St. Louis Cardinals' },
      { id: '147', abbreviation: 'NYY', name: 'New York Yankees' },
    ],
  );

  assert.equal(options.filter(option => /Angels/.test(option.label)).length, 1);
  assert.ok(options.some(option => option.label === 'Los Angeles Dodgers'));
  assert.ok(options.some(option => option.label === 'New York Yankees'));
  assert.ok(options.some(option => option.label === 'St. Louis Cardinals'));
  assert.equal(options.length, 5, 'All opponents plus every directory team exactly once');
});
