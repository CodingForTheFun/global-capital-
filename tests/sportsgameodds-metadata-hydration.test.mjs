import test from 'node:test';
import assert from 'node:assert/strict';

import { __resetSportsGameOddsClient } from '../lib/data-sources/sportsgameodds/client.mjs';
import {
  __resetSportsGameOddsProvider,
  fetchSportsGameOddsBoard,
} from '../lib/autoscout/providers/sportsgameodds.mjs';

function usageResponse(used = 1000) {
  return new Response(JSON.stringify({
    success: true,
    data: {
      tier: 'rookie',
      rateLimits: {
        'per-month': { 'max-entities': 100000, 'current-entities': used },
      },
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function json(data) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function baseEvent({ complete = false } = {}) {
  const startsAt = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
  const odd = (side) => ({
    oddID: `points-PLAYER_1_NBA-game-ou-${side}`,
    statID: 'points',
    statEntityID: 'PLAYER_1_NBA',
    periodID: 'game',
    betTypeID: 'ou',
    sideID: side,
    ...(complete ? { marketName: 'Points' } : {}),
    bookOverUnder: '24.5',
    byBookmaker: {
      draftkings: {
        available: true,
        odds: '-110',
        overUnder: '24.5',
        lastUpdatedAt: new Date().toISOString(),
      },
    },
  });

  return {
    eventID: 'sgo-event-gap',
    sportID: 'BASKETBALL',
    leagueID: 'NBA',
    status: { startsAt, started: false, ended: false, finalized: false },
    teams: complete
      ? {
          home: { teamID: 'HOME_NBA', names: { long: 'Home Team' } },
          away: { teamID: 'AWAY_NBA', names: { long: 'Away Team' } },
        }
      : {
          home: { teamID: 'HOME_NBA' },
          away: { teamID: 'AWAY_NBA' },
        },
    players: complete
      ? { PLAYER_1_NBA: { playerID: 'PLAYER_1_NBA', names: { display: 'Test Player' }, teamID: 'HOME_NBA', position: 'PG' } }
      : {},
    odds: {
      'points-PLAYER_1_NBA-game-ou-over': odd('over'),
      'points-PLAYER_1_NBA-game-ou-under': odd('under'),
    },
  };
}

function saveEnv(keys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(saved) {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const envKeys = [
  'SPORTS_ODDS_API_KEY_HEADER',
  'SPORTSGAMEODDS_METADATA_HYDRATION_DISABLED',
  'SPORTSGAMEODDS_METADATA_PLAYER_EVENTS',
  'SPORTSGAMEODDS_METADATA_TEAM_IDS',
  'SPORTSGAMEODDS_METADATA_MARKET_IDS',
];

test('SportsGameOdds hydrates only missing player, team, and market metadata', async t => {
  const saved = saveEnv(envKeys);
  const oldFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = oldFetch;
    restoreEnv(saved);
    __resetSportsGameOddsClient();
    __resetSportsGameOddsProvider();
  });

  process.env.SPORTS_ODDS_API_KEY_HEADER = 'test-key';
  delete process.env.SPORTSGAMEODDS_METADATA_HYDRATION_DISABLED;
  __resetSportsGameOddsClient();
  __resetSportsGameOddsProvider();

  const calls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname.endsWith('/account/usage')) return usageResponse(1000);
    if (url.pathname.endsWith('/events')) return json([baseEvent()]);
    if (url.pathname.endsWith('/players')) {
      assert.equal(url.searchParams.get('eventID'), 'sgo-event-gap');
      return json([{
        playerID: 'PLAYER_1_NBA',
        sportID: 'BASKETBALL',
        leagueID: 'NBA',
        teamID: 'HOME_NBA',
        position: 'PG',
        names: { display: 'Test Player', firstName: 'Test', lastName: 'Player' },
      }]);
    }
    if (url.pathname.endsWith('/teams')) {
      assert.equal(url.searchParams.get('teamID'), 'HOME_NBA,AWAY_NBA');
      return json([
        { teamID: 'HOME_NBA', sportID: 'BASKETBALL', leagueID: 'NBA', names: { long: 'Home Team', short: 'HOME' } },
        { teamID: 'AWAY_NBA', sportID: 'BASKETBALL', leagueID: 'NBA', names: { long: 'Away Team', short: 'AWAY' } },
      ]);
    }
    if (url.pathname.endsWith('/markets')) {
      assert.equal(url.searchParams.get('isSupported'), 'true');
      return json([
        {
          oddID: 'points-PLAYER_1_NBA-game-ou-over',
          statID: 'points',
          statEntityID: 'PLAYER_1_NBA',
          periodID: 'game',
          betTypeID: 'ou',
          sideID: 'over',
          marketGroupID: 'points-player-game-ou',
          marketGroupName: 'Player Points',
          marketGroupNameBySport: { BASKETBALL: 'Player Points' },
          isProp: true,
          propType: 'player_prop',
          isSubPeriod: false,
          isSupported: true,
        },
        {
          oddID: 'points-PLAYER_1_NBA-game-ou-under',
          statID: 'points',
          statEntityID: 'PLAYER_1_NBA',
          periodID: 'game',
          betTypeID: 'ou',
          sideID: 'under',
          marketGroupID: 'points-player-game-ou',
          marketGroupName: 'Player Points',
          marketGroupNameBySport: { BASKETBALL: 'Player Points' },
          isProp: true,
          propType: 'player_prop',
          isSubPeriod: false,
          isSupported: true,
        },
      ]);
    }
    throw new Error('Unexpected URL: ' + url);
  };

  const board = await fetchSportsGameOddsBoard('NBA', { force: true, eventLimit: 1 });
  assert.equal(board.props.length, 2);
  const over = board.props.find((row) => row.side === 'OVER');
  assert.ok(over);
  assert.equal(over.playerName, 'Test Player');
  assert.equal(over.team, 'Home Team');
  assert.equal(over.homeTeam, 'Home Team');
  assert.equal(over.awayTeam, 'Away Team');
  assert.equal(over.market, 'Player Points');

  assert.equal(board.meta.metadataHydration.reason, 'hydrated_missing_metadata');
  assert.deepEqual(board.meta.metadataHydration.calls, { players: 1, teams: 1, markets: 1 });
  assert.deepEqual(board.meta.metadataHydration.hydrated, { players: 1, teams: 2, markets: 2 });
  assert.equal(calls.filter((path) => path.endsWith('/players')).length, 1);
  assert.equal(calls.filter((path) => path.endsWith('/teams')).length, 1);
  assert.equal(calls.filter((path) => path.endsWith('/markets')).length, 1);
});

test('SportsGameOdds makes no metadata calls when event payload is already complete', async t => {
  const saved = saveEnv(envKeys);
  const oldFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = oldFetch;
    restoreEnv(saved);
    __resetSportsGameOddsClient();
    __resetSportsGameOddsProvider();
  });

  process.env.SPORTS_ODDS_API_KEY_HEADER = 'test-key';
  delete process.env.SPORTSGAMEODDS_METADATA_HYDRATION_DISABLED;
  __resetSportsGameOddsClient();
  __resetSportsGameOddsProvider();

  const calls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname.endsWith('/account/usage')) return usageResponse(1000);
    if (url.pathname.endsWith('/events')) return json([baseEvent({ complete: true })]);
    throw new Error('Metadata endpoint should not be called: ' + url.pathname);
  };

  const board = await fetchSportsGameOddsBoard('NBA', { force: true, eventLimit: 1 });
  assert.equal(board.props.length, 2);
  assert.equal(board.meta.metadataHydration.reason, 'complete_event_metadata');
  assert.deepEqual(board.meta.metadataHydration.calls, { players: 0, teams: 0, markets: 0 });
  assert.equal(calls.length, 2);
});

test('SportsGameOdds skips optional metadata hydration near the monthly reserve', async t => {
  const saved = saveEnv(envKeys);
  const oldFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = oldFetch;
    restoreEnv(saved);
    __resetSportsGameOddsClient();
    __resetSportsGameOddsProvider();
  });

  process.env.SPORTS_ODDS_API_KEY_HEADER = 'test-key';
  delete process.env.SPORTSGAMEODDS_METADATA_HYDRATION_DISABLED;
  __resetSportsGameOddsClient();
  __resetSportsGameOddsProvider();

  const calls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname.endsWith('/account/usage')) return usageResponse(99950);
    if (url.pathname.endsWith('/events')) return json([baseEvent()]);
    throw new Error('Metadata endpoint must not be called near reserve: ' + url.pathname);
  };

  const board = await fetchSportsGameOddsBoard('NBA', { force: true, eventLimit: 1 });
  assert.equal(board.props.length, 0, 'missing identity remains unavailable rather than fabricated');
  assert.equal(board.meta.metadataHydration.reason, 'monthly_reserve');
  assert.deepEqual(board.meta.metadataHydration.calls, { players: 0, teams: 0, markets: 0 });
  assert.equal(calls.length, 2);
});
