import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchDraftKingsSportsbookPublic } from '../lib/ingestion/draftkings-sportsbook-public.mjs';

function response(body, status = 200) {
  const raw = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(raw)) }),
    text: async () => raw,
  };
}

test('DraftKings sportscontent collector keeps one verified two-sided regular line', async () => {
  const start = new Date(Date.now() + 86_400_000).toISOString();
  const fetcher = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/leagues/88808')) return response({ categories: [{ id: 1000, name: 'Passing Props' }] });
    if (path.endsWith('/leagues/88808/categories/1000')) return response({
      events: [{ id: 'e1', name: 'Kansas City Chiefs @ Buffalo Bills', startEventDate: start }],
      markets: [{ id: 'm1', eventId: 'e1', name: 'Patrick Mahomes Passing Yards O/U' }],
      selections: [
        { marketId: 'm1', label: 'Over 275.5', points: 275.5, displayOdds: { american: '-110' } },
        { marketId: 'm1', label: 'Under 275.5', points: 275.5, displayOdds: { american: '-110' } },
      ],
    });
    return response({}, 404);
  };
  const result = await fetchDraftKingsSportsbookPublic('NFL', { fetcher, force: true });
  assert.equal(result.records.length, 1);
  const row = result.records[0];
  assert.equal(row.book, 'draftkings');
  assert.equal(row.playerName, 'Patrick Mahomes');
  assert.equal(row.market, 'Passing Yards');
  assert.equal(row.line, 275.5);
  assert.equal(row.overOdds, -110);
  assert.equal(row.underOdds, -110);
  assert.deepEqual(row.sides, ['OVER', 'UNDER']);
});

test('DraftKings sportscontent collector fails closed on an alternate ladder', async () => {
  const start = new Date(Date.now() + 86_400_000).toISOString();
  const fetcher = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/leagues/84240')) return response({ categories: [{ id: 743, name: 'Batter Props' }] });
    if (path.endsWith('/leagues/84240/categories/743')) return response({
      events: [{ id: 'e2', name: 'New York Yankees @ Boston Red Sox', startEventDate: start }],
      markets: [{ id: 'm2', eventId: 'e2', name: 'Aaron Judge Hits O/U' }],
      selections: [
        { marketId: 'm2', label: 'Over 0.5', points: 0.5, displayOdds: { american: '-180' } },
        { marketId: 'm2', label: 'Under 0.5', points: 0.5, displayOdds: { american: '+145' } },
        { marketId: 'm2', label: 'Over 1.5', points: 1.5, displayOdds: { american: '+165' } },
        { marketId: 'm2', label: 'Under 1.5', points: 1.5, displayOdds: { american: '-205' } },
      ],
    });
    return response({}, 404);
  };
  const result = await fetchDraftKingsSportsbookPublic('MLB', { fetcher, force: true });
  assert.equal(result.records.length, 0);
});
