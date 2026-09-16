import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchBetMgmPublic } from '../lib/ingestion/betmgm-public.mjs';

function response(body, status = 200) {
  const raw = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(raw)) }),
    text: async () => raw,
  };
}

function fixtureMarket(options) {
  return {
    fixtures: [{
      id: 'mlb-fixture-1',
      startDate: new Date(Date.now() + 86_400_000).toISOString(),
      participants: [
        { properties: { type: 'AWAYTEAM' }, name: { value: 'Seattle Mariners' } },
        { properties: { type: 'HOMETEAM' }, name: { value: 'Los Angeles Angels' } },
      ],
      optionMarkets: [{
        id: 'runs-market',
        status: 'Visible',
        name: { value: 'Runs' },
        options,
      }],
    }],
  };
}

async function fetchFixture(options) {
  const fetcher = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith('/api/clientconfig')) return response({});
    if (parsed.pathname.endsWith('/cds-api/bettingoffer/fixtures')) return response(fixtureMarket(options));
    return response({}, 404);
  };
  return fetchBetMgmPublic('MLB', { fetcher, force: true });
}

test('BetMGM period labels do not become MLB player props', async () => {
  const result = await fetchFixture([
    { status: 'Visible', name: { value: 'First 5 innings Over 4' }, totalsPrefix: 'Over', attr: '4', price: { americanOdds: '-118' } },
    { status: 'Visible', name: { value: 'First 5 innings Under 4' }, totalsPrefix: 'Under', attr: '4', price: { americanOdds: '-102' } },
  ]);
  assert.equal(result.records.length, 0);
});

test('BetMGM real MLB player names still pass the same parser', async () => {
  const result = await fetchFixture([
    { status: 'Visible', name: { value: 'Mike Trout Over 0.5' }, totalsPrefix: 'Over', attr: '0.5', price: { americanOdds: '-110' } },
    { status: 'Visible', name: { value: 'Mike Trout Under 0.5' }, totalsPrefix: 'Under', attr: '0.5', price: { americanOdds: '-110' } },
  ]);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].playerName, 'Mike Trout');
});
