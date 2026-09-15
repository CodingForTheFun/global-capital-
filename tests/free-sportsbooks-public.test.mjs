import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchFanDuelPublic } from '../lib/ingestion/fanduel-public.mjs';
import { fetchPinnaclePublic } from '../lib/ingestion/pinnacle-public.mjs';
import { fetchBetRiversPublic } from '../lib/ingestion/betrivers-public.mjs';
import { fetchBovadaPublic, bovadaSupportedSports } from '../lib/ingestion/bovada-public.mjs';

function response(body, status = 200) {
  const bodyText = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(bodyText)) }),
    text: async () => bodyText,
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
      id: 300, type: 'matchup', startTime: start, hasMarkets: true, isLive: false, league: { name: 'NBA' },
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

test('BetRivers Kambi collector keeps explicit MAIN_LINE player totals', async () => {
  const start = new Date(Date.now() + 86_400_000).toISOString();
  const fetcher = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.pathname.includes('/listView/american_football/nfl/')) return response({
      events: [{ event: { id: 500, homeName: 'Buffalo Bills', awayName: 'Kansas City Chiefs', start, state: 'NOT_STARTED' }, betOffers: [] }],
    });
    if (parsed.pathname.includes('/betoffer/event/500.json')) return response({
      betOffers: [{
        id: 501, eventId: 500, criterion: { label: 'Passing Yards' }, betOfferType: { name: 'Over/Under' }, tags: ['MAIN_LINE'],
        outcomes: [
          { status: 'OPEN', participant: 'Patrick Mahomes', type: 'OT_OVER', line: 275500, oddsAmerican: '-110' },
          { status: 'OPEN', participant: 'Patrick Mahomes', type: 'OT_UNDER', line: 275500, oddsAmerican: '-110' },
        ],
      }],
    });
    return response({}, 404);
  };
  const result = await fetchBetRiversPublic('NFL', { fetcher, force: true });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].book, 'betrivers');
  assert.equal(result.records[0].playerName, 'Patrick Mahomes');
  assert.equal(result.records[0].market, 'Passing Yards');
  assert.equal(result.records[0].line, 275.5);
  assert.equal(result.records[0].overOdds, -110);
  assert.equal(result.records[0].underOdds, -110);
});

test('Bovada coupon collector keeps full-game two-sided player props', async () => {
  const startTime = Date.now() + 86_400_000;
  const fetcher = async () => response([{
    events: [{
      id: 600, startTime, live: false,
      competitors: [{ name: 'Los Angeles Dodgers', home: true }, { name: 'San Francisco Giants', home: false }],
      displayGroups: [{
        description: 'Player Props',
        markets: [{
          id: 601, status: 'O', description: 'Total Hits - Mookie Betts (LAD)',
          outcomes: [
            { status: 'O', description: 'Over', price: { american: '-115', handicap: '1.5' } },
            { status: 'O', description: 'Under', price: { american: '-105', handicap: '1.5' } },
          ],
        }],
      }],
    }],
  }]);
  const result = await fetchBovadaPublic('MLB', { fetcher, force: true });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].book, 'bvda');
  assert.equal(result.records[0].playerName, 'Mookie Betts');
  assert.equal(result.records[0].market, 'Hits');
  assert.equal(result.records[0].line, 1.5);
  assert.equal(result.records[0].overOdds, -115);
  assert.equal(result.records[0].underOdds, -105);
});

test('Bovada tennis collector uses the tennis coupon and keeps supported player stat totals', async () => {
  const startTime = Date.now() + 86_400_000;
  let requestedUrl = '';
  const fetcher = async (url) => {
    requestedUrl = String(url);
    return response([{
      events: [{
        id: 700, startTime, live: false,
        competitors: [{ name: 'Aryna Sabalenka', home: true }, { name: 'Iga Swiatek', home: false }],
        displayGroups: [{
          description: 'Player Props',
          markets: [
            {
              id: 701, status: 'O', description: 'Total Aces - Aryna Sabalenka',
              outcomes: [
                { status: 'O', description: 'Over', price: { american: '-110', handicap: '5.5' } },
                { status: 'O', description: 'Under', price: { american: '-120', handicap: '5.5' } },
              ],
            },
            {
              id: 702, status: 'O', description: 'First Service Break - Aryna Sabalenka',
              outcomes: [
                { status: 'O', description: 'Over', price: { american: '-110', handicap: '0.5' } },
                { status: 'O', description: 'Under', price: { american: '-110', handicap: '0.5' } },
              ],
            },
          ],
        }],
      }],
    }]);
  };
  assert.ok(bovadaSupportedSports().includes('TENNIS'));
  const result = await fetchBovadaPublic('TENNIS', { fetcher, force: true });
  assert.match(requestedUrl, /\/description\/tennis\?lang=en$/);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].book, 'bvda');
  assert.equal(result.records[0].sport, 'TENNIS');
  assert.equal(result.records[0].playerName, 'Aryna Sabalenka');
  assert.equal(result.records[0].market, 'Aces');
  assert.equal(result.records[0].line, 5.5);
  assert.equal(result.records[0].overOdds, -110);
  assert.equal(result.records[0].underOdds, -120);
});
