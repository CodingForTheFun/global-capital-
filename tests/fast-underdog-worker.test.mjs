import assert from 'node:assert/strict';
import test from 'node:test';
import { createFastUnderdogRunner } from '../lib/ingestion/fast-underdog-worker.mjs';

const payload = {
  over_under_lines: [{
    id: 'line-1',
    appearance_stat: { id: 'as-1', stat: 'Passing Yards' },
    over_under: { id: 'ou-1', title: 'Test Quarterback Passing Yards' },
    stat_value: 249.5,
    status: 'active',
    options: [{ choice: 'higher', payout_multiplier: 1 }, { choice: 'lower', payout_multiplier: 1 }],
  }],
  appearances: [{ id: 'as-1', player_id: 'p1', match_id: 'g1' }],
  players: [{ id: 'p1', first_name: 'Test', last_name: 'Quarterback', team_id: 'DAL', position_id: 'QB' }],
  games: [{ id: 'g1', scheduled_at: '2030-09-14T00:20:00Z', home_team_id: 'DAL', away_team_id: 'NYG', sport_id: 'NFL' }],
};

test('fast Underdog worker persists only its fresh regular rows at zero credit cost', async () => {
  const persisted = [];
  const statuses = [];
  const run = createFastUnderdogRunner({
    now: () => Date.parse('2026-09-13T21:00:00Z'),
    fetchPayload: async () => payload,
    persistSnapshot: async (source, rows, observedAt) => {
      persisted.push({ source, rows, observedAt });
      return { written: rows.length };
    },
    recordStatus: async (source, state) => { statuses.push({ source, state }); },
  });

  const result = await run();
  assert.equal(result.persisted, true);
  assert.equal(result.creditsCost, 0);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].source, 'underdog');
  assert.ok(persisted[0].rows.length >= 1);
  assert.ok(persisted[0].rows.every((row) => row.sportsbookKey === 'underdog' && row.isAlternate === false));
  assert.equal(statuses.at(-1).state.status, 'available');
});

test('fast Underdog worker retains last-good data on failure', async () => {
  const statuses = [];
  const run = createFastUnderdogRunner({
    fetchPayload: async () => { throw Object.assign(new Error('blocked'), { code: 'UNDERDOG_HTTP', status: 403 }); },
    persistSnapshot: async () => { throw new Error('must not persist'); },
    recordStatus: async (source, state) => { statuses.push({ source, state }); },
  });

  const result = await run();
  assert.equal(result.persisted, false);
  assert.equal(result.retained, true);
  assert.equal(result.httpStatus, 403);
  assert.equal(statuses.at(-1).state.retained, true);
});
