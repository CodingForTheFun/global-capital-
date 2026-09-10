import test from 'node:test';
import assert from 'node:assert/strict';

import { hitRateFor, headToHead, windowsFor, researchProp, RESEARCH_CODE } from '../lib/research/service.mjs';
import { canonicalMarket } from '../lib/research/market-keys.mjs';

const log = (values, opponents = []) => values.map((value, i) => ({
  value, date: `2026-01-${String(i + 1).padStart(2, '0')}`, opponent: opponents[i] ?? 'XXX', isHome: i % 2 === 0,
}));

test('hit rate counts games that beat the line, for the chosen side', () => {
  const games = log([30, 20, 28, 22, 26]);
  const over = hitRateFor(games, 25, 'OVER');
  assert.equal(over.hits, 3);
  assert.equal(over.decided, 5);
  assert.equal(over.hitRate, 60);

  const under = hitRateFor(games, 25, 'UNDER');
  assert.equal(under.hits, 2);
  assert.equal(under.hitRate, 40, 'over and under must be complements when nothing pushes');
});

test('a push is excluded from the denominator, not counted as a loss', () => {
  const result = hitRateFor(log([30, 25, 20]), 25, 'OVER');
  assert.equal(result.pushes, 1);
  assert.equal(result.decided, 2, 'only decided games count');
  assert.equal(result.hitRate, 50, '1 of 2 decided, not 1 of 3');
  assert.equal(result.games, 3, 'the average still uses every game');
});

test('the average uses every game, including pushes', () => {
  assert.equal(hitRateFor(log([10, 20, 30]), 20, 'OVER').average, 20);
});

test('a line with no games, or no line at all, yields null rather than zero', () => {
  assert.equal(hitRateFor([], 25, 'OVER').hitRate, null);
  assert.equal(hitRateFor(log([30, 20]), null, 'OVER').hitRate, null, 'no line means no hit rate');
  assert.equal(hitRateFor(log([30, 20]), null, 'OVER').average, null);
});

test('non-numeric game values are skipped, never coerced to zero', () => {
  const games = [{ value: 30 }, { value: null }, { value: undefined }, { value: 20 }, {}];
  const result = hitRateFor(games, 25, 'OVER');
  assert.equal(result.games, 2);
  assert.equal(result.hitRate, 50);
});

test('changing the line changes the hit rate, which is the whole point', () => {
  const games = log([30, 28, 26, 24, 22]);
  assert.equal(hitRateFor(games, 21, 'OVER').hitRate, 100);
  assert.equal(hitRateFor(games, 25, 'OVER').hitRate, 60);
  assert.equal(hitRateFor(games, 31, 'OVER').hitRate, 0);
});

test('windows slice the log to L5/L10/L15/L20 and season', () => {
  const games = log(Array.from({ length: 25 }, (_, i) => (i < 5 ? 30 : 10)));
  const windows = windowsFor(games, 20, 'OVER');
  assert.equal(windows.l5.hitRate, 100, 'the five most recent all cleared 20');
  assert.equal(windows.l10.hitRate, 50);
  assert.equal(windows.l20.hitRate, 25);
  assert.equal(windows.season.games, 25, 'season uses the whole log');
  assert.equal(windows.l5.label, 'Last 5');
});

test('a window with fewer games than its size reports what it actually has', () => {
  const windows = windowsFor(log([30, 30, 30]), 25, 'OVER');
  assert.equal(windows.l5.games, 3);
  assert.equal(windows.l10.games, 3);
  assert.equal(windows.l5.hitRate, 100);
});

test('head-to-head filters to one opponent and is null when they never met', () => {
  const games = log([30, 10, 28, 12], ['NYK', 'MIA', 'NYK', 'BOS']);
  const h2h = headToHead(games, 'NYK', 25, 'OVER');
  assert.equal(h2h.games, 2);
  assert.equal(h2h.hitRate, 100);
  assert.equal(headToHead(games, 'LAL', 25, 'OVER'), null);
  assert.equal(headToHead(games, null, 25, 'OVER'), null);
});

test('windows include h2h only when an opponent was supplied and matched', () => {
  const games = log([30, 10], ['NYK', 'MIA']);
  assert.ok(windowsFor(games, 25, 'OVER', { opponent: 'NYK' }).h2h);
  assert.equal(windowsFor(games, 25, 'OVER').h2h, undefined);
});

test('odds-api market keys map onto canonical stat markets', () => {
  assert.equal(canonicalMarket({ marketId: 'player_points' }), 'points');
  assert.equal(canonicalMarket({ marketId: 'player_points_rebounds_assists' }), 'pra');
  assert.equal(canonicalMarket({ statId: 'player_threes' }), 'threes');
  assert.equal(canonicalMarket({ marketId: 'player_rush_yds' }), 'rushing yards');
  assert.equal(canonicalMarket({ marketId: 'player_reception_yds' }), 'receiving yards');
});

test('display labels and shorthand resolve too', () => {
  assert.equal(canonicalMarket({ market: 'Points' }), 'points');
  assert.equal(canonicalMarket({ market: 'PTS' }), 'points');
  assert.equal(canonicalMarket({ market: 'PRA' }), 'pra');
  assert.equal(canonicalMarket({ market: 'STOCKS' }), 'steals + blocks');
});

test('the provider key wins over an ambiguous display label', () => {
  assert.equal(canonicalMarket({ marketId: 'player_assists', market: 'Points' }), 'assists');
});

test('an unknown market returns something the stat map will simply miss, never a guess', () => {
  assert.equal(canonicalMarket({}), null);
  assert.equal(canonicalMarket({ market: '' }), null);
});

test('research fails closed with a stated reason when no stats provider is configured', async () => {
  const before = process.env.SPORTSDATAIO_API_KEY;
  delete process.env.SPORTSDATAIO_API_KEY;
  const result = await researchProp({
    sport: 'NBA', playerName: 'Jayson Tatum', market: 'Points', marketId: 'player_points',
    line: 27.5, side: 'OVER', log: { error() {} },
  });
  assert.equal(result.available, false);
  assert.equal(result.code, RESEARCH_CODE.PROVIDER_NOT_CONFIGURED);
  assert.match(result.reason, /SPORTSDATAIO_API_KEY/);
  assert.deepEqual(result.gameLog, [], 'an unavailable result carries no invented games');
  if (before === undefined) delete process.env.SPORTSDATAIO_API_KEY; else process.env.SPORTSDATAIO_API_KEY = before;
});

test('an unmappable market is refused before any upstream call', async () => {
  const result = await researchProp({
    sport: 'NBA', playerName: 'Someone', market: '', marketId: '', line: 1, log: { error() {} },
  });
  assert.equal(result.available, false);
  assert.ok([RESEARCH_CODE.MARKET_UNSUPPORTED, RESEARCH_CODE.PROVIDER_NOT_CONFIGURED].includes(result.code));
});

test('every unavailable reason is human copy, not a code', async () => {
  const result = await researchProp({ sport: 'NBA', playerName: 'X', market: 'Points', line: 1, log: { error() {} } });
  assert.ok(result.reason.length > 20);
  assert.notEqual(result.reason, result.code, 'the UI shows this verbatim, so it must not be the code');
  assert.ok(result.reason.includes(' '), 'it must read as a sentence');
  assert.match(result.reason, /[.!]$/, 'it must be punctuated copy');
});
