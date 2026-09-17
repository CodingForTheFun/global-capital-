import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.MARKET_CORE_PERSIST = '0';

const {
  __resetMarketCoreForTests,
  marketCoreSnapshot,
  marketCoreHealth,
  publishMarketEnvelope,
} = await import('../lib/market-core/live.mjs');

const movement = {
  type: 'line_movement',
  sequence: 41,
  deliveryId: 'delivery-41',
  payload: {
    sport_key: 'basketball_nba',
    event_id: 'evt-1',
    player_id: 'player-7',
    player_name: 'Example Player',
    market_key: 'player_points',
    bookmaker_key: 'draftkings',
    outcome_id: 'outcome-99',
    outcome_name: 'Over',
    previous: { point: 24.5, price_american: -110 },
    current: { point: 25.5, price_american: -105 },
    timestamp: '2026-09-17T02:00:00.000Z',
  },
};

test('market core normalizes PropLine movement into current quote state', () => {
  __resetMarketCoreForTests();
  const published = publishMarketEnvelope(movement, { provider: 'propline' });
  assert.equal(published.accepted, 1);

  const snapshot = marketCoreSnapshot({ sport: 'NBA' });
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.quotes.length, 1);
  assert.equal(snapshot.events[0].kind, 'quote.changed');
  assert.equal(snapshot.events[0].sport, 'NBA');
  assert.equal(snapshot.events[0].providerSequence, 41);
  assert.equal(snapshot.quotes[0].line, 25.5);
  assert.equal(snapshot.quotes[0].price, -105);
  assert.equal(snapshot.quotes[0].sportsbook, 'draftkings');
});

test('market core deduplicates provider delivery ids', () => {
  __resetMarketCoreForTests();
  assert.equal(publishMarketEnvelope(movement, { provider: 'propline' }).accepted, 1);
  assert.equal(publishMarketEnvelope(movement, { provider: 'propline' }).accepted, 0);
  assert.equal(marketCoreSnapshot({ sport: 'NBA' }).events.length, 1);
});

test('market core keeps mixed batch events independently sequenced', () => {
  __resetMarketCoreForTests();
  const result = publishMarketEnvelope({
    type: '',
    sequence: 55,
    payload: {
      batch: true,
      events: [
        {
          event_type: 'line_movement',
          delivery_id: 'batch-1',
          data: { ...movement.payload, outcome_id: 'batch-outcome', current: { point: 26.5, price_american: 100 } },
        },
        {
          event_type: 'steam',
          delivery_id: 'batch-2',
          data: {
            sport_key: 'basketball_nba',
            event_id: 'evt-1',
            player_id: 'player-7',
            player_name: 'Example Player',
            market_key: 'player_points',
            steam_score: 82,
            books_moved: 5,
            books_quoting: 7,
          },
        },
      ],
    },
  }, { provider: 'propline' });

  assert.equal(result.accepted, 2);
  const snapshot = marketCoreSnapshot({ sport: 'NBA' });
  assert.equal(snapshot.events.length, 2);
  assert.equal(snapshot.events[0].kind, 'signal.steam');
  assert.equal(snapshot.events[1].kind, 'quote.changed');
  assert.ok(snapshot.events[0].sequence > snapshot.events[1].sequence);
  assert.equal(snapshot.quotes.length, 1);
  assert.equal(snapshot.quotes[0].line, 26.5);
});

test('health exposes bounded live-core state without provider secrets', () => {
  __resetMarketCoreForTests();
  publishMarketEnvelope(movement, { provider: 'propline' });
  const health = marketCoreHealth();
  assert.equal(health.active, true);
  assert.equal(health.events, 1);
  assert.equal(health.quotes, 1);
  assert.equal(Object.hasOwn(health, 'apiKey'), false);
});
