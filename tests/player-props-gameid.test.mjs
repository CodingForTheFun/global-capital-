import test from 'node:test';
import assert from 'node:assert/strict';
import { createSportsDataIoAdapter } from '../lib/data-sources/sportsdataio/index.mjs';

const KEY = 'test-key-not-a-real-credential';

function router(routes = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    for (const [fragment, payload] of Object.entries(routes)) {
      if (!url.includes(fragment)) continue;
      const value = typeof payload === 'function' ? payload(url) : payload;
      if (value && typeof value === 'object' && '__status' in value) {
        return { ok: false, status: value.__status, headers: { get: () => null }, json: async () => ({}) };
      }
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => value };
    }
    return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function prizePicksMarket() {
  return [{
    BettingMarketID: 9001,
    BettingMarketType: 'Player Prop',
    BettingBetType: 'Total Hits',
    PlayerID: 42,
    PlayerName: 'Alpha Beta',
    BettingOutcomes: [
      { BettingOutcomeID: 1, SportsBook: { Name: 'PrizePicks' }, BettingOutcomeType: 'Over', Value: 1.5, IsAvailable: true, IsAlternate: false },
      { BettingOutcomeID: 2, SportsBook: { Name: 'PrizePicks' }, BettingOutcomeType: 'Under', Value: 1.5, IsAvailable: true, IsAlternate: false },
    ],
  }];
}

test.beforeEach(() => { process.env.SPORTSDATAIO_API_KEY = KEY; });
test.after(() => { delete process.env.SPORTSDATAIO_API_KEY; });

test('player props are requested by the actual GameID, never by date', async () => {
  const fetchImpl = router({
    'GamesByDate': [{ GameID: 777, DateTime: '2026-09-09T19:10:00Z', HomeTeam: 'LAD', AwayTeam: 'COL' }],
    'BettingPlayerPropsByGameID/777?include=available': prizePicksMarket(),
  });
  const adapter = createSportsDataIoAdapter({ fetchImpl, now: () => new Date('2026-09-09T12:00:00Z') });
  const coverage = await adapter.operatorCoverage({ sportsbook: 'PrizePicks', sports: ['MLB'] });

  assert.equal(coverage.rows.length, 1);
  assert.equal(coverage.rows[0].gamesChecked, 1);
  assert.equal(coverage.rows[0].targetSeen, true);
  assert.equal(coverage.rows[0].targetOffers, 2);
  assert.ok(fetchImpl.calls.some((call) => call.url.includes('/BettingPlayerPropsByGameID/777?include=available')));
  assert.ok(!fetchImpl.calls.some((call) => call.url.includes('PlayerPropsByDate')), 'deprecated date feed must never be called');
  assert.ok(!fetchImpl.calls.some((call) => /BettingPlayerPropsByGameID\/(?:0|1)(?:\?|$)/.test(call.url)), 'game IDs are never guessed');
});

test('when the games feed has no GameID, Scout Pro makes no player-props request', async () => {
  const fetchImpl = router({
    'GamesByDate': [{ DateTime: '2026-09-09T19:10:00Z', HomeTeam: 'LAD', AwayTeam: 'COL' }],
  });
  const adapter = createSportsDataIoAdapter({ fetchImpl, now: () => new Date('2026-09-09T12:00:00Z') });
  const coverage = await adapter.operatorCoverage({ sportsbook: 'PrizePicks', sports: ['MLB'] });

  assert.equal(coverage.rows[0].gamesChecked, 0);
  assert.equal(coverage.rows[0].targetSeen, false);
  assert.ok(!fetchImpl.calls.some((call) => call.url.includes('BettingPlayerPropsByGameID')));
});
