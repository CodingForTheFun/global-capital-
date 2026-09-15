import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchDraftKingsSportsbookPublic } from '../lib/ingestion/draftkings-sportsbook-public.mjs';

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function sportscontentFetcher(payloadForSubcategory) {
  return async (url) => {
    const parsed = new URL(String(url));
    if (!parsed.pathname.includes('/sportscontent/controldata/league/leagueSubcategory/v1/markets')) return response({}, 404);
    const vars = String(parsed.searchParams.get('templateVars') || '').split(',');
    const subcategoryId = vars[1] || '';
    const payload = payloadForSubcategory(subcategoryId);
    return payload ? response(payload) : response({}, 404);
  };
}

test('DraftKings sportscontent keeps a verified two-sided regular player line', async () => {
  const start = new Date(Date.now() + 86_400_000).toISOString();
  const payload = {
    events: [{ id: 'e1', name: 'Kansas City Chiefs @ Buffalo Bills', startEventDate: start }],
    markets: [{ id: 'm1', eventId: 'e1', name: 'Patrick Mahomes Passing Yards O/U', status: 'Open' }],
    selections: [
      { marketId: 'm1', label: 'Over', points: 275.5, displayOdds: { american: '−110' }, participant: 'Patrick Mahomes' },
      { marketId: 'm1', label: 'Under', points: 275.5, displayOdds: { american: '-110' }, participant: 'Patrick Mahomes' },
    ],
  };
  const result = await fetchDraftKingsSportsbookPublic('NFL', { force: true, fetcher: sportscontentFetcher((id) => id === '9524' ? payload : null) });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].book, 'draftkings');
  assert.equal(result.records[0].playerName, 'Patrick Mahomes');
  assert.equal(result.records[0].market, 'Passing Yards');
  assert.equal(result.records[0].line, 275.5);
  assert.equal(result.records[0].overOdds, -110);
  assert.equal(result.records[0].underOdds, -110);
  assert.match(result.transport, /draftkings-sportscontent/);
});

test('DraftKings sportscontent rejects an alternate ladder with multiple complete thresholds', async () => {
  const start = new Date(Date.now() + 86_400_000).toISOString();
  const payload = {
    events: [{ id: 'e2', name: 'Los Angeles Lakers @ Boston Celtics', startEventDate: start }],
    markets: [
      { id: 'm21', eventId: 'e2', name: 'LeBron James Points O/U', status: 'Open' },
      { id: 'm22', eventId: 'e2', name: 'LeBron James Points O/U', status: 'Open' },
    ],
    selections: [
      { marketId: 'm21', label: 'Over', points: 25.5, displayOdds: { american: '-110' }, participant: 'LeBron James' },
      { marketId: 'm21', label: 'Under', points: 25.5, displayOdds: { american: '-110' }, participant: 'LeBron James' },
      { marketId: 'm22', label: 'Over', points: 26.5, displayOdds: { american: '+105' }, participant: 'LeBron James' },
      { marketId: 'm22', label: 'Under', points: 26.5, displayOdds: { american: '-125' }, participant: 'LeBron James' },
    ],
  };
  const result = await fetchDraftKingsSportsbookPublic('NBA', { force: true, fetcher: sportscontentFetcher((id) => id === '12488' ? payload : null) });
  assert.equal(result.records.length, 0);
});

test('DraftKings sportscontent rejects one-sided markets', async () => {
  const start = new Date(Date.now() + 86_400_000).toISOString();
  const payload = {
    events: [{ id: 'e3', name: 'New York Yankees @ Boston Red Sox', startEventDate: start }],
    markets: [{ id: 'm3', eventId: 'e3', name: 'Gerrit Cole Strikeouts O/U', status: 'Open' }],
    selections: [{ marketId: 'm3', label: 'Over', points: 6.5, displayOdds: { american: '-115' }, participant: 'Gerrit Cole' }],
  };
  const result = await fetchDraftKingsSportsbookPublic('MLB', { force: true, fetcher: sportscontentFetcher((id) => id === '15221' ? payload : null) });
  assert.equal(result.records.length, 0);
});

test('DraftKings retains legacy v5 fallback when sportscontent is unavailable', async () => {
  const start = new Date(Date.now() + 86_400_000).toISOString();
  const fetcher = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.pathname.includes('/sportscontent/controldata/league/leagueSubcategory/v1/markets')) return response({}, 403);
    if (parsed.pathname.includes('/api/v5/eventgroups/88808')) return response({ eventGroup: {
      events: [{ eventId: 'e4', name: 'Kansas City Chiefs @ Buffalo Bills', startDate: start }],
      offerCategories: [{ name: 'Player Props', offerSubcategoryDescriptors: [{ name: 'Passing Props', offerSubcategory: { offers: [[{
        id: 'o4', eventId: 'e4', label: 'Patrick Mahomes Passing Yards', outcomes: [
          { label: 'Over', line: 275.5, oddsAmerican: -110 },
          { label: 'Under', line: 275.5, oddsAmerican: -110 },
        ],
      }]] } }] }],
    } });
    return response({}, 404);
  };
  const result = await fetchDraftKingsSportsbookPublic('NFL', { force: true, fetcher });
  assert.equal(result.records.length, 1);
  assert.match(result.transport, /draftkings-v5/);
});
