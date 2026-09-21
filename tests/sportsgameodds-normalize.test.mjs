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
  assert.equal(canonicalSportsGameOddsMarketKey('fantasyScore', 'NBA'), 'player_fantasy_score');
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

function fantasyEvent({ leagueID = 'NBA', sportID = 'BASKETBALL', position = 'PG' } = {}) {
  const event = sampleEvent();
  event.leagueID = leagueID;
  event.sportID = sportID;
  event.players.PLAYER_1_NBA.position = position;
  const updated = new Date().toISOString();
  const odd = (side) => ({
    oddID: `fantasyScore-PLAYER_1_NBA-game-ou-${side}`,
    statID: 'fantasyScore',
    statEntityID: 'PLAYER_1_NBA',
    periodID: 'game',
    betTypeID: 'ou',
    sideID: side,
    marketName: 'Fantasy Score',
    bookOverUnder: '45.5',
    byBookmaker: {
      prizepicks: { available: true, overUnder: '45.5', lastUpdatedAt: updated },
      underdog: { available: true, overUnder: '45.5', lastUpdatedAt: updated },
    },
  });
  event.odds = {
    'fantasy-over': odd('over'),
    'fantasy-under': odd('under'),
  };
  return event;
}

test('SportsGameOdds Fantasy Score lines use canonical DFS market identities', () => {
  const board = normalizeSportsGameOddsEvents([fantasyEvent()], { requestedSport: 'NBA' });
  assert.equal(board.props.length, 4);

  const prizePicks = board.props.find((row) => row.sportsbookKey === 'prizepicks' && row.side === 'OVER');
  const underdog = board.props.find((row) => row.sportsbookKey === 'underdog' && row.side === 'OVER');
  assert.ok(prizePicks);
  assert.ok(underdog);
  assert.equal(prizePicks.marketId, 'prizepicks:player_fantasy_score');
  assert.equal(underdog.marketId, 'player_fantasy_score');
  assert.equal(prizePicks.statId, 'fantasyScore');
  assert.equal(prizePicks.line, 45.5);
  assert.equal(prizePicks.price, null);
});

test('SportsGameOdds preserves PrizePicks MLB pitcher Fantasy Score identity', () => {
  const board = normalizeSportsGameOddsEvents([
    fantasyEvent({ leagueID: 'MLB', sportID: 'BASEBALL', position: 'P' }),
  ], { requestedSport: 'MLB' });
  const prizePicks = board.props.find((row) => row.sportsbookKey === 'prizepicks' && row.side === 'OVER');
  assert.ok(prizePicks);
  assert.equal(prizePicks.marketId, 'prizepicks:player_pitcher_fantasy_score');
  assert.equal(prizePicks.line, 45.5);
});


// A book that posted no line of its own must contribute no line. The normalizer
// used to fall back to `bookOverUnder` (the consensus) and then
// `fairOverUnder` (a derived number) and publish whichever it found AS this
// book's line — while still pairing it with this book's real price. That put a
// line on a card the named book never offered, and turned a modelled number
// into a PrizePicks projection. Both values are still kept, as `consensusLine`
// and `fairLine`, where they say what they are.
test('a bookmaker without its own line contributes none, and never the consensus or fair line', () => {
  const event = sampleEvent();
  for (const side of ['over', 'under']) {
    const odd = event.odds[`points-PLAYER_1_NBA-game-ou-${side}`];
    odd.fairOverUnder = '30.5';
    odd.bookOverUnder = '29.5';
    delete odd.byBookmaker.draftkings.overUnder;
    odd.byBookmaker.draftkings.altLines = [];
  }

  const board = normalizeSportsGameOddsEvents([event], { requestedSport: 'NBA' });
  const dk = board.props.filter((row) => row.sportsbookKey === 'draftkings');
  assert.equal(dk.length, 0, 'a book with no line of its own must produce no priced row');
  assert.ok(board.meta.skipped.noLine >= 1, 'the skip is counted rather than silently filled in');
});

// The ordinary case must keep working: a book that did post a line still gets
// exactly that line, and the consensus and fair values stay in their own fields.
test('a bookmaker with its own line still produces it', () => {
  const event = sampleEvent();
  for (const side of ['over', 'under']) {
    event.odds[`points-PLAYER_1_NBA-game-ou-${side}`].byBookmaker.draftkings.overUnder = '26.5';
  }
  const board = normalizeSportsGameOddsEvents([event], { requestedSport: 'NBA' });
  const over = board.props.find((row) => row.sportsbookKey === 'draftkings' && row.side === 'OVER');
  assert.ok(over, 'the book\'s own row must survive');
  assert.equal(over.line, 26.5);
  assert.equal(over.fairLine, 24.5, 'the fair line keeps its own field');
});
