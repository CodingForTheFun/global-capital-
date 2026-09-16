import test from 'node:test';
import assert from 'node:assert/strict';
import {
  __resetProplineLiveBoardOverlay,
  applyProplineLiveBoardOverlay,
  proplineLiveBoardOverlayHealth,
  recordProplineLiveBoardEvent,
} from '../lib/data-sources/propline/live-board-overlay.mjs';

function board() {
  return {
    props: [
      {
        id: 'line-a', source: 'PropLine', provider: 'propline', sport: 'NBA',
        eventId: 'event-stable', providerEventId: '123', playerId: 'player-stable',
        providerPlayerId: 'nba:1', playerName: 'Test Player', marketId: 'player_points',
        side: 'OVER', line: 20.5, price: -110, impliedProbability: 52.38,
        sportsbookKey: 'fanduel', providerOutcomeId: 'outcome-1',
      },
      {
        id: 'line-b', source: 'PropLine', provider: 'propline', sport: 'NBA',
        eventId: 'event-stable', providerEventId: '123', playerId: 'player-stable',
        providerPlayerId: 'nba:1', playerName: 'Test Player', marketId: 'player_rebounds',
        side: 'OVER', line: 7.5, price: -110, sportsbookKey: 'fanduel', providerOutcomeId: 'outcome-2',
      },
      {
        id: 'public', source: 'PrizePicks', provider: 'prizepicks', sport: 'NBA',
        eventId: '123', playerName: 'Other Player', marketId: 'player_points',
        side: 'OVER', line: 10.5, price: null, sportsbookKey: 'prizepicks',
      },
    ],
    data: {
      events: [{ id: 'event-stable', providerEventId: '123' }],
      players: [{ id: 'player-stable', providerPlayerId: 'nba:1', name: 'Test Player' }],
      props: [
        { id: 'prop-a', eventId: 'event-stable', playerId: 'player-stable', playerName: 'Test Player', marketKey: 'player_points' },
        { id: 'prop-b', eventId: 'event-stable', playerId: 'player-stable', playerName: 'Test Player', marketKey: 'player_rebounds' },
      ],
      lines: [
        { id: 'line-a', propId: 'prop-a', bookmakerKey: 'fanduel', line: 20.5, price: -110, providerOutcomeId: 'outcome-1' },
        { id: 'line-b', propId: 'prop-b', bookmakerKey: 'fanduel', line: 7.5, price: -110, providerOutcomeId: 'outcome-2' },
      ],
    },
    meta: { lineCount: 3 },
  };
}

test('line movement overlays current PropLine price and line without touching public rows', () => {
  __resetProplineLiveBoardOverlay();
  recordProplineLiveBoardEvent({
    type: 'line_movement', sequence: 22,
    payload: {
      sport_key: 'basketball_nba', event: { id: 123 }, player_id: 'nba:1', player_name: 'Test Player',
      bookmaker_key: 'fanduel', market_key: 'player_points', outcome_id: 'outcome-1', outcome_name: 'Over',
      current: { point: 21.5, price_american: -125 }, timestamp: new Date().toISOString(),
    },
  });
  const next = applyProplineLiveBoardOverlay(board(), 'NBA');
  const live = next.props.find((row) => row.id === 'line-a');
  assert.equal(live.line, 21.5);
  assert.equal(live.price, -125);
  assert.equal(live.realtime, true);
  assert.equal(live.realtimeSequence, 22);
  assert.equal(next.props.find((row) => row.id === 'public').line, 10.5);
  assert.equal(next.data.lines.find((row) => row.id === 'line-a').line, 21.5);
  assert.equal(next.meta.realtimeOverlay.applied, 1);
});

test('market suspension removes only the matching PropLine player market and returning move restores it', () => {
  __resetProplineLiveBoardOverlay();
  recordProplineLiveBoardEvent({
    type: 'market_suspended', sequence: 30,
    payload: {
      sport_key: 'basketball_nba', event: { id: 123 }, subject: 'Test Player',
      bookmaker_key: 'fanduel', suspended_at: new Date().toISOString(),
      markets: [{ key: 'player_points' }],
    },
  });
  let next = applyProplineLiveBoardOverlay(board(), 'NBA');
  assert.equal(next.props.some((row) => row.id === 'line-a'), false);
  assert.equal(next.props.some((row) => row.id === 'line-b'), true);
  assert.equal(next.props.some((row) => row.id === 'public'), true);

  recordProplineLiveBoardEvent({
    type: 'line_movement', sequence: 31,
    payload: {
      sport_key: 'basketball_nba', event: { id: 123 }, player_id: 'nba:1', player_name: 'Test Player',
      bookmaker_key: 'fanduel', market_key: 'player_points', outcome_id: 'outcome-1', outcome_name: 'Over',
      current: { point: 20.5, price_american: -105 }, timestamp: new Date().toISOString(),
    },
  });
  next = applyProplineLiveBoardOverlay(board(), 'NBA');
  assert.equal(next.props.some((row) => row.id === 'line-a'), true);
  assert.equal(next.props.find((row) => row.id === 'line-a').price, -105);
  assert.equal(proplineLiveBoardOverlayHealth().latestSequence, 31);
});

test('batch line movement records provider outcome ids', () => {
  __resetProplineLiveBoardOverlay();
  recordProplineLiveBoardEvent({
    type: 'line_movement', sequence: 40,
    payload: {
      batch: true, event_type: 'line_movement',
      events: [{ seq: 41, data: {
        sport_key: 'basketball_nba', event: { id: 123 }, player_id: 'nba:1', player_name: 'Test Player',
        bookmaker_key: 'fanduel', market_key: 'player_rebounds', outcome_id: 'outcome-2', outcome_name: 'Over',
        current: { point: 8.5, price_american: 102 },
      }}],
    },
  });
  const next = applyProplineLiveBoardOverlay(board(), 'NBA');
  assert.equal(next.props.find((row) => row.id === 'line-b').line, 8.5);
  assert.equal(next.props.find((row) => row.id === 'line-b').price, 102);
  assert.equal(proplineLiveBoardOverlayHealth().latestSequence, 41);
});
