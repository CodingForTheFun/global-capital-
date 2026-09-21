import test from 'node:test';
import assert from 'node:assert/strict';

import { propProviderMode, providerRouting } from '../lib/autoscout/provider-mode.mjs';
import { normalizeSportradarPlayerProps } from '../lib/data-sources/sportradar/normalize.mjs';

test('provider switch accepts operator words without changing the data contract', () => {
  assert.equal(propProviderMode({ OBLIGE_PROP_PROVIDER_MODE: 'RADAR' }), 'sportradar');
  assert.equal(propProviderMode({ OBLIGE_PROP_PROVIDER_MODE: 'LINE' }), 'propline');
  assert.equal(propProviderMode({ OBLIGE_PROP_PROVIDER_MODE: 'SGO' }), 'sportsgameodds');
  assert.equal(providerRouting({ OBLIGE_PROP_PROVIDER_MODE: 'RADAR' }).primary, 'sportradar');
  assert.deepEqual(
    providerRouting({ OBLIGE_PROP_PROVIDER_MODE: 'RADAR' }).fallback,
    ['sportsgameodds'],
  );
});

test('Sportradar player props normalize canonical books and reject removed outcomes', () => {
  const payload = {
    generated_at: '2026-09-21T20:00:00Z',
    competition_sport_events_players_props: [{
      sport_event: {
        id: 'sr:sport_event:fixture',
        status: 'not_started',
        start_time: '2026-09-22T00:00:00Z',
        competitors: [
          { id: 'sr:competitor:home', name: 'Home', abbreviation: 'HOM', qualifier: 'home' },
          { id: 'sr:competitor:away', name: 'Away', abbreviation: 'AWY', qualifier: 'away' },
        ],
      },
      players_props: [{
        player: {
          id: 'sr:player:fixture',
          name: 'Fixture Player',
          competitor_id: 'sr:competitor:home',
        },
        markets: [{
          id: 'sr:market:921',
          name: 'Total Points',
          books: [
            {
              id: 'sr:book:mgm',
              name: 'MGM',
              outcomes: [
                { id: 'over', type: 'over', total: 24.5, odds_american: -110 },
                { id: 'under', type: 'under', total: 24.5, odds_american: -110 },
                { id: 'removed', type: 'over', total: 23.5, odds_american: -105, removed: true },
              ],
            },
            {
              id: 'sr:book:williamhill',
              name: 'William Hill',
              outcomes: [
                { id: 'wh-over', type: 'over', total: 24.5, odds_american: -108 },
              ],
            },
          ],
        }],
      }],
    }],
  };

  const board = normalizeSportradarPlayerProps(payload, {
    sport: 'NBA',
    fetchedAt: '2026-09-21T20:00:00Z',
  });

  assert.equal(board.props.length, 3);
  assert.deepEqual(
    [...new Set(board.props.map((row) => row.sportsbookKey))].sort(),
    ['betmgm', 'caesars'],
  );
  assert.ok(board.props.every((row) => row.marketId === 'player_points'));
  assert.equal(board.skipped.removed, 1);
  assert.equal(board.data.events.length, 1);
  assert.equal(board.data.players.length, 1);
  assert.equal(board.data.props.length, 1);
});
