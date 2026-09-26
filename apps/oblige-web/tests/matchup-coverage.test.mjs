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
const { propMatchup, readingStat, readingAudience, MATCHUP_LABEL } = load('../lib/defense.ts');

const NAMES = ['Anchorage Auks', 'Boise Bears', 'Camden Cats', 'Dover Ducks', 'Eugene Elks', 'Fresno Foxes', 'Gary Geese', 'Helena Hawks', 'Irvine Ibis', 'Juneau Jays', 'Keene Kites', 'Laredo Lynx'];
const teams = NAMES.map((name, i) => ({ id: String(i + 1), abbreviation: 'T' + String.fromCharCode(65 + i) + 'X', name }));
const T = (n) => 'T' + String.fromCharCode(64 + n) + 'X';
const row = (teamId, position, metric, average) => ({ teamId, position, metric, average, games: 10, rank: null, leagueSize: 12 });
// Team i allows more of everything as i grows: T12 is the softest, T1 the stingiest.
const mlb = { available: true, teams, rows: teams.flatMap((t, i) => ['hits', 'runs', 'rbis', 'walks', 'homeRuns'].map((m) => row(t.id, 'BAT', m, 1 + i * 0.1))) };
const base = { sport: 'MLB', player: 'CJ Abrams', team: 'WSH', position: null, homeTeam: null, awayTeam: null };

test('hitter fantasy score ranks the opponent on the fantasy stats it allows', () => {
  const soft = propMatchup(mlb, { ...base, market: 'Hitter Fantasy Score', marketId: 'batter_fantasy_score', opponent: T(12) });
  assert.equal(soft.tier, 'soft');
  assert.equal(soft.allowedRank, 1);
  assert.match(readingStat(soft), /hitter fantasy stats/);
  assert.equal(propMatchup(mlb, { ...base, market: 'Hitter Fantasy Score', marketId: 'batter_fantasy_score', opponent: T(1) }).tier, 'tough');
  const medium = propMatchup(mlb, { ...base, market: 'Hits + Runs + RBIs', marketId: 'batter_hits_runs_rbis', opponent: T(6) });
  assert.equal(medium.tier, 'average');
  assert.equal(MATCHUP_LABEL.average, 'Medium matchup');
});

test('a team missing any component is left out of the ranking, and the opponent must have them all', () => {
  const partial = { ...mlb, rows: mlb.rows.filter((r) => !(r.teamId === '12' && r.metric === 'walks')) };
  assert.equal(propMatchup(partial, { ...base, market: 'Hitter Fantasy Score', marketId: 'batter_fantasy_score', opponent: T(12) }), null);
  const other = propMatchup(partial, { ...base, market: 'Hitter Fantasy Score', marketId: 'batter_fantasy_score', opponent: T(11) });
  assert.equal(other.leagueSize, 11);
  assert.equal(other.allowedRank, 1);
});

test('with no listed position, basketball ranks what the opponent allows to all positions combined', () => {
  const nba = { available: true, teams, rows: teams.flatMap((t, i) => ['G', 'F', 'C'].flatMap((p) => ['points', 'rebounds', 'assists'].map((m) => row(t.id, p, m, 10 + i)))) };
  const prop = { sport: 'NBA', player: 'X', team: 'NYK', homeTeam: null, awayTeam: null, opponent: T(12), position: null };
  const pts = propMatchup(nba, { ...prop, market: 'Points', marketId: 'player_points' });
  assert.equal(pts.row.position, 'ALL');
  assert.equal(pts.tier, 'soft');
  assert.equal(readingAudience(pts, 'NBA'), ' to all positions');
  const pra = propMatchup(nba, { ...prop, market: 'Pts+Rebs+Asts', marketId: 'player_points_rebounds_assists', position: 'PG' });
  assert.equal(pra.row.position, 'G');
  assert.match(readingStat(pra), /points, rebounds and assists/);
});

test('soccer goals read against shots on target allowed; tennis has no matchup', () => {
  const epl = { available: true, teams, rows: teams.map((t, i) => row(t.id, 'ALL', 'shotsOnTarget', 3 + i * 0.2)) };
  const goals = propMatchup(epl, { sport: 'EPL', player: 'X', team: 'ARS', homeTeam: null, awayTeam: null, opponent: T(1), position: null, market: 'Goals', marketId: 'player_goals' });
  assert.equal(goals.tier, 'tough');
  assert.equal(readingStat(goals), 'shots on target');
  assert.equal(propMatchup(epl, { sport: 'TENNIS', player: 'X', team: null, homeTeam: 'A', awayTeam: 'B', opponent: 'B', position: null, market: 'Aces', marketId: 'player_aces' }), null);
});
