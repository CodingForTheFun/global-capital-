import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicResearch } from '../lib/data-sources/espn/research.mjs';

test('public league team directory is sanitized, complete, and cached', async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    assert.match(String(url), /\/site\/v2\/sports\/football\/nfl\/teams\?limit=1000$/);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        sports: [{
          leagues: [{
            teams: [
              { team: { id: '12', abbreviation: 'KC', displayName: 'Kansas City Chiefs' } },
              { team: { id: '13', abbreviation: 'LV', displayName: 'Las Vegas Raiders' } },
              { team: { id: '14', abbreviation: 'DEN', displayName: 'Denver Broncos' } },
              { team: { id: '14', abbreviation: 'DEN', displayName: 'Denver Broncos' } },
              { team: { id: '', abbreviation: 'BAD', displayName: 'Invalid Team' } },
              { team: { id: '15', abbreviation: '', displayName: 'Missing Abbreviation' } },
            ],
          }],
        }],
      }),
    };
  };

  const research = createPublicResearch({
    fetchImpl,
    now: () => Date.parse('2026-09-19T20:00:00Z'),
  });

  assert.equal(typeof research.teams, 'function');

  const first = await research.teams('NFL');
  const second = await research.teams('NFL');

  assert.deepEqual(first, [
    { id: '14', abbreviation: 'DEN', name: 'Denver Broncos' },
    { id: '12', abbreviation: 'KC', name: 'Kansas City Chiefs' },
    { id: '13', abbreviation: 'LV', name: 'Las Vegas Raiders' },
  ]);
  assert.deepEqual(second, first);
  assert.equal(calls, 1, 'league directory should reuse the existing 24-hour public cache');
});

test('unsupported or league-agnostic sports do not invent a team directory', async () => {
  let calls = 0;
  const research = createPublicResearch({
    fetchImpl: async () => {
      calls += 1;
      throw new Error('network should not be called');
    },
  });

  assert.deepEqual(await research.teams('TENNIS'), []);
  assert.equal(calls, 0);
});
