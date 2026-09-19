import test from 'node:test';
import assert from 'node:assert/strict';
import { record, normalizedFeedBoard } from '../lib/ingestion/normalize.mjs';
import { marketContract, statValue } from '../lib/data-sources/espn/stat-contract.mjs';
import { fieldsFor } from '../lib/data-sources/sportsdataio/markets.mjs';
import { propType, categoryOptions } from '../lib/ui/prop-board.mjs';
import { rawStatFor } from '../lib/data-sources/propline/game-research.mjs';

const start = '2026-09-14T19:00:00.000Z';
const at = '2026-09-13T18:30:00.000Z';

function live(overrides = {}) {
  return record({
    sourceId: 'source-1', book: 'prizepicks', nativePlayerId: 'player-1', playerName: 'Fixture Player',
    sport: 'MLB', market: '1ST BF', line: 2.5, gameStartTime: start, updatedAt: at,
    team: 'ARI', opponent: 'TEX', nativeEventId: 'event-1', homeTeam: 'TEX', awayTeam: 'ARI',
    sides: ['OVER','UNDER'], ...overrides,
  });
}

test('live player props survive even when historical research has no contract yet', () => {
  const row = live();
  assert.ok(row);
  assert.equal(row.contract, null);
  assert.equal(row.period, 'first_inning');
  assert.equal(row.fallbackMarketKey, 'player_1st_bf');
  const board = normalizedFeedBoard([row], { props: [] }, at);
  assert.equal(board.props.length, 2);
  assert.equal(board.active_props.length, 1);
  assert.equal(board.props[0].marketId, 'player_1st_bf');
  assert.equal(board.props[0].period, 'first_inning');
});

test('PrizePicks fantasy categories remain visible with exact source identity for verified research', () => {
  const row = live({ sport:'NBA', market:'Fantasy Score', line:42.5, team:'BOS', opponent:'NYK' });
  assert.ok(row);
  assert.equal(row.contract, null);
  const board = normalizedFeedBoard([row], { props: [] }, at);
  assert.equal(board.props[0].marketId, 'prizepicks:player_fantasy_score');
  assert.equal(board.props[0].market, 'Fantasy Score');
});

test('basketball combination props retain their canonical market identities', () => {
  const row = live({ sport:'NBA', market:'Points + Rebounds + Assists', line:38.5, team:'BOS', opponent:'NYK' });
  assert.ok(row?.contract);
  assert.deepEqual(row.contract.fields, ['Points','Rebounds','Assists']);
  const board = normalizedFeedBoard([row], { props: [] }, at);
  assert.equal(board.props[0].marketId, 'player_points_rebounds_assists');
  assert.equal(propType({ sport:'NBA', marketId:board.props[0].marketId, market:board.props[0].market }), 'Points + Rebounds + Assists');
});

test('basketball split rebounds use exact verified fields across ESPN and PropLine', () => {
  const offensive = marketContract({ sport:'WNBA', market:'Offensive Rebounds', providerMarketKey:'player_offensive_rebounds' });
  const defensive = marketContract({ sport:'NBA', market:'Defensive Rebounds', providerMarketKey:'player_defensive_rebounds' });
  assert.deepEqual(offensive.fields, ['OffensiveRebounds']);
  assert.deepEqual(defensive.fields, ['DefensiveRebounds']);
  assert.equal(statValue({ offensiveRebounds:6 }, offensive), 6);
  assert.equal(statValue({ defensiveRebounds:9 }, defensive), 9);
  assert.deepEqual(fieldsFor('WNBA','Offensive Rebounds','player_offensive_rebounds'), ['OffensiveRebounds']);
  assert.deepEqual(fieldsFor('NBA','Defensive Rebounds','player_defensive_rebounds'), ['DefensiveRebounds']);
  assert.equal(rawStatFor({ sport:'WNBA', market:'Offensive Rebounds', providerMarketKey:'player_offensive_rebounds', period:'game' }), 'offensive_rebounds');
  assert.equal(rawStatFor({ sport:'NBA', market:'Defensive Rebounds', providerMarketKey:'player_defensive_rebounds', period:'game' }), 'defensive_rebounds');
});

test('MLB pitches, batters faced and innings pitched use measured source fields', () => {
  const pitches = marketContract({ sport:'MLB', market:'Pitches' });
  const batters = marketContract({ sport:'MLB', market:'Batters Faced' });
  const innings = marketContract({ sport:'MLB', market:'Innings Pitched' });
  assert.deepEqual(pitches.fields, ['PitchesThrown']);
  assert.deepEqual(batters.fields, ['BattersFaced']);
  assert.deepEqual(innings.fields, ['InningsPitched']);
  assert.equal(statValue({ pitches:96 }, pitches), 96);
  assert.equal(statValue({ battersFaced:24 }, batters), 24);
  assert.equal(statValue({ innings:'5.2' }, innings), 5.667);
});

test('tennis market catalog covers the major live research categories without guessing missing values', () => {
  assert.deepEqual(fieldsFor('TENNIS','Games Lost'), ['GamesLost']);
  assert.deepEqual(fieldsFor('TENNIS','Total Sets'), ['SetsWon','SetsLost']);
  assert.deepEqual(fieldsFor('TENNIS','Aces Allowed'), ['AcesAllowed']);
  assert.deepEqual(fieldsFor('TENNIS','Break Points Saved'), ['BreakPointsSaved']);
  assert.deepEqual(fieldsFor('TENNIS','1st Serve %'), ['FirstServePct']);
  assert.deepEqual(fieldsFor('TENNIS','Return Points Won %'), ['ReturnPointsWonPct']);
});

test('dynamic category tabs expose every distinct live market that reaches the board', () => {
  const groups = [
    {sport:'TENNIS',marketId:'player_games',market:'Games',playerId:'1',playerName:'A'},
    {sport:'TENNIS',marketId:'player_aces',market:'Aces',playerId:'2',playerName:'B'},
    {sport:'TENNIS',marketId:'player_1st_bf',market:'1ST BF',playerId:'3',playerName:'C'},
  ];
  assert.deepEqual(categoryOptions(groups,'TENNIS').map(x=>x.label), ['Games','1ST BF','Aces']);
});
