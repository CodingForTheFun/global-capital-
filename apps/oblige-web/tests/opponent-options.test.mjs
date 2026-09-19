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

const cases = [
  { sport: 'NCAAF', opponent: 'Buffalo', history: ['AKR', 'BUFF', 'EMU'], expected: 'BUFF' },
  { sport: 'NFL', opponent: 'Kansas City Chiefs', history: ['KC', 'LV', 'LAC'], expected: 'KC' },
  { sport: 'NBA', opponent: 'Boston Celtics', history: ['BOS', 'MIA', 'NYK'], expected: 'BOS' },
  { sport: 'WNBA', opponent: 'Connecticut Sun', history: ['CONN', 'IND', 'NYL'], expected: 'CONN' },
  { sport: 'MLB', opponent: 'Boston Red Sox', history: ['BOS', 'NYY', 'TB'], expected: 'BOS' },
  { sport: 'NHL', opponent: 'New York Rangers', history: ['BOS', 'NYR', 'TOR'], expected: 'NYR' },
];

for (const fixture of cases) {
  test(`${fixture.sport}: current opponent gets one visible star without changing the filter value`, () => {
    const options = buildOpponentOptions(fixture.history, {
      team: 'Example Team',
      opponent: fixture.opponent,
      homeTeam: 'Example Team',
      awayTeam: fixture.opponent,
    });
    const starred = options.filter(option => option.label.endsWith(' ★'));
    assert.equal(starred.length, 1);
    assert.equal(starred[0].value, fixture.expected);
    assert.equal(starred[0].label, `${fixture.expected} ★`);
    assert.equal(options[0].value, 'all');
    assert.equal(options[0].label, 'All');
  });
}

test('current opponent is still listed and starred when there is no prior head-to-head sample', () => {
  const options = buildOpponentOptions(['DAL', 'SAC'], {
    team: 'Los Angeles Lakers',
    opponent: 'PHX',
    homeTeam: 'Los Angeles Lakers',
    awayTeam: 'PHX',
  });
  assert.deepEqual(options.find(option => option.value === 'PHX'), { value: 'PHX', label: 'PHX ★' });
});

test('matchup side alias can identify the opponent when the board opponent label differs from history', () => {
  const options = buildOpponentOptions(['DAL', 'PHX'], {
    team: 'Dallas Mavericks',
    opponent: 'Phoenix Suns',
    homeTeam: 'DAL',
    awayTeam: 'PHX',
  });
  assert.deepEqual(options.find(option => option.value === 'PHX'), { value: 'PHX', label: 'PHX ★' });
});

test('no matchup opponent means no historical option is falsely starred', () => {
  const options = buildOpponentOptions(['AKR', 'BUFF'], {
    team: null,
    opponent: null,
    homeTeam: null,
    awayTeam: null,
  });
  assert.equal(options.some(option => option.label.endsWith(' ★')), false);
});

test('generic label matching handles the cross-sport abbreviations used by the dropdown', () => {
  assert.equal(sameTeamLabel('BOS', 'Boston Celtics'), true);
  assert.equal(sameTeamLabel('KC', 'Kansas City Chiefs'), true);
  assert.equal(sameTeamLabel('NYR', 'New York Rangers'), true);
  assert.equal(sameTeamLabel('BUFF', 'Buffalo'), true);
  assert.equal(sameTeamLabel('DAL', 'Philadelphia'), false);
});


test('every currently served sport can mark the verified current opponent without a sport allowlist', () => {
  const servedSports = [
    'NFL','NCAAF','NBA','NCAAB','WNBA','MLB','NHL','TENNIS','MLS','EPL','UCL',
    'PGA','MMA','BOXING','CRICKET','DARTS','ESPORTS','CFL','AFL','F1','TABLETENNIS',
    'VOLLEYBALL','BADMINTON','SNOOKER','CYCLING','RUGBYLEAGUE','RUGBYUNION',
    'NCAABASEBALL','NBASUMMER','FIFA','SOCCER','RL','KBO','NPB','UFC','TT',
    'NASCAR','BANANA BALL','MOTORCYCLE','BEACHVB','LA LIGA',
    'NFL1H','NFL1Q','WNBA1H','WNBA1Q','CFB1H','MLBLIVE','NBASZN','NHLSZN',
  ];
  for (const sport of servedSports) {
    const options = buildOpponentOptions(['OLD', 'OPP'], {
      team: `${sport} HOME`,
      opponent: 'OPP',
      homeTeam: `${sport} HOME`,
      awayTeam: 'OPP',
    });
    assert.deepEqual(
      options.find(option => option.value === 'OPP'),
      { value: 'OPP', label: 'OPP ★' },
      `${sport} must mark the verified current opponent`,
    );
  }
});
