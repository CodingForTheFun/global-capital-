import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchSportsGameOddsResearch } from '../lib/data-sources/sportsgameodds/research.mjs';
import { __resetSportsGameOddsClient } from '../lib/data-sources/sportsgameodds/client.mjs';
import { readFileSync } from 'node:fs';

test('research uses exact SportsGameOdds IDs from the live prop without a warm identity cache', async (t) => {
  const previousKey = process.env.SPORTS_ODDS_API_KEY_HEADER;
  const previousDisabled = process.env.SPORTSGAMEODDS_DISABLED;
  const previousFetch = globalThis.fetch;

  process.env.SPORTS_ODDS_API_KEY_HEADER = 'test-key';
  delete process.env.SPORTSGAMEODDS_DISABLED;
  __resetSportsGameOddsClient();

  t.after(() => {
    if (previousKey === undefined) delete process.env.SPORTS_ODDS_API_KEY_HEADER;
    else process.env.SPORTS_ODDS_API_KEY_HEADER = previousKey;
    if (previousDisabled === undefined) delete process.env.SPORTSGAMEODDS_DISABLED;
    else process.env.SPORTSGAMEODDS_DISABLED = previousDisabled;
    globalThis.fetch = previousFetch;
    __resetSportsGameOddsClient();
  });

  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/account/usage')) {
      return new Response(JSON.stringify({
        success: true,
        data: { tier: 'rookie', rateLimits: { 'per-month': { 'max-entities': 100000, 'current-entities': 100 } } },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/events')) {
      return new Response(JSON.stringify({
        success: true,
        data: [{
          eventID: 'PRIOR_EVENT',
          status: { finalized: true, ended: true, startsAt: '2026-09-15T00:00:00.000Z' },
          teams: {
            home: { teamID: 'HOME', names: { long: 'Home Team' } },
            away: { teamID: 'AWAY', names: { long: 'Away Team' } },
          },
          players: {
            SGO_PLAYER_123: { name: 'Exact Player', teamID: 'HOME' },
          },
          odds: {
            points: {
              statID: 'points',
              statEntityID: 'SGO_PLAYER_123',
              periodID: 'game',
              betTypeID: 'ou',
              score: 27,
              scoringSupported: true,
            },
          },
          results: { game: { SGO_PLAYER_123: { points: 27 } } },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error('unexpected url ' + url);
  };

  const result = await fetchSportsGameOddsResearch({
    sport: 'NBA',
    playerName: 'Exact Player',
    team: 'Home Team',
    market: 'Points',
    providerMarketKey: 'player_points',
    period: 'game',
    games: 5,
    sportsGameOddsPlayerId: 'SGO_PLAYER_123',
    sportsGameOddsEventId: 'CURRENT_EVENT',
    sportsGameOddsLeagueId: 'NBA',
    sportsGameOddsStatId: 'points',
  });

  assert.equal(result?.available, true);
  assert.equal(result?.gameLog?.[0]?.value, 27);
  assert.equal(result?.coverage?.exactPlayerId, 'SGO_PLAYER_123');
  assert.equal(result?.coverage?.exactStatId, 'points');

  const eventCall = calls.find((url) => url.includes('/events'));
  assert.ok(eventCall);
  const parsed = new URL(eventCall);
  assert.equal(parsed.searchParams.get('playerID'), 'SGO_PLAYER_123');
  assert.equal(parsed.searchParams.get('leagueID'), 'NBA');
  assert.equal(parsed.searchParams.get('oddID'), 'points-SGO_PLAYER_123-game-ou-over');
});


test('research batch preserves exact SportsGameOdds identity fields for fallback', () => {
  const frontdoor = readFileSync(new URL('../frontdoor-prod.mjs', import.meta.url), 'utf8');
  for (const field of [
    'sportsGameOddsPlayerId',
    'sportsGameOddsEventId',
    'sportsGameOddsLeagueId',
    'sportsGameOddsStatId',
  ]) {
    assert.match(frontdoor, new RegExp(field + ': text\\(raw\\?\\.' + field));
  }
});
