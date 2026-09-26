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
const { profileMarkets, profileSupported, seedLine, samePlayerName, nameMatchesQuery, profileGroup, isProfileGroup, playerProps } = load('../lib/player-profile.ts');
const { offenseReading, propMatchup, MATCHUP_LABEL } = load('../lib/defense.ts');

test('profile markets follow the player role and skip sports read only from posted props', () => {
  assert.equal(profileMarkets('NFL', 'QB')[0], 'player_pass_yds');
  assert.equal(profileMarkets('NFL', 'WR')[0], 'player_reception_yds');
  assert.ok(profileMarkets('NFL', null).includes('player_pass_yds') && profileMarkets('NFL', null).includes('player_receptions'));
  assert.equal(profileMarkets('MLB', 'SP')[0], 'pitcher_strikeouts');
  assert.equal(profileMarkets('MLB', 'DH')[0], 'batter_hits');
  assert.deepEqual(profileMarkets('NHL', 'G'), ['player_total_saves']);
  assert.equal(profileSupported('TENNIS'), false);
  assert.equal(profileSupported('NBA'), true);
});

test('the starting target line is the recent median moved to the half point above, never invented', () => {
  const games = [30, 22, 25, 18, 40, 27, 24, 21, 26, 29, 90].map((value, index) => ({ value, date: `2026-03-${String(20 - index).padStart(2, '0')}` }));
  // The eleventh game is the oldest and is left out; the median of the last ten is 25.5.
  assert.equal(seedLine(games), 25.5);
  assert.equal(seedLine([{ value: 3, date: '2026-01-01' }]), 3.5);
  assert.equal(seedLine([{ value: 0, date: '2026-01-01' }]), 0.5);
  assert.equal(seedLine([{ value: null, date: '2026-01-01' }]), null);
  assert.equal(seedLine([]), null);
});

test('names match across accents and suffixes; search terms match word starts', () => {
  assert.equal(samePlayerName('Luka Dončić', 'Luka Doncic'), true);
  assert.equal(samePlayerName('Jaren Jackson Jr.', 'Jaren Jackson Jr'), true);
  // A suffix can be a different person; it is never dropped.
  assert.equal(samePlayerName('Kenneth Walker III', 'Kenneth Walker'), false);
  assert.equal(samePlayerName('Josh Allen', 'Josh Hines-Allen'), false);
  assert.equal(nameMatchesQuery('Jalen Brunson', 'jal bru'), true);
  assert.equal(nameMatchesQuery('Jalen Brunson', 'unson'), false);
  assert.equal(nameMatchesQuery('Jalen Brunson', ''), false);
});

test('a profile group carries identity and the next game, with no quotes or posted line', () => {
  const group = profileGroup({ sport: 'nfl', name: 'Josh Allen', espnId: '3918298', team: 'BUF', position: 'QB', nextGame: { homeTeam: 'BUF', awayTeam: 'LAC', opponent: 'LAC', startsAt: '2026-09-27T17:00:00.000Z', status: 'pre' } }, 'player_pass_yds', 245.5);
  assert.equal(isProfileGroup(group), true);
  assert.equal(isProfileGroup({ key: 'NFL|abc' }), false);
  assert.deepEqual([group.sport, group.opponent, group.homeTeam, group.awayTeam, group.line, group.live], ['NFL', 'LAC', 'BUF', 'LAC', 245.5, false]);
  assert.deepEqual(group.quotes, []);
  assert.equal(group.bestOver, null);
  assert.equal(group.propId, null);
  assert.equal(group.providerPlayerId, 'history:NFL:3918298', 'history is pinned to the searched athlete');
  assert.equal(profileGroup({ sport: 'NFL', name: 'Josh Allen' }, 'player_pass_yds', null).providerPlayerId, null);
});

const defense = {
  available: true,
  teams: [{ id: '1', abbreviation: 'BUF', name: 'Buffalo Bills' }, { id: '2', abbreviation: 'LAC', name: 'Los Angeles Chargers' }, { id: '3', abbreviation: 'NYJ', name: 'New York Jets' }],
  rows: [
    { teamId: '2', position: 'QB', metric: 'passingYards', average: 280, games: 3, rank: 3, leagueSize: 3 },
    { teamId: '3', position: 'QB', metric: 'passingYards', average: 180, games: 3, rank: 1, leagueSize: 3 },
  ],
  offenseRows: [
    { teamId: '1', position: 'QB', metric: 'passingYards', average: 300, games: 3, rank: 3, leagueSize: 3 },
    { teamId: '1', position: 'QB', metric: 'rushingYards', average: 40, games: 3, rank: null, leagueSize: 3 },
  ],
};

test('offense reading ranks the own team by what the position produces; no rank, no reading', () => {
  const reading = offenseReading(defense, 'BUF', 'QB', 'passingYards');
  assert.equal(reading.producedRank, 1);
  assert.equal(reading.team, 'BUF');
  assert.equal(offenseReading(defense, 'BUF', 'QB', 'rushingYards'), null);
  assert.equal(offenseReading(defense, 'Buffalo', 'WR', 'passingYards'), null);
  assert.equal(offenseReading({ ...defense, offenseRows: undefined }, 'BUF', 'QB', 'passingYards'), null);
});

test('a board row reads Easy against a generous defense and Hard against a stingy one, only when exact', () => {
  const row = { sport: 'NFL', market: 'player_pass_yds', marketId: 'player_pass_yds', position: 'QB', team: 'BUF', opponent: null, homeTeam: 'BUF', awayTeam: 'LAC', player: 'Josh Allen' };
  const easy = propMatchup(defense, row);
  assert.equal(easy.tier, 'soft');
  assert.equal(MATCHUP_LABEL[easy.tier], 'Easy matchup');
  assert.equal(propMatchup(defense, { ...row, awayTeam: 'NYJ' }).tier, 'tough');
  assert.equal(MATCHUP_LABEL.tough, 'Hard matchup');
  assert.equal(propMatchup(defense, { ...row, position: 'QB/RB' }), null);
  assert.equal(propMatchup(defense, { ...row, sport: 'MLB' }), null);
  assert.equal(propMatchup(defense, { ...row, market: 'player_sacks', marketId: 'player_sacks' }), null);
});

test('live props from search never borrow a same-name player on another team', () => {
  const board = [
    { player: 'Luis Garcia', team: 'SD', key: 'a' },
    { player: 'Luis García', team: 'WSH', key: 'b' },
    { player: 'Jalen Brunson', team: 'NYK', key: 'c' },
  ];
  // The confirmed profile carries ESPN's abbreviation and full name.
  assert.deepEqual(playerProps(board, 'Luis Garcia', ['WSH', 'Washington Nationals']).map((g) => g.key), ['b']);
  // A label the matcher cannot tie to the feed's abbreviation fails closed.
  assert.deepEqual(playerProps(board, 'Luis Garcia', ['Washington Nationals']), []);
  // The searched team matches none of them: nothing, rather than a guess.
  assert.deepEqual(playerProps(board, 'Luis Garcia', ['Houston Astros']), []);
  assert.deepEqual(playerProps(board, 'Jalen Brunson', ['New York Knicks']).map((g) => g.key), ['c']);
  // No team known (opened from the board by exact name): every prop under the name.
  assert.deepEqual(playerProps(board, 'Luis Garcia').map((g) => g.key), ['a', 'b']);
});
