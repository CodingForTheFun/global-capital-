// Soccer arrives from the DFS feeds under a bare "SOCCER" tag: no competition,
// no opponent, and a club name shortened to whatever fits a card. Every one of
// those quotes read "Unavailable" because the research path had no league slug
// to build a URL from. These pin the three things that changed to fix it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPublicResearch, normalizePublicGameLog, inspectGameLog } from '../lib/data-sources/espn/research.mjs';
import { marketContract, PUBLIC_LEAGUES, LEAGUE_AGNOSTIC } from '../lib/data-sources/espn/stat-contract.mjs';
import { sameClub, matchesClubRecord } from '../lib/data-sources/espn/identity.mjs';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/espn-${name}.json`, import.meta.url)));
const outfield = () => fixture('soccer-gamelog');
const keeper = () => fixture('soccer-keeper-gamelog');

test('a soccer prop that names no competition still has a contract and a family', () => {
  assert.equal(PUBLIC_LEAGUES.SOCCER[0], 'soccer');
  assert.equal(PUBLIC_LEAGUES.SOCCER[1], null, 'there is no league slug to invent');
  assert.ok(LEAGUE_AGNOSTIC.has('SOCCER'));
  assert.deepEqual(marketContract({ sport: 'SOCCER', market: 'Shots', providerMarketKey: 'player_shots' })?.fields, ['Shots']);
});

// ESPN heads a domestic season with the competition's own name. "Torneo
// Apertura" matches no phrase any allowlist could hold, and every Liga MX,
// LaLiga and Serie A log was discarded on that alone.
test('a season named after its own competition is still a regular season', () => {
  const log = outfield();
  assert.deepEqual(log.seasonTypes.map(s => s.displayName), ['Torneo Apertura']);
  const rows = normalizePublicGameLog(log, { sport: 'SOCCER', market: 'Shots', providerMarketKey: 'player_shots' });
  assert.ok(rows.length > 0, 'the log must survive its own heading');
  for (const row of rows) assert.equal(row.seasonType, 2);
  assert.deepEqual(normalizePublicGameLog(log, { sport: 'EPL', market: 'Shots', providerMarketKey: 'player_shots' }), [],
    'a prop that did name its competition is still held to it');
});

test('the shot count read back is the one in the log, per game', () => {
  const log = outfield(), shots = log.names.indexOf('totalShots');
  const stats = log.seasonTypes[0].categories[0].events.map(e => Number(e.stats[shots]));
  const rows = normalizePublicGameLog(log, { sport: 'SOCCER', market: 'Shots', providerMarketKey: 'player_shots' });
  assert.deepEqual(rows.map(r => r.value).sort(), stats.slice(0, rows.length).sort());
  assert.ok(rows.every(r => r.opponent && r.gameId.startsWith('soccer:')));
});

test('a keeper log answers saves off its own column set', () => {
  const rows = normalizePublicGameLog(keeper(), { sport: 'SOCCER', market: 'Goalie Saves', providerMarketKey: 'player_goalie_saves' });
  assert.ok(rows.length > 0);
  const saves = keeper().names.indexOf('saves');
  assert.equal(rows[0].value, Number(keeper().seasonTypes[0].categories[0].events.find(e => `soccer:${e.eventId}` === rows[0].gameId).stats[saves]));
});

// A hit rate is only meaningful over one competition. With no league parameter
// to send, the competition the log came back on is read off the events.
test('a competition the rest of the log does not share is counted foreign', () => {
  const log = outfield();
  const events = Object.values(log.events);
  events[0].leagueAbbreviation = 'Copa MX';
  const result = inspectGameLog(log, { sport: 'SOCCER', market: 'Shots', providerMarketKey: 'player_shots' });
  assert.equal(result.foreignLeagueEvents, 1);
  assert.equal(result.complete, false);
  assert.ok(!result.rows.some(r => r.gameId === `soccer:${events[0].id}`));
});

test('a log with no competition at all yields nothing rather than everything', () => {
  const log = outfield();
  for (const event of Object.values(log.events)) delete event.leagueAbbreviation;
  assert.deepEqual(normalizePublicGameLog(log, { sport: 'SOCCER', market: 'Shots', providerMarketKey: 'player_shots' }), []);
});

test('the short club name a card shows matches the registered one ESPN carries', () => {
  for (const [feed, espn] of [['Bristol C', 'Bristol City'], ['San Luis', 'Atlético de San Luis'],
    ['Rayo', 'Rayo Vallecano'], ['Lincoln', 'Lincoln City'], ['Inter', 'Internazionale'], ['Betis', 'Real Betis']]) {
    assert.ok(sameClub(feed, espn), `${feed} is ${espn}`);
  }
  assert.ok(matchesClubRecord('Bristol C', { displayName: 'Bristol City', abbreviation: 'BRC' }));
  assert.ok(!sameClub('Rayo', 'Real Madrid'));
  assert.ok(!sameClub('', 'Bristol City'));
  // Too short to mean anything on its own.
  assert.ok(!sameClub('FC', 'Bristol City'));
});

test('a generic soccer lookup sends no league and asks no scoreboard for one', async () => {
  const seen = [];
  const fetcher = createPublicResearch({ fetchImpl: async url => {
    seen.push(url);
    if (url.includes('/search/')) return new Response(JSON.stringify(fixture('soccer-keeper-search')));
    if (url.includes('/gamelog')) return new Response(JSON.stringify(keeper()));
    return new Response('{}', { status: 404 });
  } });
  const result = await fetcher({ sport: 'SOCCER', playerName: 'Sam Tickle', market: 'Goalie Saves',
    providerMarketKey: 'player_goalie_saves', line: 2.5, side: 'OVER', team: 'Bristol C', games: 20 });
  assert.equal(result.available, true, result.code);
  assert.ok(result.gameLog.length > 0);
  assert.ok(seen.some(u => u.includes('/gamelog')));
  assert.ok(!seen.some(u => u.includes('league=')), 'there is no competition to filter on');
  assert.ok(!seen.some(u => u.includes('/scoreboard')), 'and no league scoreboard to read a season off');
  assert.ok(!seen.some(u => u.includes('null')), 'a missing league slug must never reach a URL');
});

// This is the case that made every English and Mexican keeper unresolvable.
test('a club the feed abbreviated is not a team mismatch', async () => {
  const fetcher = createPublicResearch({ fetchImpl: async url =>
    new Response(JSON.stringify(url.includes('/search/') ? fixture('soccer-keeper-search') : keeper())) });
  const result = await fetcher({ sport: 'SOCCER', playerName: 'Sam Tickle', market: 'Goalie Saves',
    providerMarketKey: 'player_goalie_saves', line: 2.5, side: 'OVER', team: 'Bristol C', games: 20 });
  assert.equal(result.code, undefined);
  assert.equal(result.available, true);
});

test('a club that is a different club is still a mismatch', async () => {
  const fetcher = createPublicResearch({ fetchImpl: async url =>
    new Response(JSON.stringify(url.includes('/search/') ? fixture('soccer-keeper-search') : keeper())) });
  const result = await fetcher({ sport: 'SOCCER', playerName: 'Sam Tickle', market: 'Goalie Saves',
    providerMarketKey: 'player_goalie_saves', line: 2.5, side: 'OVER', team: 'Millwall', games: 20 });
  assert.equal(result.available, false);
  assert.equal(result.code, 'PLAYER_TEAM_MISMATCH');
});

// Spending three round trips to discover an emptiness that was knowable from
// the column list is how a board ends up slow and grey at the same time.
test('a market no soccer log reports costs no requests at all', async () => {
  let calls = 0;
  const fetcher = createPublicResearch({ fetchImpl: async () => { calls++; return new Response('{}'); } });
  for (const [market, key] of [['Passes Attempted', 'player_passes_attempted'], ['Clearances', 'player_clearances'],
    ['Attempted Dribbles', 'player_attempted_dribbles'], ['Outfield Fantasy Score', 'player_outfield_fantasy_score']]) {
    const result = await fetcher({ sport: 'SOCCER', playerName: 'Díber Cambindo', market, providerMarketKey: key,
      line: 1.5, side: 'OVER', team: 'León', games: 20 });
    assert.equal(result.available, false);
    assert.equal(result.code, 'UNSUPPORTED_MARKET', market);
  }
  assert.equal(calls, 0);
});
