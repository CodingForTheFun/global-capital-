import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchDraftKingsSportsContentPublic } from '../lib/ingestion/draftkings-sportscontent-public.mjs';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}
function fixtureFetcher({ selections }) {
  return async (url) => {
    const value = String(url);
    if (/\/leagues\/84240$/.test(value)) {
      return json({
        categories: [{ id: 743, name: 'Player Props' }],
        subcategories: [{ id: 6719, categoryId: 743, name: 'Hits' }],
      });
    }
    if (/\/leagues\/84240\/categories\/743\/subcategories\/6719$/.test(value)) {
      return json({
        events: [{ id: 'e1', name: 'NY Mets @ ATL Braves', startEventDate: '2099-09-15T23:00:00Z' }],
        markets: [{ id: 'm1', eventId: 'e1', name: 'Mookie Betts Hits O/U' }],
        selections,
      });
    }
    return json({ error: 'unexpected URL' }, 404);
  };
}

test('DraftKings SportsContent normalizes a complete main over/under player prop', async () => {
  const fetcher = fixtureFetcher({
    selections: [
      { marketId: 'm1', label: 'Over 1.5', points: 1.5, displayOdds: { american: '+120' } },
      { marketId: 'm1', label: 'Under 1.5', points: 1.5, displayOdds: { american: '-150' } },
    ],
  });
  const result = await fetchDraftKingsSportsContentPublic('MLB', { fetcher, force: true });
  assert.equal(result.records.length, 1);
  const row = result.records[0];
  assert.equal(row.book, 'draftkings');
  assert.equal(row.sport, 'MLB');
  assert.equal(row.playerName, 'Mookie Betts');
  assert.equal(row.market, 'Hits');
  assert.equal(row.line, 1.5);
  assert.equal(row.overOdds, 120);
  assert.equal(row.underOdds, -150);
  assert.deepEqual(row.sides, ['OVER', 'UNDER']);
  assert.equal(row.nativeEventId, 'e1');
  assert.equal(result.categoriesChecked, 1);
});

test('DraftKings SportsContent fails closed on one-sided threshold markets', async () => {
  const fetcher = fixtureFetcher({
    selections: [
      { marketId: 'm1', label: '1+', points: null, displayOdds: { american: '+250' } },
    ],
  });
  await assert.rejects(
    fetchDraftKingsSportsContentPublic('MLB', { fetcher, force: true }),
    (error) => error?.code === 'DRAFTKINGS_SPORTSCONTENT_NO_PROPS',
  );
});
