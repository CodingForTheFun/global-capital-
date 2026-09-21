// The analytical half of PropLine. The board only ever called /events and
// /odds, so movement, steam, best line, graded results, hit-rate trends and
// opening/closing numbers were all paid for and unused.
//
// Response shapes come from PropLine's published contract rather than captured
// traffic, so these tests pin the two properties that matter regardless of shape
// drift: a reader never throws into the page that called it, and nothing is
// presented as measured when it is not.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TTL,
  normalizeMovement, normalizeBestLine, normalizeEv,
  normalizeHistory, normalizeClosing, normalizeResults, normalizeTrends,
  fetchMovement, fetchBestLine, fetchPlayerTrends,
} from '../lib/data-sources/propline/insights.mjs';

test('movement reports the signed move, biggest first', () => {
  const { moves } = normalizeMovement({ movements: [
    { player_name: 'A', market: 'player_points', opening_point: 20.5, current_point: 21, side: 'OVER' },
    { player_name: 'B', market: 'player_points', opening_point: 30.5, current_point: 27.5, side: 'OVER' },
  ] });
  assert.equal(moves[0].playerName, 'B', 'a three point fall outranks a half point rise');
  assert.equal(moves[0].pointDelta, -3);
  assert.equal(moves[1].pointDelta, 0.5);
});

test('a fall and a rise of equal size are equally interesting', () => {
  const { moves } = normalizeMovement({ movements: [
    { player_name: 'up', market: 'm', opening_point: 1, current_point: 3 },
    { player_name: 'down', market: 'm', opening_point: 5, current_point: 3, steam_score: 80 },
  ] });
  assert.equal(moves[0].playerName, 'down', 'steam breaks a tie on absolute move');
});

test('an unreadable movement row is counted, not thrown', () => {
  const { moves, unreadable } = normalizeMovement({ movements: [{ nonsense: true }, null] });
  assert.equal(moves.length, 0);
  assert.equal(unreadable, 2);
});

test('best line carries the implied probability and the book that pays it', () => {
  const { best } = normalizeBestLine({ best_lines: [
    { player_name: 'A', market: 'player_points', side: 'Over', point: 20.5, price_american: -110, bookmaker: 'onexbet' },
  ] });
  assert.equal(best[0].bookmakerKey, '1xbet', 'book keys are aliased onto the ones this product stores');
  assert.equal(Math.round(best[0].impliedProbability * 1000) / 1000, 0.524);
});

test('EV keeps the de-vig method rather than presenting a bare percentage', () => {
  const { plays } = normalizeEv({ plays: [
    { player_name: 'A', ev_percent: 2.1, devig_method: 'Shin', fair_price: -104 },
    { player_name: 'B', ev_percent: 6.4, devig_method: 'multiplicative' },
  ] });
  assert.equal(plays[0].playerName, 'B', 'highest edge first');
  assert.equal(plays[1].devigMethod, 'shin', 'multiplicative and Shin disagree; a reader deserves to know which');
});

test('history is ordered oldest to newest so it can be drawn', () => {
  const { points } = normalizeHistory({ history: [
    { recorded_at: '2026-09-16T12:00:00Z', point: 21 },
    { recorded_at: '2026-09-16T09:00:00Z', point: 20.5 },
  ] });
  assert.deepEqual(points.map((p) => p.line), [20.5, 21]);
});

test('documented nested history keeps the exact outcome id, DFS flavor and liquidity', () => {
  const { points } = normalizeHistory({ bookmakers: [{
    key: 'prizepicks',
    markets: [{
      key: 'player_points',
      outcomes: [{
        name: 'Over',
        description: 'Example Player',
        outcome_id: 'out-123',
        book_outcome_id: 'pp-456',
        dfs_odds_type: 'demon',
        snapshots: [
          { recorded_at: '2026-09-16T10:00:00Z', point: 24.5, price: 100, liquidity: 50 },
          { recorded_at: '2026-09-16T11:00:00Z', point: 25.5, price: 100, liquidity: 75 },
        ],
      }],
    }],
  }] });
  assert.equal(points.length, 2);
  assert.equal(points[0].outcomeId, 'out-123');
  assert.equal(points[0].bookOutcomeId, 'pp-456');
  assert.equal(points[0].bookmakerKey, 'prizepicks');
  assert.equal(points[0].marketKey, 'player_points');
  assert.equal(points[0].playerName, 'Example Player');
  assert.equal(points[0].side, 'OVER');
  assert.equal(points[0].dfsOddsType, 'demon');
  assert.equal(points[1].liquidity, 75);
});

test('a closing line captured too early is flagged, not quietly used', () => {
  const { closes } = normalizeClosing({ closing: [
    { player_name: 'A', closing_point: 20.5, is_stale: true },
    { player_name: 'B', closing_point: 25.5, is_stale: false },
  ] });
  assert.equal(closes[0].stale, true, 'CLV built on a stale close is corrupt');
  assert.equal(closes[1].stale, false);
});

test('a graded result carries the actual box-score value', () => {
  const { results } = normalizeResults({ results: [
    { player_name: 'Corbin Burnes', market: 'pitcher_strikeouts', resolution: 'won', actual_value: 4, point: 3.5 },
  ] });
  assert.equal(results[0].resolution, 'won');
  assert.equal(results[0].actualValue, 4);
});

test('a hit rate is never reported without its sample size', () => {
  // Shape verified against a live response: one row per market, snake_case
  // windows. The flat {l5, l10} object this originally asserted never existed.
  const { markets } = normalizeTrends({ markets: [
    { market: 'player_points', last_5: { games: 5, over: 4 }, last_10: { games: 10, over: 7, hit_rate: 0.7 } },
  ] });
  assert.equal(markets[0].windows.l5.hitRate, 0.8);
  assert.equal(markets[0].windows.l5.games, 5, 'a rate without a sample is not a fact');
  assert.equal(markets[0].windows.l10.hitRate, 0.7);
});

test('a malformed trends payload yields no markets rather than throwing', () => {
  for (const input of [null, 'nonsense', { markets: [{ notamarket: true }] }, { markets: 'no' }]) {
    assert.deepEqual(normalizeTrends(input).markets, []);
  }
});

test('every reader returns null instead of throwing into the page', async () => {
  delete process.env.PROPLINE_API_KEY; // unconfigured: proplineGet rejects
  for (const [label, call] of [
    ['movement', () => fetchMovement('NFL', 'e1')],
    ['best line', () => fetchBestLine('NFL', 'e1')],
    ['trends', () => fetchPlayerTrends('NFL', 'Some Player')],
  ]) {
    assert.equal(await call(), null, `${label} must degrade, not throw`);
  }
});

test('an unsupported sport is refused before a request is spent', async () => {
  process.env.PROPLINE_API_KEY = 'k';
  assert.equal(await fetchMovement('DARTS', 'e1'), null);
  delete process.env.PROPLINE_API_KEY;
});

test('freshness budgets match how fast each answer actually changes', () => {
  assert.ok(TTL.movement <= 60, 'a price moves constantly');
  assert.ok(TTL.trends >= 3600, 'a trend only changes when a game finishes');
  assert.ok(TTL.games >= TTL.trends, 'a completed game log never changes again');
  assert.ok(TTL.closing >= 3600, 'a close is fixed once it is taken');
});
