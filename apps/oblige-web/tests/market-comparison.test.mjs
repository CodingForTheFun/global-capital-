import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const card = readFileSync(new URL('../components/player-prop-research-card.tsx', import.meta.url), 'utf8');

test('market comparison is visible and exact-line scoped', () => {
  assert.match(card, /data-qa="market-comparison"/);
  assert.match(card, />Market Comparison</);
  assert.match(card, /Best price means the highest verified American price currently posted for this exact player, market, period and line/);
});

test('best sportsbook prices use real non-zero American odds', () => {
  assert.match(card, /value !== null && value !== 0/);
  assert.match(card, /Math\.max\(\.\.\.values\)/);
  assert.match(card, /bestOverPrice/);
  assert.match(card, /bestUnderPrice/);
  assert.match(card, /BEST OVER/);
  assert.match(card, /BEST UNDER/);
});

test('implied probability is labeled as book pricing, not no-vig model probability', () => {
  assert.match(card, /function americanImpliedProbability/);
  assert.match(card, /Implied /);
  assert.match(card, /includes each book's pricing margin; it is not a no-vig model probability/);
});

test('selecting a comparison row keeps using the existing research book state', () => {
  assert.match(card, /onState\(\{ \.\.\.state, book: book\.key \}\)/);
  assert.match(card, /aria-pressed=\{selected\}/);
});
