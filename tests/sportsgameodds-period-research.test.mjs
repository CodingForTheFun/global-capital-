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


test('SportsGameOdds fills source-qualified fantasy charts from exact graded market scores', async (t) => {
  const previousKey = process.env.SPORTS_ODDS_API_KEY_HEADER;
  const previousDisabled = process.env.SPORTSGAMEODDS_DISABLED;
  const previousFetch = globalThis.fetch;

  process.env.SPORTS_ODDS_API_KEY_HEADER = 'test-fantasy-key';
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
      playerName: 'Fantasy Player',
      team: 'Home Team',
      gameStartTime: currentStart,
      marketId: 'player_fantasy_score',
      market: 'Fantasy Score',
      period: 'game',
      sportsGameOddsPlayerId: 'PLAYER_FANTASY_NBA',
      sportsGameOddsEventId: 'CURRENT_FANTASY_EVENT',
      sportsGameOddsLeagueId: 'NBA',
      statId: 'fantasyScore',
      side: 'OVER',
      line: 42.5,
      sportsbookKey: 'underdog',
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
        data: [
          {
            eventID: 'GRADED_FANTASY_EVENT',
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
              PLAYER_FANTASY_NBA: { name: 'Fantasy Player', teamID: 'HOME_NBA' },
            },
            odds: {
              fantasy: {
                statID: 'fantasyScore',
                statEntityID: 'PLAYER_FANTASY_NBA',
                periodID: 'game',
                betTypeID: 'ou',
                score: 44.75,
                scoringSupported: true,
              },
            },
            // Deliberately different: fantasy research must use the dedicated
            // graded market score instead of reinterpreting a generic result.
            results: {
              game: {
                PLAYER_FANTASY_NBA: { fantasyScore: 999 },
              },
            },
          },
          {
            eventID: 'UNSUPPORTED_FANTASY_SCORING',
            status: {
              finalized: true,
              ended: true,
              startsAt: '2026-09-08T00:00:00.000Z',
            },
            teams: {
              home: { teamID: 'HOME_NBA', names: { long: 'Home Team' } },
              away: { teamID: 'AWAY_NBA', names: { long: 'Away Team' } },
            },
            players: {
              PLAYER_FANTASY_NBA: { name: 'Fantasy Player', teamID: 'HOME_NBA' },
            },
            odds: {
              fantasy: {
                statID: 'fantasyScore',
                statEntityID: 'PLAYER_FANTASY_NBA',
                periodID: 'game',
                betTypeID: 'ou',
                score: 51,
                scoringSupported: false,
              },
            },
            results: {
              game: {
                PLAYER_FANTASY_NBA: { fantasyScore: 51 },
              },
            },
          },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    throw new Error('Unexpected SportsGameOdds fantasy test URL: ' + url);
  };

  const result = await fetchSportsGameOddsResearch({
    sport: 'NBA',
    playerName: 'Fantasy Player',
    team: 'Home Team',
    gameStartTime: currentStart,
    providerMarketKey: 'underdog:player_fantasy_score',
    market: 'Fantasy Score',
    period: 'game',
    line: 42.5,
    side: 'OVER',
    games: 5,
  });

  assert.equal(result?.available, true);
  assert.equal(result?.source, 'SportsGameOdds results');
  assert.equal(result?.gameLog?.length, 1);
  assert.equal(result?.gameLog?.[0]?.value, 44.75);
  assert.equal(result?.coverage?.gradedMarketOnly, true);
  assert.equal(result?.coverage?.exactStatId, 'fantasyScore');

  const eventCall = calls.find((url) => url.includes('/events'));
  assert.ok(eventCall);
  const parsed = new URL(eventCall);
  assert.equal(parsed.searchParams.get('oddID'), 'fantasyScore-PLAYER_FANTASY_NBA-game-ou-over');
});
