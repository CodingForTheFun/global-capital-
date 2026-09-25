import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeMovement, fetchPropMovement, movementKey, MAX_MOVEMENT_EVENTS } from '../lib/data-sources/propline/movement.mjs';

const outcome = (name, description, open, latest) => ({ name, description, open_point: open, latest_point: latest, open_price: -110, latest_price: -115 });
const payload = {
  id: 1, sport_key: 'basketball_nba',
  bookmakers: [
    { key: 'draftkings', markets: [{ key: 'player_points', outcomes: [outcome('Over', 'Jalen Brunson', 25.5, 26.5), outcome('Under', 'Jalen Brunson', 25.5, 26.5)] }] },
    { key: 'fanduel', markets: [{ key: 'player_points', outcomes: [outcome('Over', 'Jalen Brunson', 25.5, 27.5), outcome('Under', 'Jalen Brunson', 25.5, 27.5)] }] },
    { key: 'betmgm', markets: [{ key: 'player_points', period: '1st_half', outcomes: [outcome('Over', 'Jalen Brunson', 12.5, 13.5)] }] },
    { key: 'caesars', markets: [{ key: 'player_points', outcomes: [outcome('Over', '', 25.5, 26.5), outcome('Yes', 'Jalen Brunson', 1, 2), outcome('Over', 'Josh Hart', null, 8.5)] }] },
  ],
  steam: [
    { market: 'player_points', name: 'Over', description: 'Jalen Brunson', books_quoting: 8, books_moved: 5, consensus_direction: 'up', avg_prob_shift: 0.04, steam_score: 71 },
    { market: 'player_points', name: 'Over', description: 'Jalen Brunson', books_quoting: 8, books_moved: 3, consensus_direction: 'up', avg_prob_shift: 0.02, steam_score: 40 },
    { market: 'player_points', period: '1st_half', name: 'Over', description: 'Josh Hart', books_quoting: 5, books_moved: 4, consensus_direction: 'down', steam_score: 80 },
  ],
};

test('consensus opening and latest lines come from full-game two-ended quotes only', () => {
  const out = summarizeMovement(payload);
  const row = out[movementKey('player_points', 'jalen  brunson')];
  assert.deepEqual(row.over, { open: 25.5, latest: 27, books: 2 }, 'median of 26.5 and 27.5; the 1st-half book is ignored');
  assert.deepEqual(row.under, { open: 25.5, latest: 27, books: 2 });
  assert.equal(out[movementKey('player_points', 'Josh Hart')], undefined, 'a missing opening point is not guessed and period steam is ignored');
});

test('the strongest full-game steam entry is kept per player market', () => {
  const row = summarizeMovement(payload)[movementKey('player_points', 'Jalen Brunson')];
  assert.deepEqual(row.steam, { score: 71, direction: 'up', booksMoved: 5, booksQuoting: 8, side: 'OVER' });
});

test('redacted or empty payloads produce nothing', () => {
  assert.equal(summarizeMovement({ redacted: true, bookmakers: payload.bookmakers }), null);
  assert.deepEqual(Object.keys(summarizeMovement({ bookmakers: [] })), []);
});

test('fetch bounds events, rejects non-numeric ids and isolates failures', async () => {
  const calls = [];
  const get = async path => { calls.push(path); if (path.includes('/2/')) throw new Error('boom'); return payload; };
  const ids = ['1', '2', 'abc', '1', ...Array.from({ length: 20 }, (_, i) => String(100 + i))];
  const result = await fetchPropMovement({ sport: 'NBA', eventIds: ids }, { get });
  assert.equal(calls.length, MAX_MOVEMENT_EVENTS);
  assert.ok(calls.every(p => p.startsWith('/v1/sports/basketball_nba/events/') && p.endsWith('/movement')));
  assert.equal(result.events['2'].available, false);
  assert.equal(result.events['2'].retryable, true);
  assert.equal(result.events['1'].available, true);
  assert.equal(result.events.abc, undefined);
});

test('unsupported sports make no request', async () => {
  let called = false;
  const result = await fetchPropMovement({ sport: 'CURLING', eventIds: ['1'] }, { get: async () => { called = true; } });
  assert.equal(called, false);
  assert.equal(result.available, false);
});
