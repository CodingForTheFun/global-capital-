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

function v5Payload({ eventId, eventName, start, category, subcategory, offer }) {
  return {
    eventGroup: {
      events: [{ id: eventId, eventId, name: eventName, startEventDate: start }],
      offerCategories: [{
        id: 1000,
        name: category,
        offerSubcategoryDescriptors: [{
          name: subcategory,
          offerSubcategory: { offers: [[offer]] },
        }],
      }],
    },
  };
}

test('DraftKings v5 collector keeps one verified two-sided regular line', async () => {
  const start = new Date(Date.now() + 86_400_000).toISOString();
  const fetcher = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.includes('/eventgroups/88808')) return response(v5Payload({
      eventId: 'e1', eventName: 'Kansas City Chiefs @ Buffalo Bills', start,
      category: 'Player Props', subcategory: 'Passing Props',
      offer: {
        id: 'o1', eventId: 'e1', label: 'Patrick Mahomes Passing Yards', status: 'open',
        outcomes: [
          { label: 'Over 275.5', points: 275.5, displayOdds: { american: '-110' } },
          { label: 'Under 275.5', points: 275.5, displayOdds: { american: '-110' } },
        ],
      },
    }));
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

test('DraftKings v5 collector fails closed on an alternate ladder', async () => {
  const start = new Date(Date.now() + 86_400_000).toISOString();
  const fetcher = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.includes('/eventgroups/84240')) return response(v5Payload({
      eventId: 'e2', eventName: 'New York Yankees @ Boston Red Sox', start,
      category: 'Player Props', subcategory: 'Batter Props',
      offer: {
        id: 'o2', eventId: 'e2', label: 'Aaron Judge Hits', status: 'open',
        outcomes: [
          { label: 'Over 0.5', points: 0.5, displayOdds: { american: '-180' } },
          { label: 'Under 0.5', points: 0.5, displayOdds: { american: '+145' } },
          { label: 'Over 1.5', points: 1.5, displayOdds: { american: '+165' } },
          { label: 'Under 1.5', points: 1.5, displayOdds: { american: '-205' } },
        ],
      },
    }));
    return response({}, 404);
  };
  const result = await fetchDraftKingsSportsbookPublic('MLB', { fetcher, force: true });
  assert.equal(result.records.length, 0);
});
