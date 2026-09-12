import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { currentStreak, rollingAnalytics } from '../lib/analytics/rolling.mjs';
import { analyzeResearch, lineDifference } from '../lib/analytics/research.mjs';
import { createPublicResearch, GAME_LOG_TTL, ID_MAP_TTL } from '../lib/data-sources/espn/research.mjs';
import { finalizeResearch } from '../lib/autoscout/research-service.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/espn-${name}.json`, import.meta.url)));
const log = (...values) => values.map((value, index) => ({
  gameId: `g${index}`, value, date: new Date(Date.UTC(2026, 0, 30 - index)).toISOString(),
}));

test('a streak counts consecutive covers, skips pushes and stops at the first miss', () => {
  // Newest first: 12, 11, 10 clear a line of 9.5; the 4th game does not.
  assert.equal(currentStreak(log(12, 11, 10, 4, 15), 9.5, 'OVER').count, 3);
  // A push is neither a cover nor a miss: it is skipped, and the covers on
  // either side of it still count as one run.
  assert.equal(currentStreak(log(12, 10, 11, 4), 10, 'OVER').count, 2);
  assert.equal(currentStreak(log(4, 3, 12), 9.5, 'UNDER').count, 2);
  assert.equal(currentStreak(log(4, 12), 9.5, 'OVER').count, 0);
  // No line means nothing is decided; that is not a streak of zero.
  assert.equal(currentStreak(log(12, 11), null, 'OVER'), null);
  assert.equal(currentStreak([], 9.5, 'OVER').count, 0);
  assert.equal(rollingAnalytics(log(12, 11, 4), 9.5, 'OVER').streak.count, 2);
});

test('the line difference reports its basis and falls back when a season is incomplete', () => {
  const windows = { season: { average: 24 }, l20: { average: 20 }, l10: { average: 18 } };
  const full = lineDifference(windows, 19.5);
  assert.equal(full.basis, 'season');
  assert.equal(full.value, 4.5);
  assert.equal(full.percent, 23.1);

  // If no season average exists at all, the widest recent grounded window is
  // still the fallback and remains explicitly identified as the DIFF basis.
  const partial = lineDifference({ season: { average: null }, l20: { average: 20 } }, 19.5);
  assert.equal(partial.basis, 'l20');
  assert.equal(partial.value, 0.5);

  assert.equal(lineDifference({}, 19.5), null);
  assert.equal(lineDifference(windows, null), null);
  assert.equal(lineDifference({ season: { average: 5 } }, 0).percent, null);
});

test('research carries streak and difference through to the card payload', () => {
  const analyzed = analyzeResearch({ gameLog: log(30, 28, 26, 12), coverage: {}, context: {} }, 19.5, 'OVER');
  assert.equal(analyzed.streak.count, 3);
  assert.equal(analyzed.streak.side, 'OVER');
  // Real current-season rows are now a valid season-to-date sample even when
  // archive coverage is partial, so DIFF uses the same grounded SZN average.
  assert.equal(analyzed.diff.basis, 'season');
  assert.equal(analyzed.windows.season.partial, true);
  assert.ok(analyzed.diff.value > 0);

  const under = analyzeResearch({ gameLog: log(30, 28, 26, 12), coverage: {}, context: {} }, 19.5, 'UNDER');
  assert.equal(under.streak.count, 0);
  assert.equal(under.streak.side, 'UNDER');
});

test('an H2H sample of zero is a real answer, distinct from an unavailable one', () => {
  const base = finalizeResearch({
    sport: 'MLB', playerName: 'Shohei Ohtani', market: 'Hits', line: 1, side: 'OVER',
    gameLog: [{ gameId: 'a', date: '2026-01-02', value: 2, opponentId: 'MLB:17' }],
    opponent: 'Unknown Club', opponentId: 'MLB:999',
  });
  assert.equal(base.available, true);
  assert.equal(base.coverage.h2hGames, 0);
  assert.equal(base.h2h.hitRate, null);
});

test('athlete id mappings are cached permanently and game logs for two hours', async () => {
  assert.equal(ID_MAP_TTL, Infinity);
  assert.equal(GAME_LOG_TTL, 2 * 60 * 60_000);

  const calls = [];
  let clock = 1_000_000;
  const fetcher = createPublicResearch({
    now: () => clock,
    fetchImpl: async (url) => {
      calls.push(url);
      return new Response(JSON.stringify(fixture(url.includes('/search/') ? 'mlb-search' : 'mlb-gamelog')));
    },
  });
  const params = {
    sport: 'MLB', playerName: 'Shohei Ohtani', market: 'Hits',
    providerMarketKey: 'batter_hits', line: 1, side: 'OVER', games: 20,
  };

  await fetcher(params);
  const first = calls.length;
  assert.ok(calls.some((url) => url.includes('/search/')));

  // Inside the log window nothing is re-fetched at all.
  clock += 60 * 60_000;
  await fetcher({ ...params, line: 2 });
  assert.equal(calls.length, first);

  // Past two hours the game log is refreshed, but the athlete id is not looked
  // up again — an ESPN athlete id does not change.
  clock += 2 * 60 * 60_000;
  await fetcher({ ...params, line: 3 });
  const searches = calls.filter((url) => url.includes('/search/')).length;
  assert.equal(searches, 1);
  assert.ok(calls.length > first, 'the stale game log should be refetched');
});
