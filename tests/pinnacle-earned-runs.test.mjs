import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchPinnaclePublic } from '../lib/ingestion/pinnacle-public.mjs';

function jsonResponse(value) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify(value),
  };
}

function fixtureFetcher() {
  const startTime = '2099-09-19T20:00:00.000Z';
  return async (url) => {
    if (url.endsWith('/sports')) return jsonResponse([{ id: 3, name: 'Baseball' }]);
    if (url.includes('/sports/3/matchups')) {
      return jsonResponse([{
        id: 'mlb-game-1',
        type: 'matchup',
        startTime,
        hasMarkets: true,
        league: { name: 'MLB' },
        participants: [
          { alignment: 'home', name: 'Houston Astros' },
          { alignment: 'away', name: 'Arizona Diamondbacks' },
        ],
      }]);
    }
    if (url.endsWith('/matchups/mlb-game-1/related')) {
      return jsonResponse([
        {
          id: 'earned-runs-special',
          type: 'special',
          units: 'Runs',
          special: { category: 'Player Props', description: 'Hunter Brown Earned Runs' },
          participants: [{ id: 'er-over', name: 'Over' }, { id: 'er-under', name: 'Under' }],
        },
        {
          id: 'batter-runs-special',
          type: 'special',
          units: 'Runs',
          special: { category: 'Player Props', description: 'Corbin Carroll Runs' },
          participants: [{ id: 'runs-over', name: 'Over' }, { id: 'runs-under', name: 'Under' }],
        },
      ]);
    }
    if (url.endsWith('/matchups/mlb-game-1/markets/related/straight')) {
      return jsonResponse([
        {
          matchupId: 'earned-runs-special', type: 'total', period: 0,
          prices: [
            { participantId: 'er-over', points: 2.5, price: -105 },
            { participantId: 'er-under', points: 2.5, price: -115 },
          ],
        },
        {
          matchupId: 'batter-runs-special', type: 'total', period: 0,
          prices: [
            { participantId: 'runs-over', points: 0.5, price: 110 },
            { participantId: 'runs-under', points: 0.5, price: -130 },
          ],
        },
      ]);
    }
    throw new Error(`unexpected Pinnacle fixture URL: ${url}`);
  };
}

test('Pinnacle generic Runs units preserve Earned Runs descriptions as pitcher props', async () => {
  const result = await fetchPinnaclePublic('MLB', { fetcher: fixtureFetcher(), force: true });
  const earnedRuns = result.records.find((row) => row.sourceId.includes('earned-runs-special'));
  const batterRuns = result.records.find((row) => row.sourceId.includes('batter-runs-special'));

  assert.ok(earnedRuns);
  assert.equal(earnedRuns.playerName, 'Hunter Brown');
  assert.equal(earnedRuns.market, 'Earned Runs');
  assert.ok(!earnedRuns.playerName.endsWith(' Earned'));

  assert.ok(batterRuns);
  assert.equal(batterRuns.playerName, 'Corbin Carroll');
  assert.equal(batterRuns.market, 'Runs');
});
