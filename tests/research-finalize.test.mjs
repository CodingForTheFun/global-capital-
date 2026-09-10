import test from 'node:test';
import assert from 'node:assert/strict';
import { finalizeResearch } from '../lib/autoscout/research-service.mjs';

const log = (values, opponents = []) => values.map((value, i) => ({
  value,
  date: `2026-0${(i % 9) + 1}-1${i % 9}T00:00:00Z`,
  opponent: opponents[i] ?? 'XXX',
  isHome: i % 2 === 0,
}));

test('a raw provider game log becomes the shape the research UI renders', () => {
  const r = finalizeResearch({ gameLog: log([30, 20, 28, 22, 26]), line: 25, side: 'OVER', market: 'points' });
  assert.equal(r.available, true);
  for (const key of ['windows', 'trend', 'splits', 'h2h', 'gameLog', 'coverage', 'matchup']) {
    assert.ok(key in r, `the UI reads ${key}`);
  }
  assert.equal(r.windows.l5.hitRate, 60);
  assert.equal(r.coverage.gamesReturned, 5);
});

test('every game carries a hit/push verdict, which is what colours the chart bars', () => {
  const r = finalizeResearch({ gameLog: log([30, 25, 20]), line: 25, side: 'OVER', market: 'points' });
  // A push is neither a hit nor a miss, so it is null rather than false —
  // the chart paints it amber instead of red.
  assert.deepEqual(r.gameLog.map((g) => g.hit), [true, null, false]);
  assert.deepEqual(r.gameLog.map((g) => g.push), [false, true, false]);
});

test('the side flips the verdicts', () => {
  const over = finalizeResearch({ gameLog: log([30, 20]), line: 25, side: 'OVER', market: 'points' });
  const under = finalizeResearch({ gameLog: log([30, 20]), line: 25, side: 'UNDER', market: 'points' });
  assert.equal(over.windows.season.hitRate, 50);
  assert.equal(under.windows.season.hitRate, 50);
  assert.deepEqual(over.gameLog.map((g) => g.hit), [true, false]);
  assert.deepEqual(under.gameLog.map((g) => g.hit), [false, true]);
});

test('an empty or unusable log reports no data instead of an empty chart', () => {
  for (const gameLog of [[], [{ value: null }], [{}], undefined]) {
    const r = finalizeResearch({ gameLog, line: 25, side: 'OVER', market: 'points' });
    assert.equal(r.available, false);
    assert.equal(r.code, 'NO_GAME_LOG_DATA');
  }
});

test('h2h is computed from the opponent implied by the matchup', () => {
  const r = finalizeResearch({
    gameLog: log([30, 10, 28], ['NYK', 'MIA', 'NYK']),
    line: 25, side: 'OVER', market: 'points',
    team: 'BOS', homeTeam: 'NYK', awayTeam: 'BOS',
  });
  assert.equal(r.matchup.opponent, 'NYK');
  assert.equal(r.h2h.games, 2);
  assert.equal(r.h2h.hitRate, 100);
});

test('a source label is carried through so the panel can name the data', () => {
  const r = finalizeResearch({ gameLog: log([30, 20]), line: 25, market: 'points', source: 'ClearSports' });
  assert.equal(r.source, 'ClearSports');
});

test('no line means no hit rate, rather than a zero that reads as "never hit"', () => {
  const r = finalizeResearch({ gameLog: log([30, 20]), line: null, side: 'OVER', market: 'points' });
  assert.equal(r.available, true);
  assert.equal(r.windows.season.hitRate, null);
  assert.equal(r.gameLog[0].hit, null);
});

test('both providers produce identical analysis from identical games', () => {
  const games = log([30, 22, 27, 19, 31]);
  const a = finalizeResearch({ gameLog: games, line: 25, side: 'OVER', market: 'points', source: 'ClearSports' });
  const b = finalizeResearch({ gameLog: games, line: 25, side: 'OVER', market: 'points', source: 'SportsDataIO' });
  assert.deepEqual(a.windows, b.windows, 'the provider must not change the maths');
  assert.deepEqual(a.gameLog.map((g) => g.hit), b.gameLog.map((g) => g.hit));
});
