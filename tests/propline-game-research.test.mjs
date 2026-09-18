import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchPropLineGameResearch, normalizeGameArchive, rawStatFor, PROPLINE_GAME_SPORTS } from '../lib/data-sources/propline/game-research.mjs';
import { __resetProplineClient } from '../lib/data-sources/propline/client.mjs';
import { researchPlayerProp } from '../lib/autoscout/research-service-v2.mjs';
const NOW = Date.parse('2026-09-18T23:00:00Z');
const target = { sport: 'TENNIS', playerName: 'Regression Tennis', market: 'Total Games', providerMarketKey: 'total_games', line: 22.5, side: 'OVER', games: 20 };
const row = (id, value, extra = {}) => ({ event_id: id, commence_time: '2026-09-17T12:00:00Z', status: 'final', stats: { total_games: value }, ...extra });
const payload = (games, extra = {}) => ({ player_name: target.playerName, sport_key: 'tennis', games, ...extra });

for (const [sport, market, stat] of [
  ['NFL', 'player_pass_yds', 'passing_yards'], ['NCAAF', 'player_receptions', 'receptions'],
  ['NBA', 'player_points', 'points'], ['WNBA', 'player_points_rebounds_assists', 'points_rebounds_assists'],
  ['NCAAB', 'player_assists', 'assists'], ['MLB', 'batter_hits', 'hits'], ['NHL', 'player_shots_on_goal', 'shots_on_goal'],
  ['TENNIS', 'total_games', 'total_games'], ['TENNIS', 'player_sets_won', 'sets_won'],
  ['MLS', 'player_shots_on_target', 'shots_on_target'], ['EPL', 'player_assists', 'assists'],
  ['UCL', 'player_goals', 'goals'], ['PGA', 'player_birdies', 'birdies'],
  ['MMA', 'player_takedowns', 'takedowns'], ['CS2', 'kills_maps_1_2', 'kills_maps_1_2'],
]) test(`${sport} maps ${market} to its exact raw statistic`, () => {
  const params = { ...target, sport, market, providerMarketKey: market };
  assert.equal(rawStatFor(params), stat);
  const data = normalizeGameArchive({ player_name: target.playerName, sport_key: PROPLINE_GAME_SPORTS[sport], games: [row('event', 0, { stats: { [stat]: 7 } })] }, params, NOW);
  assert.equal(data.available, true);
  assert.equal(data.gameLog[0].value, 7);
  assert.equal(data.coverage.complete, false);
});
test('missing, redacted, DNP, in-progress, future and wrong-player rows are not zeroes', () => {
  const data = normalizeGameArchive(payload([
    row('zero', 0), row('missing', null), row('empty', ''), row('bool', false), row('nan', 'unknown'),
    row('live', 30, { status: 'in_progress' }), row('future', 30, { commence_time: '2027-01-01' }),
    row('dnp', 0, { did_not_play: true }), row('redacted', 30, { redacted: true }), row('other', 30, { player_name: 'Different Player' }),
  ]), target, NOW);
  assert.deepEqual(data.gameLog.map(game => [game.gameId, game.value]), [['zero', 0]]);
  assert.equal(data.gameLog[0].isHome, null);
  assert.equal(data.gameLog[0].opponent, null);
});
test('wrong names, suffixes, sport and conflicting stable IDs fail closed', () => {
  for (const change of [{ player_name: 'Another Player' }, { player_name: 'Regression Tennis Jr.' }, { sport_key: 'basketball_wnba' }, { redacted: true }]) {
    assert.equal(normalizeGameArchive(payload([row('a', 21)], change), target, NOW).available, false);
  }
  assert.equal(normalizeGameArchive(payload([row('a', 21)], { player_id: 'other' }), { ...target, providerPlayerId: 'expected' }, NOW).available, false);
});
test('identical events deduplicate; conflicting values discard the event', () => {
  assert.equal(normalizeGameArchive(payload([row('a', 21), row('a', 21)]), target, NOW).gameLog.length, 1);
  const data = normalizeGameArchive(payload([row('a', 21), row('a', 22), row('b', 24)]), target, NOW);
  assert.deepEqual(data.gameLog.map(game => game.gameId), ['b']);
});
test('periods, unknown stats, combo and fantasy cannot become full-game histories', () => {
  for (const change of [
    { sport: 'WNBA', market: '1st Quarter Points', providerMarketKey: 'player_points' },
    { sport: 'WNBA', market: 'Points', providerMarketKey: 'player_points_q1' },
    { period: 'q1' }, { market: 'Fantasy Score' }, { playerName: 'Player One + Player Two' },
    { providerMarketKey: 'unmapped_market' }, { sport: 'SOCCER' },
  ]) assert.equal(rawStatFor({ ...target, ...change }), null);
});
test('posted event and games beyond selected event are excluded', () => {
  const data = normalizeGameArchive(payload([row('current', 20), row('earlier', 21, { commence_time: '2026-09-15' }), row('later', 22, { commence_time: '2026-09-17T13:00:00Z' })]), { ...target, eventId: 'current', gameStartTime: '2026-09-17T12:30:00Z' }, NOW);
  assert.deepEqual(data.gameLog.map(game => game.gameId), ['earlier']);
});
test('one bounded raw endpoint request, never history/trends or a forced refresh', async () => {
  const calls = [];
  const get = async (...args) => { calls.push(args); return payload([row('a', 24)]); };
  const data = await fetchPropLineGameResearch(target, { get, configured: () => true, now: () => NOW });
  assert.equal(data.available, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /\/players\/Regression%20Tennis\/games$/);
  assert.deepEqual(calls[0][1], { limit: 40 });
  assert.equal(calls[0][2].ttlSeconds, 900);
  assert.equal(calls[0][2].bypassCache, undefined);
});
test('unconfigured/unsupported targets do not call a provider; outages remain retryable', async () => {
  let calls = 0;
  const get = async () => { calls++; throw new Error('test outage'); };
  assert.equal(await fetchPropLineGameResearch(target, { get, configured: () => false }), null);
  await fetchPropLineGameResearch({ ...target, providerMarketKey: 'unknown' }, { get, configured: () => true });
  assert.equal(calls, 0);
  const failed = await fetchPropLineGameResearch(target, { get, configured: () => true });
  assert.equal(failed.available, false);
  assert.equal(failed.retryable, true);
  assert.deepEqual(failed.gameLog, []);
});
test('actual research service reaches tennis raw logs and reuses archive across lines', async () => {
  const oldKey = process.env.PROPLINE_API_KEY, oldFetch = globalThis.fetch;
  process.env.PROPLINE_API_KEY = 'fixture-only-not-a-real-key';
  __resetProplineClient();
  let calls = 0;
  const values = [21, 24, 22, 27, 20];
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    assert.equal(url.hostname, 'api.prop-line.com');
    assert.ok(url.pathname.endsWith('/games'));
    calls++;
    return new Response(JSON.stringify(payload(values.map((value, index) => row(`game-${index}`, value, { commence_time: `2026-09-${17 - index}T12:00:00Z` })))), { status: 200, headers: { 'content-type': 'application/json', 'x-daily-limit': '250000', 'x-daily-remaining': '240000' } });
  };
  try {
    const first = await researchPlayerProp(target);
    assert.equal(first.available, true);
    assert.deepEqual(first.gameLog.map(game => game.value), values);
    assert.equal(first.source, 'PropLine raw game archive');
    const second = await researchPlayerProp({ ...target, line: 23.5, side: 'UNDER' });
    assert.equal(second.available, true);
    assert.deepEqual(second.gameLog.map(game => game.value), values);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.PROPLINE_API_KEY; else process.env.PROPLINE_API_KEY = oldKey;
    __resetProplineClient();
  }
});
