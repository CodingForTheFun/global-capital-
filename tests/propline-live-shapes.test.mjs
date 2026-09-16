// Captured from live PropLine responses on 2026-09-16, because the normalisers
// written from the published contract were both WRONG and would have shipped
// silently producing nothing:
//
//   trends  - one row per market with snake_case windows (last_5, last_10),
//             not the flat {l5, l10} object that was assumed
//   games   - the date is commence_time, not game_date, and stats already
//             carry the combination markets rather than needing them computed
//
// These fixtures exist so a shape change upstream fails a test instead of
// quietly emptying the research drawer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeTrends, trendsForMarket, statForMarket } from '../lib/data-sources/propline/insights.mjs';

const trendsFixture = JSON.parse(readFileSync(new URL('./fixtures/propline-trends-wnba.json', import.meta.url), 'utf8'));
const gamesFixture = JSON.parse(readFileSync(new URL('./fixtures/propline-games-wnba.json', import.meta.url), 'utf8'));

test('trends parse from the real per-market array', () => {
  const out = normalizeTrends(trendsFixture);
  assert.equal(out.playerName, 'Makayla Timpson');
  assert.ok(out.markets.length >= 8, `expected a row per market, got ${out.markets.length}`);
  assert.ok(out.markets.every((m) => m.marketKey), 'every row must carry its market');
});

test('a free-tier redaction is reported, not mistaken for missing data', () => {
  const out = normalizeTrends(trendsFixture);
  assert.equal(out.redacted, true, 'entitlement and absence are different problems');
  assert.equal(trendsForMarket(out, 'player_points_rebounds').gamesGraded, 13,
    'games_graded survives redaction and is still useful');
});

test('a market row is findable by the key a prop actually uses', () => {
  const out = normalizeTrends(trendsFixture);
  assert.ok(trendsForMarket(out, 'player_points'));
  assert.equal(trendsForMarket(out, 'not_a_market'), null);
});

test('a window may be a bare rate or a breakdown, and a percentage is normalised', () => {
  const asRate = normalizeTrends({ markets: [{ market: 'm', last_5: 0.6 }] });
  assert.equal(asRate.markets[0].windows.l5.hitRate, 0.6);
  const asPercent = normalizeTrends({ markets: [{ market: 'm', last_5: 60 }] });
  assert.equal(asPercent.markets[0].windows.l5.hitRate, 0.6, '60 means 60%, not 6000%');
  const breakdown = normalizeTrends({ markets: [{ market: 'm', last_5: { games: 5, over: 3 } }] });
  assert.equal(breakdown.markets[0].windows.l5.hitRate, 0.6);
  assert.equal(breakdown.markets[0].windows.l5.games, 5, 'a rate always carries its sample');
});

test('the game log reproduces the chart the scraped path draws', () => {
  // Verified against a real drawer screenshot: 18, 21, 16, 23, 15 points+rebounds.
  const expected = [18, 21, 16, 23, 15];
  const actual = gamesFixture.games.map((g) => statForMarket(g, 'player_points_rebounds'));
  assert.deepEqual(actual, expected);
});

test('combination markets are read, not recomputed', () => {
  // Recomputing points + rebounds from components is where a scraped path gets
  // combinations wrong. PropLine names them the way the prop is named.
  const game = gamesFixture.games[0];
  assert.equal(statForMarket(game, 'player_points_rebounds'), game.stats.points + game.stats.rebounds);
  assert.equal(statForMarket(game, 'player_points_rebounds_assists'), 19);
});

test('market prefixes across sports resolve to the same stat', () => {
  const game = { stats: { strikeouts: 7, hits: 2 } };
  assert.equal(statForMarket(game, 'pitcher_strikeouts'), 7);
  assert.equal(statForMarket(game, 'batter_hits'), 2);
});

test('an unknown market returns null rather than a wrong number', () => {
  assert.equal(statForMarket(gamesFixture.games[0], 'player_field_goals'), null);
  assert.equal(statForMarket(null, 'player_points'), null);
});
