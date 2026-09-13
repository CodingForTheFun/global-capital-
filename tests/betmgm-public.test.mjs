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

test('BetMGM public fixture feed keeps an explicit two-sided player total', async () => {
  const start = new Date(Date.now() + 86_400_000).toISOString();
  const fetcher = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith('/api/clientconfig')) return response({ msPreloader: { groupingUrl: 'https://x.test/path?x-bwin-accessid=public-test-id&foo=1' } });
    if (parsed.pathname.endsWith('/cds-api/bettingoffer/fixtures')) return response({ fixtures: [{
      id: 'fx1', startDate: start,
      participants: [
        { properties: { type: 'AWAYTEAM' }, name: { value: 'Kansas City Chiefs' } },
        { properties: { type: 'HOMETEAM' }, name: { value: 'Buffalo Bills' } },
      ],
      optionMarkets: [{
        id: 'm1', status: 'Visible', name: { value: 'Patrick Mahomes Passing Yards' },
        options: [
          { status: 'Visible', name: { value: 'Patrick Mahomes Over 275.5' }, totalsPrefix: 'Over', attr: '275.5', price: { americanOdds: '-110' } },
          { status: 'Visible', name: { value: 'Patrick Mahomes Under 275.5' }, totalsPrefix: 'Under', attr: '275.5', price: { americanOdds: '-110' } },
        ],
      }],
    }] });
    return response({}, 404);
  };
  const result = await fetchBetMgmPublic('NFL', { fetcher, force: true });
  assert.equal(result.records.length, 1);
  const row = result.records[0];
  assert.equal(row.book, 'betmgm');
  assert.equal(row.playerName, 'Patrick Mahomes');
  assert.equal(row.market, 'Passing Yards');
  assert.equal(row.line, 275.5);
  assert.equal(row.overOdds, -110);
  assert.equal(row.underOdds, -110);
});

test('BetMGM public fixture feed rejects ambiguous alternate ladders', async () => {
  const start = new Date(Date.now() + 86_400_000).toISOString();
  const fetcher = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith('/api/clientconfig')) return response({});
    if (parsed.pathname.endsWith('/cds-api/bettingoffer/fixtures')) return response({ fixtures: [{
      id: 'fx2', startDate: start,
      optionMarkets: [{
        id: 'm2', status: 'Visible', name: { value: 'LeBron James Points' },
        options: [
          { status: 'Visible', name: { value: 'LeBron James Over 25.5' }, totalsPrefix: 'Over', attr: '25.5', price: { americanOdds: '-110' } },
          { status: 'Visible', name: { value: 'LeBron James Under 25.5' }, totalsPrefix: 'Under', attr: '25.5', price: { americanOdds: '-110' } },
          { status: 'Visible', name: { value: 'LeBron James Over 26.5' }, totalsPrefix: 'Over', attr: '26.5', price: { americanOdds: '+105' } },
          { status: 'Visible', name: { value: 'LeBron James Under 26.5' }, totalsPrefix: 'Under', attr: '26.5', price: { americanOdds: '-125' } },
        ],
      }],
    }] });
    return response({}, 404);
  };
  const result = await fetchBetMgmPublic('NBA', { fetcher, force: true });
  assert.equal(result.records.length, 0);
});
