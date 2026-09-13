import test from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORTED_SPORTS, AUTOMATIC_SPORTS } from '../lib/autoscout/models.mjs';
import { canonicalSport, marketContract } from '../lib/data-sources/espn/stat-contract.mjs';
import { normalizedFeedBoard, record } from '../lib/ingestion/normalize.mjs';
import { researchClient } from '../lib/ui/research-home.mjs';

const gameStartTime = '2026-09-14T18:00:00.000Z';

test('ATP and WTA normalize into TENNIS without widening automatic paid polling', () => {
  assert.equal(canonicalSport('ATP'), 'TENNIS');
  assert.equal(canonicalSport('WTA'), 'TENNIS');
  assert.equal(canonicalSport('ATP Tennis'), 'TENNIS');
  assert.ok(SUPPORTED_SPORTS.includes('TENNIS'));
  assert.equal(AUTOMATIC_SPORTS.includes('TENNIS'), false);
});

test('common tennis player props have canonical stat contracts', () => {
  assert.deepEqual(marketContract({ sport: 'ATP', market: 'Aces' }), {
    fields: ['Aces'], entityType: 'player', category: null, sport: 'TENNIS', requiredSackKind: null,
  });
  assert.deepEqual(marketContract({ sport: 'WTA', market: 'Double Faults' }), {
    fields: ['DoubleFaults'], entityType: 'player', category: null, sport: 'TENNIS', requiredSackKind: null,
  });
  assert.deepEqual(marketContract({ sport: 'TENNIS', market: 'Games Won' }), {
    fields: ['GamesWon'], entityType: 'player', category: null, sport: 'TENNIS', requiredSackKind: null,
  });
});

test('public DFS tennis rows normalize into active tennis props', () => {
  const row = record({
    sourceId: 'tennis-fixture-1', book: 'prizepicks', nativePlayerId: 'player-1', playerName: 'Fixture Player',
    sport: 'ATP', market: 'Aces', line: 7.5, team: '', opponent: 'Opponent Player', nativeEventId: 'event-1',
    homeTeam: '', awayTeam: '', gameStartTime, updatedAt: '2026-09-13T18:00:00.000Z', sides: ['OVER', 'UNDER'],
  });
  assert.ok(row);
  assert.equal(row.sport, 'TENNIS');
  const board = normalizedFeedBoard([row]);
  assert.equal(board.props.length, 2);
  assert.equal(board.active_props.length, 1);
  assert.equal(board.props[0].sport, 'TENNIS');
  assert.equal(board.props[0].marketId, 'player_aces');
});

test('research presentation exposes TENNIS in the sport selector', () => {
  const source = '<div class="as5" id="as5"></div>\nvar SPORTS=[\'NFL\',\'NBA\',\'MLB\',\'NHL\',\'WNBA\',\'NCAAF\',\'NCAAB\',\'MLS\',\'EPL\',\'UCL\'];';
  const client = researchClient(source);
  assert.match(client, /'NCAAB','TENNIS','MLS'/);
});
