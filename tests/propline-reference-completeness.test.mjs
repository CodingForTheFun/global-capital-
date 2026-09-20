import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEv, normalizeProjections } from '../lib/data-sources/propline/insights.mjs';
import { normalizeMarketReference } from '../lib/web/workspace-api.mjs';
import { normalizeOffers } from '../lib/web/prop-workspace.mjs';

const player = { playerId: 'espn:fixture', name: 'Fixture Player' };
const market = { marketKey: 'player_pass_yds', period: null, variant: 'standard' };
const offer = { book: 'draftkings', line: 245.5, side: 'OVER', price: -110, multiplier: null, dfs: false, conflict: false };
const projections = { projections: [{ player: player.name, player_id: player.playerId, market_key: market.marketKey, projected_value: 246.9, books_contributing: 4, last_update: '2026-09-20T10:00:00Z' }] };
const ev = { redacted: false, lines: [{ description: player.name, player_id: player.playerId, market_key: market.marketKey, point: offer.line, fair_probs: { Over: .55, Under: .45 }, fair_source: 'pinnacle', outcomes: [
  { book: 'draftkings', name: 'Over', point: offer.line, price: -110, ev_pct: 5 },
  { book: 'fanduel', name: 'Over', point: offer.line, price: 100, ev_pct: 10 },
  { book: 'draftkings', name: 'Under', point: offer.line, price: 100, ev_pct: -10 },
] }] };
test('current documented projected_value/player schema retains real values and provenance', () => {
  const result = normalizeProjections(projections).projections[0];
  assert.equal(result.playerName, player.name); assert.equal(result.projection, 246.9);
  assert.equal(result.booksContributing, 4); assert.equal(result.basis, 'market-implied');
});
test('nested EV lines decode each book and side without borrowing the largest edge', () => {
  assert.equal(normalizeEv(ev).plays.length, 3);
  const result = normalizeMarketReference(projections, ev, player, market, offer);
  assert.equal(result.projection, 246.9); assert.equal(result.evPercent, 5); assert.equal(result.fairProbability, .55);
  assert.equal(result.bookmaker, 'draftkings'); assert.equal(result.side, 'OVER'); assert.equal(result.price, -110);
});
test('a different line, book, side or price cannot supply the selected quote EV', () => {
  for (const change of [{ line: 250.5 }, { book: 'unknown' }, { side: 'UNDER', price: -110 }, { price: -115 }]) {
    assert.equal(normalizeMarketReference(projections, ev, player, market, { ...offer, ...change }).evPercent, null);
  }
});
test('names cannot override a conflicting player ID and redacted or empty values are never zero', () => {
  assert.equal(normalizeMarketReference(projections, ev, { ...player, playerId: 'other' }, market, offer), null);
  assert.deepEqual(normalizeEv({ ...ev, redacted: true }).plays, []);
  assert.deepEqual(normalizeProjections({ ...projections, redacted: true }).projections, []);
  assert.equal(normalizeProjections({ projections: [{ ...projections.projections[0], projected_value: null }] }).projections.length, 0);
  assert.equal(normalizeEv({ plays: [{ player_name: 'Fixture', ev: null }] }).plays[0].evPercent, null);
});
test('DFS never gets single-leg EV and specials/periods never inherit standard-game references', () => {
  assert.equal(normalizeMarketReference(projections, ev, player, market, { ...offer, dfs: true }).evPercent, null);
  for (const scope of [{ period: 'h1' }, { variant: 'demon' }]) assert.equal(normalizeMarketReference(projections, ev, player, { ...market, ...scope }, offer), null);
  assert.equal(normalizeMarketReference(projections, ev, player, market, { ...offer, multiplier: 1.2 }), null);
});
test('canonical offers keep variants, line gaps, source IDs and zero liquidity', () => {
  const event = { id: 'fixture', sport: 'football_nfl', startsAt: '2050-10-01T20:00:00Z' };
  const outcome = { description: player.name, player_id: player.playerId, name: 'Over', point: 220.5, price: 100, dfs_odds_type: 'goblin', line_gap: -25, liquidity: 0, outcome_id: 'source-id', book_outcome_id: 'book-id' };
  const result = normalizeOffers([{ id: event.id, bookmakers: [{ key: 'prizepicks', markets: [{ key: market.marketKey, outcomes: [outcome, { ...outcome, dfs_odds_type: 'demon' }] }] }] }], event);
  assert.equal(result.players[0].markets.length, 2);
  const quote = result.players[0].markets.find(m => m.variant === 'goblin').offers[0];
  assert.equal(quote.lineGap, -25); assert.equal(quote.liquidity, 0); assert.equal(quote.outcomeId, 'source-id'); assert.equal(quote.bookOutcomeId, 'book-id');
});
test('conflicting matching projection records are withheld', () => {
  assert.equal(normalizeMarketReference({ projections: [...projections.projections, { ...projections.projections[0], projected_value: 300 }] }, null, player, market, offer), null);
});
