import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalSportsGameOddsMarketKey,
  normalizeSportsGameOddsEvents,
  sportsGameOddsSportForLeague,
} from '../lib/data-sources/sportsgameodds/normalize.mjs';

function sampleEvent() {
  const startsAt = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
  return {
    eventID: 'sgo-event-1',
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
      'points-PLAYER_1_NBA-game-ou-over': {
        oddID: 'points-PLAYER_1_NBA-game-ou-over',
        statID: 'points',
        statEntityID: 'PLAYER_1_NBA',
        periodID: 'game',
        betTypeID: 'ou',
        sideID: 'over',
        marketName: 'Points',
        fairOdds: '-105',
        fairOverUnder: '24.5',
        bookOverUnder: '24.5',
        byBookmaker: {
          draftkings: {
            available: true,
            odds: '-110',
            overUnder: '24.5',
            lastUpdatedAt: new Date().toISOString(),
            deeplink: 'https://example.com/dk',
            altLines: [{ available: true, odds: '+100', overUnder: '25.5' }],
          },
          fanduel: { available: false, odds: '-108', overUnder: '24.5' },
        },
      },
      'points-PLAYER_1_NBA-game-ou-under': {
        oddID: 'points-PLAYER_1_NBA-game-ou-under',
        statID: 'points',
        statEntityID: 'PLAYER_1_NBA',
        periodID: 'game',
        betTypeID: 'ou',
        sideID: 'under',
        marketName: 'Points',
        fairOdds: '-105',
        fairOverUnder: '24.5',
        bookOverUnder: '24.5',
        byBookmaker: {
          draftkings: {
            available: true,
            odds: '-110',
            overUnder: '24.5',
            lastUpdatedAt: new Date().toISOString(),
          },
        },
      },
      'points-all-game-ou-over': {
        oddID: 'points-all-game-ou-over',
        statID: 'points',
        statEntityID: 'all',
        periodID: 'game',
        betTypeID: 'ou',
        sideID: 'over',
        byBookmaker: { draftkings: { available: true, odds: '-110', overUnder: '220.5' } },
      },
    },
  };
}

test('SportsGameOdds maps league and sport-specific stat semantics', () => {
  assert.equal(sportsGameOddsSportForLeague('UEFA_CHAMPIONS_LEAGUE', 'SOCCER'), 'UCL');
  assert.equal(sportsGameOddsSportForLeague('ATP', 'TENNIS'), 'TENNIS');
  assert.equal(canonicalSportsGameOddsMarketKey('points', 'NBA'), 'player_points');
  assert.equal(canonicalSportsGameOddsMarketKey('points', 'MLB'), 'batter_runs');
  assert.equal(canonicalSportsGameOddsMarketKey('points', 'NHL'), 'player_goals');
  assert.equal(canonicalSportsGameOddsMarketKey('fieldGoals_made', 'NFL'), 'player_field_goals');
});

test('SportsGameOdds normalizer keeps only available player O/U quotes', () => {
  const board = normalizeSportsGameOddsEvents([sampleEvent()], { requestedSport: 'NBA' });
  assert.equal(board.data.events.length, 1);
  assert.equal(board.data.players.length, 1);
  assert.equal(board.data.props.length, 1);
  assert.equal(board.data.lines.length, 2);
  assert.equal(board.props.length, 2);

  const over = board.props.find((row) => row.side === 'OVER');
  assert.ok(over);
  assert.equal(over.playerName, 'Test Player');
  assert.equal(over.team, 'Home Team');
  assert.equal(over.marketId, 'player_points');
  assert.equal(over.line, 24.5);
  assert.equal(over.price, -110);
  assert.equal(over.sportsbookKey, 'draftkings');
  assert.equal(over.sportsGameOddsPlayerId, 'PLAYER_1_NBA');
  assert.equal(over.sportsGameOddsLeagueId, 'NBA');
  assert.equal(over.sportsGameOddsOddId, 'points-PLAYER_1_NBA-game-ou-over');
  assert.equal(over.fairLine, 24.5);
  assert.equal(board.props.some((row) => row.sportsbookKey === 'fanduel'), false);
  assert.equal(board.props.some((row) => row.isAlternate), false);
  assert.equal(board.meta.skipped.teamMarket, 1);
  assert.equal(board.meta.skipped.unavailable, 1);
});

test('SportsGameOdds alternate lines are opt-in', () => {
  const board = normalizeSportsGameOddsEvents([sampleEvent()], {
    requestedSport: 'NBA',
    includeAlternates: true,
  });
  const alts = board.props.filter((row) => row.isAlternate === true);
  assert.equal(alts.length, 1);
  assert.equal(alts[0].line, 25.5);
  assert.equal(alts[0].side, 'OVER');
});
