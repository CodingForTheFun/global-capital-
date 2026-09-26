import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPlayerDirectory, playersFromSearch, nextGameFrom, sportForLeague, cleanQuery} from '../lib/data-sources/espn/player-directory.mjs';
import {gatedApi} from '../lib/auth/gate.mjs';

const searchPayload = {results: [
  {type: 'team', contents: [{uid: 's:20~l:28~t:2', displayName: 'Buffalo Bills'}]},
  {type: 'player', contents: [
    {uid: 's:20~l:28~a:3918298', displayName: 'Josh Allen', subtitle: 'Buffalo Bills', sport: 'football', defaultLeagueSlug: 'nfl'},
    {uid: 's:20~l:28~a:3918298', displayName: 'Josh Allen', subtitle: 'Buffalo Bills', sport: 'football', defaultLeagueSlug: 'nfl'},
    {uid: 's:20~l:23~a:4892153', displayName: 'Josh Allen', subtitle: 'Claremont Stags', sport: 'football', defaultLeagueSlug: 'college-football'},
    {uid: 's:600~a:301389', displayName: 'Josh Allen', subtitle: 'Yate Town', sport: 'soccer', defaultLeagueSlug: 'club.friendly'},
    {uid: 's:1100~a:8314', displayName: 'Some Golfer', sport: 'golf', defaultLeagueSlug: 'lpga'},
    {uid: 's:850~l:851~a:3782', displayName: 'Carlos Alcaraz', sport: 'tennis', defaultLeagueSlug: 'atp'},
    {uid: 'no-id', displayName: 'Broken', sport: 'basketball', defaultLeagueSlug: 'nba'},
  ]},
]};

test('search keeps researchable leagues only, dedupes, and returns identity without stats', () => {
  const players = playersFromSearch(searchPayload);
  assert.deepEqual(players, [
    {id: '3918298', name: 'Josh Allen', sport: 'NFL', league: 'nfl', team: 'Buffalo Bills'},
    {id: '4892153', name: 'Josh Allen', sport: 'NCAAF', league: 'college-football', team: 'Claremont Stags'},
    {id: '301389', name: 'Josh Allen', sport: 'SOCCER', league: 'club.friendly', team: 'Yate Town'},
    {id: '3782', name: 'Carlos Alcaraz', sport: 'TENNIS', league: 'atp', team: null},
  ]);
  assert.equal(sportForLeague('lpga', 'golf'), null);
  assert.equal(sportForLeague('eng.1', 'soccer'), 'EPL');
});

test('queries are cleaned and short ones never reach ESPN', async () => {
  assert.equal(cleanQuery('  <script>Luka  Dončić '), 'script Luka Dončić');
  assert.equal(cleanQuery('a'), '');
  let calls = 0;
  const dir = createPlayerDirectory({fetchImpl: async () => { calls++; return {ok: true, json: async () => searchPayload}; }});
  assert.equal((await dir.search('j')).code, 'QUERY_TOO_SHORT');
  assert.equal(calls, 0);
  await Promise.all([dir.search('Josh Allen'), dir.search('josh allen')]);
  await dir.search('JOSH ALLEN');
  assert.equal(calls, 1, 'one upstream call per query, shared and cached');
});

test('an upstream failure is reported, not turned into an empty "no players" answer', async () => {
  const dir = createPlayerDirectory({fetchImpl: async () => ({ok: false, status: 503})});
  const r = await dir.search('Josh Allen');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'PLAYER_SEARCH_UNAVAILABLE');
});

const overview = {nextGame: {league: {events: [{
  id: '401872953', date: '2026-09-27T17:00:00.000+00:00', fullStatus: {type: {state: 'pre'}},
  competitors: [{homeAway: 'home', abbreviation: 'BUF'}, {homeAway: 'away', abbreviation: 'LAC'}],
}]}}};

test('next game reads both teams and home/away exactly as published', () => {
  assert.deepEqual(nextGameFrom(overview, 'BUF'), {eventId: '401872953', startsAt: '2026-09-27T17:00:00.000Z', status: 'pre', homeTeam: 'BUF', awayTeam: 'LAC', opponent: 'LAC', isHome: true});
  // A team that is in neither slot gets no opponent and no home/away guess.
  const unknown = nextGameFrom(overview, 'NYJ');
  assert.equal(unknown.opponent, null);
  assert.equal(unknown.isHome, null);
  assert.equal(nextGameFrom({}, 'BUF'), null);
});

test('profile validates the id, reads position and team, and refuses a different athlete', async () => {
  const urls = [];
  const fetchImpl = async url => {
    urls.push(url);
    if (url.endsWith('/overview')) return {ok: true, json: async () => overview};
    return {ok: true, json: async () => ({athlete: {id: '3918298', displayName: 'Josh Allen', position: {abbreviation: 'QB'}, team: {abbreviation: 'BUF', displayName: 'Buffalo Bills'}}})};
  };
  const dir = createPlayerDirectory({fetchImpl});
  assert.equal((await dir.profile('NFL', '12ab')).code, 'PROFILE_UNSUPPORTED');
  assert.equal((await dir.profile('TENNIS', '3782')).code, 'PROFILE_UNSUPPORTED');
  assert.equal(urls.length, 0);
  const r = await dir.profile('NFL', '3918298');
  assert.equal(r.available, true);
  assert.deepEqual(r.player, {id: '3918298', sport: 'NFL', name: 'Josh Allen', position: 'QB', team: 'BUF', teamName: 'Buffalo Bills', active: true});
  assert.equal(r.nextGame.opponent, 'LAC');
  assert.ok(urls.every(u => u.startsWith('https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/3918298')));
  const other = createPlayerDirectory({fetchImpl: async () => ({ok: true, json: async () => ({athlete: {id: '1', displayName: 'Someone Else'}})})});
  assert.equal((await other.profile('NFL', '3918298')).code, 'PLAYER_NOT_FOUND');
});

test('search and profile routes require an account and share the research rate budget', () => {
  assert.equal(gatedApi('/api/apex/research-players'), true);
  assert.equal(gatedApi('/api/apex/research-player'), true);
  const source = readFileSync(new URL('../frontdoor-prod.mjs', import.meta.url), 'utf8');
  const handler = source.slice(source.indexOf('async function maybeServePlayerDirectory'), source.indexOf('async function maybeServeResearchBatch'));
  assert.match(handler, /researchRateAllowed\(req\)/);
  assert.match(source, /if \(await maybeServePlayerDirectory\(req, res\)\) return;/);
});
