import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchDraftKingsSportsContentPublic } from '../lib/ingestion/draftkings-sportscontent-public.mjs';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}
function currentFetcher(payloadForSubcategory, seen = []) {
  return async (url) => {
    const parsed = new URL(String(url));
    seen.push(parsed);
    if (!parsed.pathname.includes('/sites/') || !parsed.pathname.includes('/api/sportscontent/controldata/league/leagueSubcategory/v1/markets')) return json({}, 404);
    const [leagueId, subcategoryId] = String(parsed.searchParams.get('templateVars') || '').split(',');
    const payload = payloadForSubcategory({ leagueId, subcategoryId, site: parsed.pathname.split('/')[2] });
    return payload ? json(payload) : json({}, 404);
  };
}

test('DraftKings current SportsContent normalizes a complete main over/under player prop', async () => {
  const seen = [];
  const payload = {
    events: [{ id: 'e1', name: 'KC Chiefs @ BUF Bills', startEventDate: '2099-09-15T23:00:00Z' }],
    markets: [{ id: 'm1', eventId: 'e1', name: 'Patrick Mahomes Passing Yards O/U' }],
    selections: [
      { marketId: 'm1', label: 'Over 275.5', points: 275.5, displayOdds: { american: '+105' }, participant: 'Patrick Mahomes' },
      { marketId: 'm1', label: 'Under 275.5', points: 275.5, displayOdds: { american: '−125' }, participant: 'Patrick Mahomes' },
    ],
  };
  const fetcher = currentFetcher(({ leagueId, subcategoryId }) => leagueId === '88808' && subcategoryId === '9524' ? payload : null, seen);
  const result = await fetchDraftKingsSportsContentPublic('NFL', { fetcher, force: true });
  assert.equal(result.records.length, 1);
  const row = result.records[0];
  assert.equal(row.book, 'draftkings');
  assert.equal(row.sport, 'NFL');
  assert.equal(row.playerName, 'Patrick Mahomes');
  assert.equal(row.market, 'Passing Yards');
  assert.equal(row.line, 275.5);
  assert.equal(row.overOdds, 105);
  assert.equal(row.underOdds, -125);
  assert.deepEqual(row.sides, ['OVER', 'UNDER']);
  assert.equal(row.nativeEventId, 'e1');
  assert.equal(result.categoriesChecked, 1);
  assert.ok(seen.some((url) => url.pathname.includes('/sites/US-NJ-SB/api/sportscontent/controldata/league/leagueSubcategory/v1/markets')));
});

test('DraftKings current SportsContent can use the selection participant when the market name is generic', async () => {
  const payload = {
    events: [{ id: 'e2', name: 'KC Chiefs @ BUF Bills', startEventDate: '2099-09-15T23:00:00Z' }],
    markets: [{ id: 'm2', eventId: 'e2', name: 'Passing Yards O/U' }],
    selections: [
      { marketId: 'm2', label: 'Over', points: 250.5, displayOdds: { american: '-110' }, participant: 'Josh Allen' },
      { marketId: 'm2', label: 'Under', points: 250.5, displayOdds: { american: '-110' }, participant: 'Josh Allen' },
    ],
  };
  const result = await fetchDraftKingsSportsContentPublic('NFL', { fetcher: currentFetcher(({ subcategoryId }) => subcategoryId === '9524' ? payload : null), force: true });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].playerName, 'Josh Allen');
});

test('DraftKings current SportsContent fails closed on alternate ladders', async () => {
  const payload = {
    events: [{ id: 'e3', name: 'LAL Lakers @ BOS Celtics', startEventDate: '2099-09-15T23:00:00Z' }],
    markets: [
      { id: 'm31', eventId: 'e3', name: 'LeBron James Points O/U' },
      { id: 'm32', eventId: 'e3', name: 'LeBron James Points O/U' },
    ],
    selections: [
      { marketId: 'm31', label: 'Over', points: 25.5, displayOdds: { american: '-110' }, participant: 'LeBron James' },
      { marketId: 'm31', label: 'Under', points: 25.5, displayOdds: { american: '-110' }, participant: 'LeBron James' },
      { marketId: 'm32', label: 'Over', points: 26.5, displayOdds: { american: '+105' }, participant: 'LeBron James' },
      { marketId: 'm32', label: 'Under', points: 26.5, displayOdds: { american: '-125' }, participant: 'LeBron James' },
    ],
  };
  await assert.rejects(
    fetchDraftKingsSportsContentPublic('NBA', { fetcher: currentFetcher(({ subcategoryId }) => subcategoryId === '12488' ? payload : null), force: true }),
    (error) => error?.code === 'DRAFTKINGS_SPORTSCONTENT_NO_PROPS',
  );
});

test('DraftKings current SportsContent fails closed on one-sided threshold markets', async () => {
  const payload = {
    events: [{ id: 'e4', name: 'NY Mets @ ATL Braves', startEventDate: '2099-09-15T23:00:00Z' }],
    markets: [{ id: 'm4', eventId: 'e4', name: 'Gerrit Cole Strikeouts O/U' }],
    selections: [{ marketId: 'm4', label: 'Over 6.5', points: 6.5, displayOdds: { american: '-115' }, participant: 'Gerrit Cole' }],
  };
  await assert.rejects(
    fetchDraftKingsSportsContentPublic('MLB', { fetcher: currentFetcher(({ subcategoryId }) => subcategoryId === '15221' ? payload : null), force: true }),
    (error) => error?.code === 'DRAFTKINGS_SPORTSCONTENT_NO_PROPS',
  );
});
