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
const { liveGame, contextSport, propsForGame, newsForGame, orderGames } = load('../lib/games.ts');

const raw = {
  id: 'NFL:401', gameId: '401', sport: 'NFL', league: 'NFL', homeTeam: 'BUF', awayTeam: 'LAC',
  homeName: 'Buffalo Bills', awayName: 'Los Angeles Chargers', homeScore: '21', awayScore: 17,
  status: 'LIVE', providerStatus: 'Q3 4:12', startTime: '2026-09-27T17:00:00Z',
};

test('a scoreboard row needs a game id, a sport and both teams', () => {
  const game = liveGame(raw);
  assert.equal(game.homeScore, 21);
  assert.equal(game.status, 'LIVE');
  assert.equal(liveGame({ ...raw, gameId: '' }), null);
  assert.equal(liveGame({ ...raw, awayTeam: '' }), null);
  assert.equal(liveGame({ ...raw, status: 'weird' }).status, 'SCHEDULED');
});

test('game context reads ESPN games only, and soccer by its competition', () => {
  assert.equal(contextSport(liveGame(raw)), 'NFL');
  assert.equal(contextSport({ sport: 'SOCCER', league: 'EPL', source: null }), 'EPL');
  assert.equal(contextSport({ sport: 'SOCCER', league: 'Soccer', source: null }), null);
  assert.equal(contextSport({ sport: 'NBA', league: 'NBA', source: 'sportradar' }), null);
  assert.equal(contextSport({ sport: 'TENNIS', league: 'ATP', source: null }), null);
});

test('props join a game only with both teams the same way round and a close start', () => {
  const game = liveGame(raw);
  const groups = [
    { key: 'a', homeTeam: 'Buffalo Bills', awayTeam: 'Los Angeles Chargers', startsAt: '2026-09-27T17:00:00Z' },
    { key: 'b', homeTeam: 'BUF', awayTeam: 'LAC', startsAt: '2026-09-27T17:20:00Z' },
    // Reversed home and away: another fixture.
    { key: 'c', homeTeam: 'LAC', awayTeam: 'BUF', startsAt: '2026-09-27T17:00:00Z' },
    // Same teams, a later meeting.
    { key: 'd', homeTeam: 'BUF', awayTeam: 'LAC', startsAt: '2026-12-27T17:00:00Z' },
    // One team only.
    { key: 'e', homeTeam: 'BUF', awayTeam: 'MIA', startsAt: '2026-09-27T17:00:00Z' },
    // No start time.
    { key: 'f', homeTeam: 'BUF', awayTeam: 'LAC', startsAt: null },
  ];
  assert.deepEqual(propsForGame(groups, game).map((g) => g.key), ['a', 'b']);
  assert.deepEqual(propsForGame(groups, { ...game, startTime: null }), []);
});

test('news joins a game only on a team\'s full name', () => {
  const game = liveGame(raw);
  const articles = [
    { id: '1', headline: 'Buffalo Bills sign a kicker', description: null },
    { id: '2', headline: 'Injury update', description: 'The Los Angeles Chargers list two out.' },
    { id: '3', headline: 'Bills pass on a trade', description: null },
    { id: '4', headline: 'Buffalo Billsford festival', description: null },
  ];
  assert.deepEqual(newsForGame(articles, game).map((a) => a.id), ['1', '2']);
  // A feed that only knows the abbreviation gives nothing to match safely.
  assert.deepEqual(newsForGame(articles, { ...game, homeName: 'BUF', awayName: 'LAC' }), []);
});

test('live first, then upcoming soonest, then finals newest', () => {
  const at = (id, status, startTime) => liveGame({ ...raw, id, gameId: id, status, startTime });
  const order = orderGames([
    at('f1', 'FINAL', '2026-09-26T17:00:00Z'), at('u2', 'SCHEDULED', '2026-09-28T17:00:00Z'),
    at('l', 'LIVE', '2026-09-27T17:00:00Z'), at('f2', 'FINAL', '2026-09-26T20:00:00Z'),
    at('u1', 'SCHEDULED', '2026-09-27T20:00:00Z'),
  ]).map((g) => g.id);
  assert.deepEqual(order, ['l', 'u1', 'u2', 'f2', 'f1']);
});

test('a team-only prop gets its opponent from the slate only under every check', () => {
  const { slateOpponent } = load('../lib/games.ts');
  const game = (id, home, away, startTime, status = 'SCHEDULED') => liveGame({ ...raw, id, gameId: id, homeTeam: home, awayTeam: away, homeName: home + ' City', awayName: away + ' Town', startTime, status });
  const slate = [game('1', 'WSH', 'NYM', '2026-09-26T23:05:00Z'), game('2', 'MIN', 'CLE', '2026-09-26T23:10:00Z'), game('3', 'PIT', 'CHC', '2026-09-26T17:00:00Z', 'FINAL')];
  const prop = { team: 'WSH', startsAt: '2026-09-26T23:05:00Z' };
  // The opponent comes back as its full name, which matches exactly one team.
  assert.equal(slateOpponent(prop, 'WSH', slate), 'NYM Town');
  assert.equal(slateOpponent({ ...prop, team: 'NYM' }, 'NYM', slate), 'WSH City');
  assert.equal(slateOpponent({ ...prop, startsAt: null }, 'WSH', slate), null, 'no start time, no guess');
  assert.equal(slateOpponent(prop, null, slate), null, 'research has not verified the team');
  assert.equal(slateOpponent(prop, 'MIN', slate), null, 'the verified team disagrees with the prop');
  assert.equal(slateOpponent({ ...prop, startsAt: '2026-09-27T05:00:00Z' }, 'WSH', slate), null, 'no game within three hours');
  assert.equal(slateOpponent({ team: 'PIT', startsAt: '2026-09-26T17:00:00Z' }, 'PIT', slate), null, 'a finished game is not used');
  assert.equal(slateOpponent(prop, 'WSH', [...slate, game('4', 'WSH', 'ATL', '2026-09-26T22:00:00Z')]), null, 'two fitting games answer nothing');
  assert.equal(slateOpponent({ ...prop, team: 'W' }, 'W', slate), null, 'partial labels never match');
});
