import test from 'node:test';
import assert from 'node:assert/strict';
import { historyRowsFromResearch } from '../lib/ingestion/game-log-persistence.mjs';

const now = Date.parse('2026-09-13T18:00:00Z');

function game(overrides = {}) {
  return {
    gameId: '401000001',
    date: '2026-09-10T00:00:00Z',
    season: 2026,
    seasonType: 2,
    value: 31,
    opponent: 'NYK',
    team: 'BOS',
    ...overrides,
  };
}

test('NBA verified logs persist under stable ESPN history identity and general category', () => {
  const rows = historyRowsFromResearch({
    available: true,
    player: { name: 'Fixture Guard', providerPlayerId: 'history:NBA:12345' },
    gameLog: [game()],
  }, { sport: 'NBA', market: 'Points' }, { now: () => now });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].player_id, 'history:NBA:12345');
  assert.equal(rows[0].category, 'general');
  assert.equal(rows[0].season_type, '2');
  assert.equal(rows[0].stats.value, 31);
});

test('MLB pitcher logs persist in pitching category', () => {
  const rows = historyRowsFromResearch({
    available: true,
    player: { name: 'Fixture Pitcher', providerPlayerId: 'history:MLB:67890' },
    gameLog: [game({ value: 7, seasonType: '2' })],
  }, { sport: 'MLB', market: 'Pitching Outs', providerMarketKey: 'pitcher_outs' }, { now: () => now });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].category, 'pitching');
  assert.equal(rows[0].sport, 'MLB');
});

test('invalid identity, future games and postseason values outside 2/3 fail closed', () => {
  const base = { available: true, player: { name: 'Fixture Guard', providerPlayerId: 'history:NBA:not-numeric' }, gameLog: [game()] };
  assert.deepEqual(historyRowsFromResearch(base, { sport: 'NBA', market: 'Points' }, { now: () => now }), []);

  const valid = { ...base, player: { ...base.player, providerPlayerId: 'history:NBA:12345' } };
  assert.deepEqual(historyRowsFromResearch({ ...valid, gameLog: [game({ date: '2026-09-14T00:00:00Z' })] }, { sport: 'NBA', market: 'Points' }, { now: () => now }), []);
  assert.deepEqual(historyRowsFromResearch({ ...valid, gameLog: [game({ seasonType: 1 })] }, { sport: 'NBA', market: 'Points' }, { now: () => now }), []);
});

test('duplicate ESPN game ids are written once', () => {
  const rows = historyRowsFromResearch({
    available: true,
    player: { name: 'Fixture Guard', providerPlayerId: 'history:NBA:12345' },
    gameLog: [game(), game({ value: 29 })],
  }, { sport: 'NBA', market: 'Points' }, { now: () => now });
  assert.equal(rows.length, 1);
});
