import test from 'node:test';
import assert from 'node:assert/strict';

import { marketContract, statValue } from '../lib/data-sources/espn/stat-contract.mjs';

const contract = (providerMarketKey, market) =>
  marketContract({ sport: 'MLB', providerMarketKey, market });

test('current DraftKings MLB exact-market aliases map to verified ESPN stat fields', () => {
  const cases = [
    ['player_hits_runs_sb', 'Hits + Runs + SB', ['Hits', 'Runs', 'StolenBases'], 'batting'],
    ['player_total_bases_from_hits', 'Total Bases From Hits', ['TotalBases'], 'batting'],
    ['player_strikeouts_thrown', 'Strikeouts Thrown', ['Strikeouts'], 'pitching'],
    ['player_hitter_strikeouts', 'Hitter Strikeouts', ['Strikeouts'], 'batting'],
    ['player_extra_base_hits', 'Extra Base Hits', ['Doubles', 'Triples', 'HomeRuns'], 'batting'],
  ];

  for (const [providerMarketKey, market, fields, category] of cases) {
    const mapped = contract(providerMarketKey, market);
    assert.ok(mapped, `${providerMarketKey} should be supported`);
    assert.deepEqual(mapped.fields, fields);
    assert.equal(mapped.category, category);
    assert.equal(mapped.entityType, 'player');
  }
});

test('exact MLB alias values are computed only from matching verified stat columns', () => {
  assert.equal(
    statValue(
      { hits: 2, runs: 1, stolenBases: 1 },
      contract('player_hits_runs_sb', 'Hits + Runs + SB'),
    ),
    4,
  );

  assert.equal(
    statValue(
      { hits: 2, doubles: 1, triples: 0, homeRuns: 1 },
      contract('player_total_bases_from_hits', 'Total Bases From Hits'),
    ),
    6,
  );

  assert.equal(
    statValue(
      { strikeouts: 7 },
      contract('player_strikeouts_thrown', 'Strikeouts Thrown'),
    ),
    7,
  );

  assert.equal(
    statValue(
      { strikeouts: 2 },
      contract('player_hitter_strikeouts', 'Hitter Strikeouts'),
    ),
    2,
  );

  assert.equal(
    statValue(
      { doubles: 1, triples: 1, homeRuns: 1 },
      contract('player_extra_base_hits', 'Extra Base Hits'),
    ),
    3,
  );
});

test('unknown MLB provider aliases remain fail-closed', () => {
  assert.equal(
    contract('player_unverified_exact_market', 'Unverified Exact Market'),
    null,
  );
});
