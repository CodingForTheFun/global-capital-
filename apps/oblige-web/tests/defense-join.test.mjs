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
  const localRequire = (specifier) => specifier === './opponent-options' ? load('../lib/opponent-options.ts') : require(specifier);
  new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
  return module.exports;
}
const { defenseMetricFor, exactPosition, matchupPosition, teamIdFor, defenseReading, tierFor, ordinal } = load('../lib/defense.ts');

const teams = [
  { id: '1', abbreviation: 'NYK', name: 'New York Knicks' },
  { id: '2', abbreviation: 'BOS', name: 'Boston Celtics' },
  { id: '3', abbreviation: 'LAL', name: 'Los Angeles Lakers' },
  { id: '4', abbreviation: 'LAC', name: 'LA Clippers' },
];
const rows = teams.map((team, index) => ({ teamId: team.id, position: 'PG', metric: 'points', average: 20 + index, games: 5, rank: index + 1, leagueSize: 4 }));
const response = { available: true, teams, rows };

test('stats map only to a ranked metric; combos and unmapped stats do not', () => {
  assert.equal(defenseMetricFor('NBA', 'player_points', 'Points'), 'points');
  assert.equal(defenseMetricFor('WNBA', null, '3-Pointers Made'), 'threes');
  assert.equal(defenseMetricFor('NFL', 'player_reception_yds', 'Receiving Yards'), 'receivingYards');
  assert.equal(defenseMetricFor('NFL', null, 'Pass TDs'), 'passingTouchdowns');
  assert.equal(defenseMetricFor('NBA', 'player_points_rebounds_assists', 'PRA'), null);
  // Baseball keeps the batter/pitcher split: the same word is two stats.
  assert.equal(defenseMetricFor('MLB', 'batter_hits', 'Hits'), 'hits');
  assert.equal(defenseMetricFor('MLB', 'batter_strikeouts'), 'strikeouts');
  assert.equal(defenseMetricFor('MLB', 'pitcher_strikeouts'), 'pitcherStrikeouts');
  assert.equal(defenseMetricFor('MLB', 'batter_total_bases'), null, 'not ranked, so not shown');
  assert.equal(defenseMetricFor('NHL', 'player_shots_on_goal'), 'shotsOnGoal');
  assert.equal(defenseMetricFor('NHL', 'player_total_saves'), 'saves');
  assert.equal(defenseMetricFor('EPL', 'player_shots_on_target'), 'shotsOnTarget');
  assert.equal(defenseMetricFor('TENNIS', 'player_aces'), null);
});

test('the matchup role comes from the stat or an exact listed role, never a guess', () => {
  assert.equal(exactPosition('NBA', null, 'pg'), 'G', 'basketball ranks guards, forwards and centers');
  assert.equal(exactPosition('NBA', 'F-C'), 'F');
  assert.equal(exactPosition('NFL', 'LB', 'WR'), 'WR');
  assert.equal(exactPosition('NFL', 'FB'), 'RB');
  assert.equal(matchupPosition('MLB', 'pitcherStrikeouts'), 'PIT');
  assert.equal(matchupPosition('MLB', 'hits', 'SS'), 'BAT');
  assert.equal(matchupPosition('EPL', 'shots', 'FW'), 'ALL');
  assert.equal(matchupPosition('NHL', 'saves', 'C'), 'G', 'saves are always the goalie');
  assert.equal(matchupPosition('NHL', 'shotsOnGoal', 'LW'), 'F');
  assert.equal(matchupPosition('NHL', 'shotsOnGoal', null), null, 'a skater with no listed role is not guessed');
  assert.equal(matchupPosition('NBA', null, 'G'), null, 'no ranked stat, no matchup');
});

test('a label matching two teams is not a team', () => {
  assert.equal(teamIdFor('NYK', teams), '1');
  assert.equal(teamIdFor('Boston Celtics', teams), '2');
  assert.equal(teamIdFor('Los Angeles', teams), null);
});

test('reading flips rank to "allows the most" and tiers by thirds', () => {
  const soft = defenseReading(response, 'LAC', 'PG', 'points');
  assert.equal(soft.allowedRank, 1);
  assert.equal(soft.tier, 'soft');
  const tough = defenseReading(response, 'NYK', 'PG', 'points');
  assert.equal(tough.allowedRank, 4);
  assert.equal(tough.tier, 'tough');
  assert.equal(defenseReading(response, 'NYK', 'SG', 'points'), null, 'no row for that slot');
  assert.equal(defenseReading({ ...response, rows: rows.map((row) => ({ ...row, rank: null })) }, 'NYK', 'PG', 'points'), null, 'no rank until every team has enough games');
  assert.equal(defenseReading({ ...response, available: false }, 'NYK', 'PG', 'points'), null);
});

test('tiers split 30 teams 10/10/10 and ordinals read naturally', () => {
  assert.deepEqual([1, 10, 11, 20, 21, 30].map((rank) => tierFor(rank, 30)), ['soft', 'soft', 'average', 'average', 'tough', 'tough']);
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd']);
});
