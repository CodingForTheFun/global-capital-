import assert from 'node:assert/strict';
import test from 'node:test';
import { createFastPrizePicksRunner } from '../lib/ingestion/fast-prizepicks-worker.mjs';

function projection(id, playerId, line) {
  return {
    type: 'projection', id,
    attributes: { stat_type: 'Passing Yards', line_score: line },
    relationships: {
      new_player: { data: { type: 'new_player', id: playerId } },
      game: { data: { type: 'game', id: 'g1' } },
      league: { data: { type: 'league', id: 'nfl' } },
    },
  };
}

const included = [
  { type: 'new_player', id: 'p1', attributes: { name: 'Test Quarterback', team: 'DAL', position: 'QB' } },
  { type: 'game', id: 'g1', attributes: { start_time: '2030-09-14T00:20:00Z', home_team: 'DAL', away_team: 'NYG' } },
  { type: 'league', id: 'nfl', attributes: { name: 'NFL' } },
];

test('fast PrizePicks worker follows pagination and persists a fresh two-sided snapshot', async () => {
  const requested = [];
  const persisted = [];
  const statuses = [];
  const run = createFastPrizePicksRunner({
    now: () => Date.parse('2026-09-13T21:00:00Z'),
    fetchJson: async (url) => {
      requested.push(url);
      if (requested.length === 1) return {
        data: [projection('r1', 'p1', 249.5)], included,
        links: { next: 'https://partner-api.prizepicks.com/projections?per_page=250&page=2' },
      };
      return { data: [projection('r2', 'p1', 250.5)], included, links: {} };
    },
    persistSnapshot: async (source, rows, observedAt) => {
      persisted.push({ source, rows, observedAt });
      return { written: rows.length };
    },
    recordStatus: async (source, state) => { statuses.push({ source, state }); },
  });

  const result = await run();
  assert.equal(requested.length, 2);
  assert.equal(result.persisted, true);
  assert.equal(result.written, 4);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].source, 'prizepicks');
  assert.equal(persisted[0].rows.length, 4);
  assert.deepEqual(new Set(persisted[0].rows.map((row) => row.side)), new Set(['OVER', 'UNDER']));
  assert.equal(statuses.at(-1).state.status, 'available');
  assert.equal(statuses.at(-1).state.creditsCost, 0);
});

test('fast PrizePicks worker fails closed and retains last-good data', async () => {
  const statuses = [];
  const run = createFastPrizePicksRunner({
    fetchJson: async () => { throw Object.assign(new Error('blocked'), { code: 'PUBLIC_HTTP2_HTTP', status: 403 }); },
    persistSnapshot: async () => { throw new Error('must not persist'); },
    recordStatus: async (source, state) => { statuses.push({ source, state }); },
  });
  const result = await run();
  assert.equal(result.persisted, false);
  assert.equal(result.retained, true);
  assert.equal(result.httpStatus, 403);
  assert.equal(statuses.at(-1).state.retained, true);
});
