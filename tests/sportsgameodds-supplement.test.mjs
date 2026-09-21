import test from 'node:test';
import assert from 'node:assert/strict';
import { __resetSportsGameOddsClient } from '../lib/data-sources/sportsgameodds/client.mjs';
import { __resetSportsGameOddsProvider } from '../lib/autoscout/providers/sportsgameodds.mjs';
import {
  __resetSportsGameOddsSupplement,
  maybeRefreshSportsGameOddsSupplement,
  mergeCachedSportsGameOdds,
  sportsGameOddsIdentityFor,
} from '../lib/ingestion/sportsgameodds-supplement.mjs';

function sgoEvent(startsAt) {
  const updated = new Date().toISOString();
  const odd = (side) => ({
    oddID: `points-PLAYER_1_NBA-game-ou-${side}`,
    statID: 'points',
    statEntityID: 'PLAYER_1_NBA',
    periodID: 'game',
    betTypeID: 'ou',
    sideID: side,
    marketName: 'Points',
    fairOdds: '-105',
    fairOverUnder: '24.5',
    bookOverUnder: '24.5',
    byBookmaker: {
      draftkings: { available: true, odds: '-110', overUnder: '24.5', lastUpdatedAt: updated },
      fanduel: { available: true, odds: '-108', overUnder: '24.5', lastUpdatedAt: updated },
    },
  });
  return {
    eventID: 'sgo-event',
    sportID: 'BASKETBALL',
    leagueID: 'NBA',
    status: { startsAt, started: false, ended: false, finalized: false },
    teams: {
      home: { teamID: 'HOME_NBA', names: { long: 'Home Team' } },
      away: { teamID: 'AWAY_NBA', names: { long: 'Away Team' } },
    },
    players: {
      PLAYER_1_NBA: { name: 'Test Player', teamID: 'HOME_NBA', position: 'PG' },
    },
    odds: {
      'points-PLAYER_1_NBA-game-ou-over': odd('over'),
      'points-PLAYER_1_NBA-game-ou-under': odd('under'),
    },
  };
}

function baseBoard(startsAt) {
  const now = new Date().toISOString();
  return {
    props: [{
      id: 'base-dk-over',
      source: 'PropLine',
      provider: 'propline',
      sport: 'NBA',
      eventId: 'base-event',
      playerId: 'base-player',
      providerPlayerId: 'propline-player',
      playerName: 'Test Player',
      team: 'Home Team',
      position: 'PG',
      marketId: 'player_points',
      market: 'Points',
      period: 'game',
      side: 'OVER',
      line: 25.5,
      price: -115,
      sportsbook: 'DraftKings',
      sportsbookKey: 'draftkings',
      gameStartTime: startsAt,
      homeTeam: 'Home Team',
      awayTeam: 'Away Team',
      live: false,
      completed: false,
      isAlternate: false,
      ingestedAt: now,
      providerUpdatedAt: now,
      updatedAt: now,
    }],
    data: { events: [], players: [], props: [], lines: [] },
    meta: {
      provider: 'PropLine',
      fetchedAt: now,
      ingestionTimestamp: now,
      sportsbooks: ['draftkings'],
      sportsbookCount: 1,
      lineCount: 1,
      propCount: 1,
      events: 1,
    },
  };
}

test('SportsGameOdds supplement fills missing slots without replacing primary quotes', async () => {
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.SPORTS_ODDS_API_KEY_HEADER;
  const oldDisabled = process.env.SPORTSGAMEODDS_DISABLED;
  const oldSupplementDisabled = process.env.SPORTSGAMEODDS_SUPPLEMENT_DISABLED;
  const startsAt = new Date(Date.now() + 2 * 60 * 60_000).toISOString();

  process.env.SPORTS_ODDS_API_KEY_HEADER = 'test-key';
  delete process.env.SPORTSGAMEODDS_DISABLED;
  delete process.env.SPORTSGAMEODDS_SUPPLEMENT_DISABLED;
  __resetSportsGameOddsClient();
  __resetSportsGameOddsProvider();
  __resetSportsGameOddsSupplement();

  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/account/usage')) {
      return new Response(JSON.stringify({
        success: true,
        data: {
          tier: 'rookie',
          rateLimits: {
            'per-month': { 'max-entities': 100000, 'current-entities': 1000 },
          },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname.endsWith('/events')) {
      return new Response(JSON.stringify({
        success: true,
        data: [sgoEvent(startsAt)],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error('Unexpected SportsGameOdds test URL: ' + url);
  };

  try {
    const base = baseBoard(startsAt);
    // First read records demand but has no paid cache yet.
    assert.equal(mergeCachedSportsGameOdds(base, 'NBA').props.length, 1);

    const refresh = await maybeRefreshSportsGameOddsSupplement();
    assert.equal(refresh.skipped, false);
    assert.equal(refresh.sport, 'NBA');
    assert.equal(refresh.events, 1);

    const merged = mergeCachedSportsGameOdds(base, 'NBA');
    const dkOvers = merged.props.filter((row) => row.sportsbookKey === 'draftkings' && row.side === 'OVER');
    assert.equal(dkOvers.length, 1);
    assert.equal(dkOvers[0].line, 25.5);
    assert.equal(dkOvers[0].price, -115);
    assert.equal(dkOvers[0].sportsGameOddsPlayerId, 'PLAYER_1_NBA');

    const fanduelOver = merged.props.find((row) => row.sportsbookKey === 'fanduel' && row.side === 'OVER');
    assert.ok(fanduelOver);
    assert.equal(fanduelOver.line, 24.5);
    assert.equal(fanduelOver.eventId, 'base-event');
    assert.equal(fanduelOver.playerId, 'base-player');

    assert.ok(merged.props.some((row) => row.sportsbookKey === 'draftkings' && row.side === 'UNDER'));
    assert.ok(merged.props.some((row) => row.sportsbookKey === 'fanduel' && row.side === 'UNDER'));
    assert.equal(merged.meta.sportsGameOddsSupplement.added, 3);
    assert.equal(merged.meta.sportsGameOddsSupplement.enriched, 1);

    const pointsIdentity = sportsGameOddsIdentityFor({
      sport: 'NBA', playerName: 'Test Player', team: 'Home Team', gameStartTime: startsAt,
      marketKey: 'player_points', marketName: 'Points',
    });
    assert.equal(pointsIdentity?.statId, 'points');
    assert.equal(sportsGameOddsIdentityFor({
      sport: 'NBA', playerName: 'Test Player', team: 'Home Team', gameStartTime: startsAt,
      marketKey: 'player_assists', marketName: 'Assists',
    }), null);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.SPORTS_ODDS_API_KEY_HEADER;
    else process.env.SPORTS_ODDS_API_KEY_HEADER = oldKey;
    if (oldDisabled === undefined) delete process.env.SPORTSGAMEODDS_DISABLED;
    else process.env.SPORTSGAMEODDS_DISABLED = oldDisabled;
    if (oldSupplementDisabled === undefined) delete process.env.SPORTSGAMEODDS_SUPPLEMENT_DISABLED;
    else process.env.SPORTSGAMEODDS_SUPPLEMENT_DISABLED = oldSupplementDisabled;
    __resetSportsGameOddsClient();
    __resetSportsGameOddsProvider();
    __resetSportsGameOddsSupplement();
  }
});
