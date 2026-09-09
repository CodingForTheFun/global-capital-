import test from 'node:test';
import assert from 'node:assert/strict';
import { createSportsDataIoPropBoard } from '../lib/data-sources/sportsdataio/prop-board.mjs';
import { fromSportsDataIoOffers } from '../lib/props/provider-model.mjs';
import { buildPropViewFrom } from '../lib/props/pipeline.mjs';
import { renderPropCardsMarkup } from '../public/props-presenter.mjs';

function fakeClient() {
  const calls = [];
  return {
    calls,
    stats: () => ({ requests: calls.length, hits: 0, misses: calls.length, errors: 0 }),
    async get(_url, path) {
      calls.push(path);
      if (path.includes('GamesByDate')) {
        return {
          ok: true,
          data: Array.from({ length: 12 }, (_, index) => ({
            GameID: index + 1,
            DateTime: '2026-09-09T19:00:00Z',
            HomeTeam: `H${index + 1}`,
            AwayTeam: `A${index + 1}`,
          })),
        };
      }
      const match = path.match(/BettingPlayerPropsByGameID\/(\d+)/);
      if (match) {
        const gameId = Number(match[1]);
        return {
          ok: true,
          data: [0, 1].map((slot) => ({
            BettingMarketID: gameId * 10 + slot,
            BettingBetType: slot === 0 ? 'Points' : 'Rebounds',
            PlayerID: gameId * 100 + slot,
            PlayerName: `Player ${gameId}-${slot}`,
            TeamKey: `H${gameId}`,
            BettingOutcomes: [{
              BettingOutcomeID: gameId * 1000 + slot,
              BettingOutcomeType: slot === 0 ? 'OVER' : 'UNDER',
              Value: 10.5 + slot,
              IsAvailable: true,
              IsAlternate: false,
              SportsBook: 'TestBook',
            }],
          })),
        };
      }
      return { ok: false, status: 404, reason: 'not found', data: null };
    },
  };
}

test('more than eight provider props survive fetch, normalization, paging and rendered markup', async () => {
  process.env.SPORTSDATAIO_API_KEY = 'unit-test-key-not-real';
  const client = fakeClient();
  const board = createSportsDataIoPropBoard({ client, now: () => new Date('2026-09-09T12:00:00Z') });
  const raw = await board.fetchBoard({ sports: ['NBA'] });
  assert.equal(raw.offers.length, 24, 'provider returned 24 valid outcomes');

  const canonical = fromSportsDataIoOffers(raw.offers, { fetchedAt: raw.fetchedAt });
  assert.equal(canonical.length, 24, 'normalization must not impose an eight-row cap');

  const view = buildPropViewFrom(canonical, { filters: { timeWindow: 'ALL' }, limit: 500 });
  assert.equal(view.props.length, 24, 'MAX paging must return every valid row in this fixture');
  assert.equal(view.counts.filtered, 24);

  const markup = renderPropCardsMarkup(view.props);
  assert.equal((markup.match(/data-prop-id=/g) || []).length, 24, 'client presenter renders more than eight cards');
  delete process.env.SPORTSDATAIO_API_KEY;
});

test('requested limits propagate without changing the underlying filtered count', () => {
  const props = Array.from({ length: 30 }, (_, index) => fromSportsDataIoOffers([{
    source: 'SportsDataIO', sportsbook: 'Book', sportsbookKey: 'book', sport: 'NBA',
    playerId: index + 1, playerName: `Limit Player ${index + 1}`, market: 'Points',
    line: 20.5, side: 'OVER', isAvailable: true, isAlternate: false, gameId: index + 1,
  }])[0]);
  const view = buildPropViewFrom(props, { filters: { timeWindow: 'ALL' }, limit: 10 });
  assert.equal(view.props.length, 10);
  assert.equal(view.counts.filtered, 30);
  assert.equal(view.counts.returned, 10);
});
