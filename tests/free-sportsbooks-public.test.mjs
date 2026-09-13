import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchFanDuelPublic } from '../lib/ingestion/fanduel-public.mjs';
import { fetchPinnaclePublic } from '../lib/ingestion/pinnacle-public.mjs';

function response(body, status = 200) {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(text)) }),
    text: async () => text,
  };
}

test('FanDuel public collector keeps explicit two-sided regular player totals', async () => {
  const start = new Date(Date.now() + 86_400_000).toISOString();
  const fetcher = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith('/content-managed-page')) return response({
      attachments: { events: { '100': { eventId: 100, name: 'Kansas City Chiefs @ Buffalo Bills', openDate: start } } },
    });
    if (parsed.pathname.endsWith('/event-page')) return response({
      attachments: {
        events: { '100': { eventId: 100, name: 'Kansas City Chiefs @ Buffalo Bills', openDate: start } },
        markets: {
          '200': {
            marketId: 200, marketName: 'Patrick Mahomes - Passing Yards', marketStatus: 'OPEN',
            runners: [
              { runnerName: 'Over 275.5', handicap: 275.5, runnerStatus: 'ACTIVE', winRunnerOdds: { americanDisplayOdds: { americanOdds: -110 } } },
              { runnerName: 'Under 275.5', handicap: 275.5, runnerStatus: 'ACTIVE', winRunnerOdds: { americanDisplayOdds: { americanOdds: -110 } } },
            ],
          },
        },
      },
    });
    return response({}, 404);
  };
  const result = await fetchFanDuelPublic('NFL', { fetcher, force: true });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].book, 'fanduel');
  assert.equal(result.records[0].playerName, 'Patrick Mahomes');
  assert.equal(result.records[0].market, 'Passing Yards');
  assert.equal(result.records[0].line, 275.5);
  assert.deepEqual(result.records[0].sides, ['OVER', 'UNDER']);
});

test('Pinnacle guest collector maps explicit special totals only', async () => {
  const start = new Date(Date.now() + 86_400_000).toISOString();
  const fetcher = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith('/sports')) return response([{ id: 4, name: 'Basketball', matchupCount: 20 }]);
    if (parsed.pathname.endsWith('/sports/4/matchups')) return response([{
      id: 300, startTime: start, hasMarkets: true, isLive: false, league: { name: 'NBA' },
      participants: [{ name: 'Los Angeles Lakers', alignment: 'home' }, { name: 'Golden State Warriors', alignment: 'away' }],
    }]);
    if (parsed.pathname.endsWith('/matchups/300/related')) return response([{
      id: 301, type: 'special', units: 'Points', special: { description: 'Total Points by LeBron James' }, isLive: false,
    }]);
    if (parsed.pathname.endsWith('/matchups/300/markets/related/straight')) return response([{
      matchupId: 301, type: 'total', period: 0, isAlternate: false, status: 'open',
      prices: [
        { designation: 'over', points: 25.5, price: -110 },
        { designation: 'under', points: 25.5, price: -110 },
      ],
    }]);
    return response({}, 404);
  };
  const result = await fetchPinnaclePublic('NBA', { fetcher, force: true });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].book, 'pinnacle');
  assert.equal(result.records[0].playerName, 'LeBron James');
  assert.equal(result.records[0].market, 'Points');
  assert.equal(result.records[0].line, 25.5);
  assert.equal(result.records[0].overOdds, -110);
  assert.equal(result.records[0].underOdds, -110);
});
