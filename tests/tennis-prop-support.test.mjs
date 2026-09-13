import test from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORTED_SPORTS, AUTOMATIC_SPORTS } from '../lib/autoscout/models.mjs';
import { canonicalSport, marketContract } from '../lib/data-sources/espn/stat-contract.mjs';
import { record } from '../lib/ingestion/normalize.mjs';

const gameStartTime = '2026-09-14T18:00:00.000Z';

test('ATP and WTA normalize into the shared TENNIS sport without widening automatic paid polling', () => {
  assert.equal(canonicalSport('ATP'), 'TENNIS');
  assert.equal(canonicalSport('WTA'), 'TENNIS');
  assert.equal(canonicalSport('ATP Tennis'), 'TENNIS');
  assert.ok(SUPPORTED_SPORTS.includes('TENNIS'));
  assert.equal(AUTOMATIC_SPORTS.includes('TENNIS'), false);
});

test('common tennis player props have canonical player-stat contracts', () => {
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

test('public DFS tennis rows survive normalized record validation', () => {
  const row = record({
    sourceId: 'tennis-fixture-1',
    book: 'prizepicks',
    nativePlayerId: 'player-1',
    playerName: 'Fixture Player',
    sport: 'ATP',
    market: 'Aces',
    line: 7.5,
    team: '',
    opponent: 'Opponent Player',
    nativeEventId: 'event-1',
    homeTeam: '',
    awayTeam: '',
    gameStartTime,
    updatedAt: '2026-09-13T18:00:00.000Z',
    sides: ['OVER', 'UNDER'],
  });
  assert.ok(row);
  assert.equal(row.sport, 'TENNIS');
  assert.equal(row.contract.entityType, 'player');
  assert.deepEqual(row.contract.fields, ['Aces']);
});
