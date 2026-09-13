import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUnderdog } from '../lib/ingestion/normalize.mjs';
import { marketContract } from '../lib/data-sources/espn/stat-contract.mjs';

function underdogV2({ liveEvent = false } = {}) {
  return {
    _autoscout_v2: true,
    players: [{ id: 'p1', full_name: 'Test Batter', sport_id: 'MLB', live_event: false }],
    appearances: [{ id: 'a1', player_id: 'p1', match_id: 'g1', team_id: 't1' }],
    games: [{
      id: 'g1', sport_id: 'MLB', scheduled_at: '2099-09-14T00:00:00.000Z',
      home_team_id: 't1', away_team_id: 't2',
    }],
    teams: [{ id: 't1', abbr: 'BOS' }, { id: 't2', abbr: 'NYY' }],
    over_under_lines: [{
      id: 'l1', live_event: liveEvent, stat_value: 1.5,
      over_under: { appearance_stat: { appearance_id: 'a1', display_stat: 'Hits' } },
      options: [
        { choice: 'higher', live_event: false, payout_multiplier: 1 },
        { choice: 'lower', live_event: false, payout_multiplier: 1 },
      ],
    }],
  };
}

test('Underdog v2 keeps ordinary pregame rows when live_event is false', () => {
  const rows = normalizeUnderdog(underdogV2());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sport, 'MLB');
  assert.equal(rows[0].market, 'Hits');
  assert.equal(rows[0].line, 1.5);
  assert.deepEqual(rows[0].sides, ['OVER', 'UNDER']);
});

test('Underdog v2 still rejects genuinely live rows', () => {
  assert.equal(normalizeUnderdog(underdogV2({ liveEvent: true })).length, 0);
});

test('fallback public market ids can use an exact verified display-label contract', () => {
  const contract = marketContract({
    sport: 'NBA',
    market: '3-PT Made',
    providerMarketKey: 'player_3_pt_made',
  });
  assert.ok(contract);
  assert.deepEqual(contract.fields, ['ThreePointersMade']);
  assert.equal(contract.entityType, 'player');
});

test('partial-period fallback ids remain fail-closed for history', () => {
  assert.equal(marketContract({
    sport: 'NBA',
    market: '1st Quarter Points',
    providerMarketKey: 'player_points_q1',
  }), null);
});
