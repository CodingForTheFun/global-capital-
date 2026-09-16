// PropLine is the first choice for player game history, with ESPN behind it.
//
// Swapping the primary source for the drawer's hit rates is the one change in
// this integration that can make the product worse rather than better: a name
// lookup that lands on the wrong player, or a market PropLine does not grade,
// would answer with numbers that look measured and are not.
//
// These tests pin the guards rather than the happy path alone - every way the
// adapter can be wrong must end in "unavailable" so the existing ESPN chain
// still runs, never in a confident wrong answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fetchProplineResearch } from '../lib/data-sources/propline/research.mjs';

const originalKey = process.env.PROPLINE_API_KEY;
const originalFetch = globalThis.fetch;

function quotaHeaders() {
  return {
    'content-type': 'application/json',
    'x-daily-limit': '250000',
    'x-daily-used': '1',
    'x-daily-remaining': '249999',
    'x-daily-reset': String(Math.floor(Date.now() / 1000) + 3600),
  };
}

// Distinct names per test: the client caches game logs for six hours, so two
// tests sharing a player would share a response.
function stubGames(games, { playerName } = {}) {
  process.env.PROPLINE_API_KEY = 'test-key';
  globalThis.fetch = async () => new Response(
    JSON.stringify({ player_name: playerName, games }),
    { status: 200, headers: quotaHeaders() },
  );
}

function game(overrides = {}) {
  return {
    event_id: `evt-${Math.random().toString(16).slice(2)}`,
    commence_time: '2026-03-01T00:00:00Z',
    player_team: 'BOS',
    opponent: 'NYK',
    is_home: true,
    home_team: 'Boston', away_team: 'New York',
    home_score: 110, away_score: 104,
    stats: { points: 28, rebounds: 8 },
    ...overrides,
  };
}

function season(count, playerTeam = 'BOS') {
  return Array.from({ length: count }, (_, i) => game({
    event_id: `evt-${i}`,
    commence_time: new Date(Date.UTC(2026, 2, i + 1)).toISOString(),
    player_team: playerTeam,
    stats: { points: 20 + i, rebounds: 5 },
  }));
}

function restore() {
  if (originalKey === undefined) delete process.env.PROPLINE_API_KEY;
  else process.env.PROPLINE_API_KEY = originalKey;
  globalThis.fetch = originalFetch;
}

test('an unconfigured key is no opinion, not an empty answer', async (t) => {
  t.after(restore);
  delete process.env.PROPLINE_API_KEY;
  assert.equal(await fetchProplineResearch({ sport: 'NBA', playerName: 'A Player', providerMarketKey: 'player_points' }), null,
    'null lets the caller fall through; an unavailable result would look like a checked miss');
});

test('a sport PropLine does not carry is declined before any request', async (t) => {
  t.after(restore);
  process.env.PROPLINE_API_KEY = 'test-key';
  let called = 0;
  globalThis.fetch = async () => { called += 1; throw new Error('should not fetch'); };
  assert.equal(await fetchProplineResearch({ sport: 'NOTASPORT', playerName: 'A Player', providerMarketKey: 'player_points' }), null);
  assert.equal(called, 0, 'an unmapped sport must not spend a request');
});

test('graded games become a game log keyed to the market asked for', async (t) => {
  t.after(restore);
  stubGames(season(10), { playerName: 'Full Sample' });
  const result = await fetchProplineResearch({
    sport: 'NBA', playerName: 'Full Sample', team: 'BOS',
    providerMarketKey: 'player_points', opponent: 'NYK',
  });
  assert.equal(result.available, true);
  assert.equal(result.gameLog.length, 10);
  assert.equal(result.statKind, 'player_points');
  assert.equal(result.gameLog[0].value, 29, 'newest game first, valued on the requested market');
  assert.equal(result.gameLog[0].scoreFor, 110, 'home rows score from the home column');
  assert.equal(result.gameLog[0].gameResult, 'W');
  assert.equal(result.coverage.gradedGames, 10);
});

test('an ungraded market defers instead of returning zeroes', async (t) => {
  t.after(restore);
  stubGames(season(10), { playerName: 'No Such Market' });
  const result = await fetchProplineResearch({
    sport: 'NBA', playerName: 'No Such Market', providerMarketKey: 'player_blocks',
  });
  assert.equal(result.available, false);
  assert.equal(result.code, 'PROPLINE_MARKET_NOT_GRADED', 'a missing stat key is not a zero');
});

