import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchDraftKingsSportsbookPublic } from '../lib/ingestion/draftkings-sportsbook-public.mjs';

// The collector was rewritten from DraftKings' sportscontent API to the v5
// eventgroups API, and this mock was never moved with it — every request fell
// through to the 404 branch and the suite had been failing on
// DRAFTKINGS_SPORTSBOOK_HTTP ever since. The payloads below mirror the v5
// shape the parser actually walks; the assertions are the original ones,
// because what they check has not changed.

function response(body, status = 200) {
  const raw = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(raw)) }),
    text: async () => raw,
  };
}

/** One v5 eventgroup: events plus the nested offerCategory tree. */
function eventGroup({ event, categoryName, subcategoryName, offers }) {
  return {
    eventGroup: {
      events: [event],
      offerCategories: [{
        name: categoryName,
        offerSubcategoryDescriptors: [{
          name: subcategoryName,
          offerSubcategory: { offers: offers.map((offer) => [offer]) },
        }],
      }],
    },
  };
}

const outcome = (label, line, american) => ({ label, line, oddsAmerican: american });

test('DraftKings sportscontent collector keeps one verified two-sided regular line', async () => {
  const startDate = new Date(Date.now() + 86_400_000).toISOString();
  const fetcher = async (url) => {
    // NFL is eventgroup 88808; anything else is a miss and must stay a miss.
    if (!String(url).includes('/eventgroups/88808')) return response({}, 404);
    return response(eventGroup({
      event: { eventId: 'e1', name: 'Kansas City Chiefs @ Buffalo Bills', startDate },
      categoryName: 'Passing Props',
      subcategoryName: 'Passing Yards',
      offers: [{
        id: 'o1',
        eventId: 'e1',
        label: 'Patrick Mahomes Passing Yards',
        outcomes: [outcome('Over 275.5', 275.5, '-110'), outcome('Under 275.5', 275.5, '-110')],
      }],
    }));
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
  // The teams come from the event name, so a record can always be matched back.
  assert.equal(row.awayTeam, 'Kansas City Chiefs');
  assert.equal(row.homeTeam, 'Buffalo Bills');
});

test('DraftKings sportscontent collector fails closed on an alternate ladder', async () => {
  const startDate = new Date(Date.now() + 86_400_000).toISOString();
  const fetcher = async (url) => {
    if (!String(url).includes('/eventgroups/84240')) return response({}, 404);
    return response(eventGroup({
      event: { eventId: 'e2', name: 'New York Yankees @ Boston Red Sox', startDate },
      categoryName: 'Batter Props',
      subcategoryName: 'Hits',
      // Two complete thresholds for one player and market is a ladder, not a
      // regular line, and must yield nothing rather than a guess at which is
      // the real number.
      offers: [{
        id: 'o2',
        eventId: 'e2',
        label: 'Aaron Judge Hits',
        outcomes: [
          outcome('Over 0.5', 0.5, '-180'), outcome('Under 0.5', 0.5, '+145'),
          outcome('Over 1.5', 1.5, '+165'), outcome('Under 1.5', 1.5, '-205'),
        ],
      }],
    }));
  };
  const result = await fetchDraftKingsSportsbookPublic('MLB', { fetcher, force: true });
  assert.equal(result.records.length, 0);
});

test('a one-sided price is never published as a two-sided line', async () => {
  const startDate = new Date(Date.now() + 86_400_000).toISOString();
  const fetcher = async (url) => {
    if (!String(url).includes('/eventgroups/88808')) return response({}, 404);
    return response(eventGroup({
      event: { eventId: 'e3', name: 'Dallas Cowboys @ Philadelphia Eagles', startDate },
      categoryName: 'Receiving Props',
      subcategoryName: 'Receiving Yards',
      offers: [{
        id: 'o3',
        eventId: 'e3',
        label: 'CeeDee Lamb Receiving Yards',
        outcomes: [outcome('Over 72.5', 72.5, '-115')],
      }],
    }));
  };
  const result = await fetchDraftKingsSportsbookPublic('NFL', { fetcher, force: true });
  assert.equal(result.records.length, 0, 'an over with no under is not a usable line');
});
