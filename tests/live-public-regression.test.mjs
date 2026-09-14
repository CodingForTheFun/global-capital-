import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUnderdog, normalizedFeedBoard, record } from '../lib/ingestion/normalize.mjs';
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
      over_under: {
        live_event: false,
        appearance_stat: { appearance_id: 'a1', display_stat: 'Hits' },
      },
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

// The public-feeds collector reads api.underdogfantasy.com/v1/over_under_lines,
// which carries no _autoscout_v2 marker. That feed stamps live_event:false on
// every ordinary pregame row, so a predicate that treated any non-null marker
// as live discarded the entire feed — 2,858 of 2,858 rows — while the v2 path
// kept working, which is why it went unnoticed.
test('Underdog v1 keeps pregame rows that are marked live_event:false', () => {
  const payload = underdogV2();
  delete payload._autoscout_v2;
  const rows = normalizeUnderdog(payload);
  assert.equal(rows.length, 1, 'the v1 feed shape must survive normalization');
  assert.equal(rows[0].market, 'Hits');
});

test('Underdog v1 still rejects genuinely live rows', () => {
  const payload = underdogV2({ liveEvent: true });
  delete payload._autoscout_v2;
  assert.equal(normalizeUnderdog(payload).length, 0);
});

// Tennis, golf and MMA appearances reference solo_games; joining only against
// games dropped every individual-sport line Underdog offers.
test('Underdog individual-sport lines resolve through solo_games', () => {
  const payload = underdogV2();
  delete payload._autoscout_v2;
  payload.players = [{ id: 'p1', full_name: 'Test Player', sport_id: 'TENNIS', live_event: false }];
  payload.solo_games = payload.games.map(game => ({
    id: game.id, sport_id: 'TENNIS', scheduled_at: game.scheduled_at, status: 'scheduled',
  }));
  payload.games = [];
  const rows = normalizeUnderdog(payload);
  assert.equal(rows.length, 1, 'a solo-game appearance must still produce a line');
  assert.equal(rows[0].sport, 'TENNIS');
});

test('3-PT Made normalizes to the canonical basketball threes market', () => {
  const row = record({
    sourceId: 'projection-1',
    book: 'prizepicks',
    nativePlayerId: 'player-1',
    playerName: 'Jayson Tatum',
    sport: 'NBA',
    market: '3-PT Made',
    line: 2.5,
    gameStartTime: '2099-09-14T00:00:00.000Z',
    sides: ['OVER', 'UNDER'],
  });
  assert.ok(row);
  const board = normalizedFeedBoard([row]);
  assert.equal(board.props.length, 2);
  assert.equal(board.props[0].marketId, 'player_threes');
  const contract = marketContract({
    sport: 'NBA',
    market: board.props[0].market,
    providerMarketKey: board.props[0].marketId,
  });
  assert.ok(contract);
  assert.deepEqual(contract.fields, ['ThreePointersMade']);
});
