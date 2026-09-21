import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchSportsGameOddsResearch,
  sportsGameOddsPeriodId,
} from '../lib/data-sources/sportsgameodds/research.mjs';
import {
  __resetSportsGameOddsClient,
} from '../lib/data-sources/sportsgameodds/client.mjs';
import {
  __resetSportsGameOddsSupplement,
  rememberSportsGameOddsBoard,
} from '../lib/ingestion/sportsgameodds-supplement.mjs';

test('SportsGameOdds period mapping preserves exact market periods', () => {
  assert.equal(sportsGameOddsPeriodId('game'), 'game');
  assert.equal(sportsGameOddsPeriodId('q1'), '1q');
  assert.equal(sportsGameOddsPeriodId('1Q'), '1q');
  assert.equal(sportsGameOddsPeriodId('h2'), '2h');
  assert.equal(sportsGameOddsPeriodId('p3'), '3p');
  assert.equal(sportsGameOddsPeriodId('i1'), '1i');
  assert.equal(sportsGameOddsPeriodId('f5'), '1ix5');
  assert.equal(sportsGameOddsPeriodId('s2'), '2s');
  assert.equal(sportsGameOddsPeriodId('First Quarter'), '1q');
  assert.equal(sportsGameOddsPeriodId('map1'), null);
});

test('SportsGameOdds period research uses the settled period score, not the full-game score', async (t) => {
  const previousKey = process.env.SPORTS_ODDS_API_KEY_HEADER;
  const previousDisabled = process.env.SPORTSGAMEODDS_DISABLED;
  const previousFetch = globalThis.fetch;

  process.env.SPORTS_ODDS_API_KEY_HEADER = 'test-period-key';
  delete process.env.SPORTSGAMEODDS_DISABLED;
  __resetSportsGameOddsClient();
  __resetSportsGameOddsSupplement();

  t.after(() => {
    if (previousKey === undefined) delete process.env.SPORTS_ODDS_API_KEY_HEADER;
    else process.env.SPORTS_ODDS_API_KEY_HEADER = previousKey;
    if (previousDisabled === undefined) delete process.env.SPORTSGAMEODDS_DISABLED;
    else process.env.SPORTSGAMEODDS_DISABLED = previousDisabled;
    globalThis.fetch = previousFetch;
    __resetSportsGameOddsClient();
    __resetSportsGameOddsSupplement();
  });

  const currentStart = '2026-09-28T00:00:00.000Z';
  rememberSportsGameOddsBoard('NBA', {
    props: [{
      sport: 'NBA',
      playerName: 'Test Player',
      team: 'Home Team',
      gameStartTime: currentStart,
      marketId: 'player_points',
      market: 'Points',
      period: '1q',
      sportsGameOddsPlayerId: 'PLAYER_1_NBA',
      sportsGameOddsEventId: 'CURRENT_EVENT',
      sportsGameOddsLeagueId: 'NBA',
      statId: 'points',
      side: 'OVER',
      line: 7.5,
      sportsbookKey: 'draftkings',
    }],
    meta: { fetchedAt: new Date().toISOString(), stale: false },
  });

  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);

    if (url.includes('/account/usage')) {
      return new Response(JSON.stringify({
        success: true,
        data: {
          tier: 'paid',
          rateLimits: {
            'per-month': {
              'max-entities': 100000,
              'current-entities': 100,
            },
          },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (url.includes('/events')) {
      return new Response(JSON.stringify({
        success: true,
        data: [{
          eventID: 'PAST_EVENT',
          status: {
            finalized: true,
            ended: true,
            startsAt: '2026-09-15T00:00:00.000Z',
          },
          teams: {
            home: { teamID: 'HOME_NBA', names: { long: 'Home Team' } },
            away: { teamID: 'AWAY_NBA', names: { long: 'Away Team' } },
          },
          players: {
            PLAYER_1_NBA: { name: 'Test Player', teamID: 'HOME_NBA' },
          },
          odds: {
            quarter: {
              statID: 'points',
              statEntityID: 'PLAYER_1_NBA',
              periodID: '1q',
              betTypeID: 'ou',
              score: 8,
              scoringSupported: true,
            },
            full: {
              statID: 'points',
              statEntityID: 'PLAYER_1_NBA',
              periodID: 'game',
              betTypeID: 'ou',
              score: 31,
              scoringSupported: true,
            },
          },
          results: {
            '1q': {
              PLAYER_1_NBA: { points: 8 },
            },
            game: {
              PLAYER_1_NBA: { points: 31 },
            },
          },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    throw new Error('Unexpected SportsGameOdds test URL: ' + url);
  };

  const result = await fetchSportsGameOddsResearch({
    sport: 'NBA',
    playerName: 'Test Player',
    team: 'Home Team',
    gameStartTime: currentStart,
    providerMarketKey: 'player_points',
    market: 'Points',
    period: 'q1',
    line: 7.5,
    side: 'OVER',
    games: 5,
  });

  assert.equal(result?.available, true);
  assert.equal(result?.source, 'SportsGameOdds period results');
  assert.equal(result?.coverage?.periodId, '1q');
  assert.equal(result?.gameLog?.[0]?.value, 8);
  assert.notEqual(result?.gameLog?.[0]?.value, 31);

  const eventCall = calls.find((url) => url.includes('/events'));
  assert.ok(eventCall);
  const parsed = new URL(eventCall);
  assert.equal(parsed.searchParams.get('oddID'), 'points-PLAYER_1_NBA-1q-ou-over');
});