test('a different player name is refused', async (t) => {
  t.after(restore);
  stubGames(season(10), { playerName: 'Somebody Else' });
  const result = await fetchProplineResearch({
    sport: 'NBA', playerName: 'Asked For', providerMarketKey: 'player_points',
  });
  assert.equal(result.available, false);
  assert.equal(result.code, 'PROPLINE_PLAYER_MISMATCH');
});

test('suffix and punctuation differences are the same player', async (t) => {
  t.after(restore);
  stubGames(season(8), { playerName: 'Ronald Acuna Jr.' });
  const result = await fetchProplineResearch({
    sport: 'NBA', playerName: 'Ronald Acuña', providerMarketKey: 'player_points',
  });
  assert.equal(result.available, true, 'accents and a Jr. suffix must not reject the right player');
});

test('a sample belonging mostly to another team is refused', async (t) => {
  t.after(restore);
  stubGames(season(9, 'LAL'), { playerName: 'Wrong Team' });
  const result = await fetchProplineResearch({
    sport: 'NBA', playerName: 'Wrong Team', team: 'BOS', providerMarketKey: 'player_points',
  });
  assert.equal(result.available, false);
  assert.equal(result.code, 'PROPLINE_PLAYER_MISMATCH');
});

test('too few graded games defers to the fuller source', async (t) => {
  t.after(restore);
  stubGames(season(3), { playerName: 'Thin Sample' });
  const result = await fetchProplineResearch({
    sport: 'NBA', playerName: 'Thin Sample', providerMarketKey: 'player_points',
  });
  assert.equal(result.available, false);
  assert.equal(result.code, 'PROPLINE_THIN_HISTORY', 'a hit rate over three games is noise');
});

test('a transport failure is an unavailable result, never a throw', async (t) => {
  t.after(restore);
  process.env.PROPLINE_API_KEY = 'test-key';
  globalThis.fetch = async () => { throw new Error('network down'); };
  const result = await fetchProplineResearch({
    sport: 'NBA', playerName: 'Network Down', providerMarketKey: 'player_points',
  });
  assert.equal(result.available, false, 'the drawer must survive PropLine being down');
});

test('ids carry no vendor name the public sanitizer would not strip', async (t) => {
  t.after(restore);
  stubGames(season(7), { playerName: 'Neutral Ids' });
  const result = await fetchProplineResearch({
    sport: 'NBA', playerName: 'Neutral Ids', providerMarketKey: 'player_points',
  });
  const ids = [result.player.providerPlayerId, ...result.gameLog.map((row) => row.gameId)];
  for (const value of ids) {
    assert.ok(!/prop[\s-]*line/i.test(value), `id leaks a vendor name: ${value}`);
  }
});

// The adapter is only half the change. What makes PropLine primary is where it
// sits in the chain, and that ordering is invisible to a unit test of either
// module on its own - so pin it on the source.
test('the research chain asks PropLine before ESPN', async () => {
  const source = await readFile(new URL('../lib/autoscout/research-service-v2.mjs', import.meta.url), 'utf8');
  const propline = source.indexOf('await proplineHistory(params)');
  const espn = source.indexOf('PUBLIC_LEAGUES[String(params.sport');
  const clearSports = source.indexOf('fetchClearSportsResearch(');
  assert.ok(propline > 0, 'the chain no longer calls PropLine');
  assert.ok(espn > 0 && clearSports > 0, 'the backup sources are gone');
  assert.ok(propline < espn, 'ESPN is being asked before PropLine');
  assert.ok(propline < clearSports, 'ClearSports is being asked before PropLine');
});

test('the line-only policy still runs ahead of every source', async () => {
  const source = await readFile(new URL('../lib/autoscout/research-service-v2.mjs', import.meta.url), 'utf8');
  assert.ok(source.indexOf('lineOnlyResearch(params)') < source.indexOf('await proplineHistory(params)'),
    'PropLine must not answer a market the fail-closed policy refuses to research');
});

test('the source order can be reverted from the environment', async () => {
  const source = await readFile(new URL('../lib/autoscout/research-service-v2.mjs', import.meta.url), 'utf8');
  assert.match(source, /PROPLINE_RESEARCH_PRIMARY/, 'there is no kill switch for the swap');
});
