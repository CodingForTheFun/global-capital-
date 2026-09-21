import test from 'node:test';
import assert from 'node:assert/strict';

import {
  __resetSportradarTrialProducts,
  probeSportradarTrialProduct,
} from '../lib/data-sources/sportradar/trial-products.mjs';
import {
  fetchSportradarResearchContext,
  fetchSportradarTeamDirectory,
} from '../lib/data-sources/sportradar/research-context.mjs';

test('Sportradar research context is gated by a successful product probe', async () => {
  const oldKey = process.env.SPORTRADAR_API_KEY;
  const oldFetch = globalThis.fetch;
  const calls = [];
  try {
    process.env.SPORTRADAR_API_KEY = 'test-only-key';
    __resetSportradarTrialProducts();

    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      calls.push(url.pathname);
      assert.equal(init.headers?.['x-api-key'], 'test-only-key');

      if (url.pathname.endsWith('/league/hierarchy.json')) {
        return new Response(JSON.stringify({
          league: { id: 'league', name: 'NBA', alias: 'NBA' },
          conferences: [{
            id: 'east',
            name: 'Eastern',
            divisions: [{
              id: 'd1',
              name: 'Atlantic',
              teams: [{ id: 'team-1', name: 'Lakers', market: 'Los Angeles', alias: 'LAL' }],
            }],
          }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url.pathname.endsWith('/teams/team-1/profile.json')) {
        return new Response(JSON.stringify({
          id: 'team-1',
          name: 'Lakers',
          market: 'Los Angeles',
          alias: 'LAL',
          players: [{
            id: 'player-1',
            full_name: 'Test Player',
            position: 'G',
            jersey_number: '7',
            status: 'ACT',
          }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url.pathname.endsWith('/league/injuries.json')) {
        return new Response(JSON.stringify({
          teams: [{
            id: 'team-1',
            players: [{
              id: 'player-1',
              full_name: 'Test Player',
              injuries: [{ status: 'Out', desc: 'Ankle', estimated_return_date: '2026-10-01' }],
            }],
          }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
    };

    assert.deepEqual(await fetchSportradarTeamDirectory('NBA'), []);
    const probe = await probeSportradarTrialProduct('nba');
    assert.equal(probe.available, true);

    const teams = await fetchSportradarTeamDirectory('NBA');
    assert.equal(teams.length, 1);
    assert.equal(teams[0].abbreviation, 'LAL');

    const context = await fetchSportradarResearchContext({
      sport: 'NBA',
      playerName: 'Test Player',
      team: 'LAL',
    });
    assert.equal(context.playerMatched, true);
    assert.equal(context.providerPlayerId, 'player-1');
    assert.equal(context.position, 'G');
    assert.equal(context.injury.status, 'Out');
    assert.equal(context.injury.description, 'Ankle');
    assert.equal(context.injury.estimatedReturnDate, '2026-10-01');

    assert.ok(calls.some((path) => path.endsWith('/league/hierarchy.json')));
    assert.ok(calls.some((path) => path.endsWith('/teams/team-1/profile.json')));
    assert.ok(calls.some((path) => path.endsWith('/league/injuries.json')));
  } finally {
    globalThis.fetch = oldFetch;
    __resetSportradarTrialProducts();
    if (oldKey === undefined) delete process.env.SPORTRADAR_API_KEY;
    else process.env.SPORTRADAR_API_KEY = oldKey;
  }
});
