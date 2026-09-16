import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizedFeedBoard,normalizedDataFromBoardRows} from '../lib/ingestion/normalize.mjs';

// One record in the shape the sportsbook adapters emit.
const record={book:'draftkings',sport:'NFL',playerName:'Jordan Love',nativePlayerId:'dk-1',
 nativeEventId:'evt-1',team:'GB',opponent:'CLE',homeTeam:'CLE',awayTeam:'GB',
 gameStartTime:new Date(Date.now()+86400000).toISOString(),updatedAt:new Date().toISOString(),
 market:'Passing Yards',fallbackMarketKey:'player_pass_yds',line:259.5,
 overOdds:-110,underOdds:-110,sides:['OVER','UNDER'],sourceId:'src-1'};

test('the worker stores flat rows and discards the normalized halves', () => {
  const board = normalizedFeedBoard([record]);
  assert.ok(board.props.length, 'flat rows exist');
  assert.ok(board.data.lines.length, 'normalized lines exist before storage');
  // publicRows() persists only .props — .data never reaches the database.
  const stored = board.props.map((row) => ({ ...row, payoutType: 'sportsbook' }));
  assert.equal(stored.every((row) => row.data === undefined), true);
});

test('flat rows rebuild into the same normalized rows, not duplicates', () => {
  const board = normalizedFeedBoard([record]);
  const rebuilt = normalizedDataFromBoardRows(board.props);

  for (const key of ['events','players','props','lines']) {
    assert.equal(rebuilt[key].length, board.data[key].length, `${key} count differs`);
    const before = board.data[key].map((r) => r.id).sort();
    const after = rebuilt[key].map((r) => r.id).sort();
    // Identical ids are what keeps this an upsert rather than a second copy.
    assert.deepEqual(after, before, `${key} ids differ, which would duplicate rows`);
  }
});

test('the rebuilt line keeps the price and side a book actually quoted', () => {
  const board = normalizedFeedBoard([record]);
  const rebuilt = normalizedDataFromBoardRows(board.props);
  const over = rebuilt.lines.find((row) => row.side === 'OVER');
  assert.ok(over, 'OVER line missing');
  assert.equal(over.line, 259.5);
  assert.equal(over.price, -110);
  assert.equal(over.bookmakerKey, 'draftkings');
});

test('a row missing a required field is skipped rather than guessed at', () => {
  const board = normalizedFeedBoard([record]);
  const broken = [{ ...board.props[0], line: null }, { ...board.props[0], side: '' }, {}];
  assert.equal(normalizedDataFromBoardRows(broken).lines.length, 0);
});

test('malformed input never throws', () => {
  for (const input of [null, undefined, 'nonsense', 42, {}]) {
    const out = normalizedDataFromBoardRows(input);
    assert.equal(out.lines.length, 0);
  }
});

test('an empty set produces empty arrays, so an idle sport writes nothing', () => {
  const out = normalizedDataFromBoardRows([]);
  for (const key of ['events','players','props','lines']) assert.deepEqual(out[key], []);
});
