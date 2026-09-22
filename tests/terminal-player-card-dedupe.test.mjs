import test from 'node:test';
import assert from 'node:assert/strict';
import { uniqueTerminalPlayerCards } from '../apps/oblige-web/lib/terminal-player-cards.mjs';

function group(overrides = {}) {
  return {
    key: 'base',
    player: 'Devin Singletary',
    providerPlayerId: 'provider-player',
    sport: 'NFL',
    period: 'game',
    team: 'New York Giants',
    homeTeam: 'Los Angeles Rams',
    awayTeam: 'New York Giants',
    matchup: 'New York Giants @ Los Angeles Rams',
    startsAt: '2026-09-21T20:00:00Z',
    quotes: [],
    ...overrides,
  };
}

test('terminal keeps one card for the same player and event across markets and alternate lines', () => {
  const ranked = [
    group({ key: 'singletary-18-5', market: 'Rushing + Receiving Yards', line: 18.5 }),
    group({ key: 'singletary-19-5', market: 'Rushing + Receiving Yards', line: 19.5 }),
    group({ key: 'singletary-rec', market: 'Receptions', line: 0.5 }),
    group({ key: 'singletary-rec-yds', market: 'Receiving Yards', line: 1.5 }),
    group({ key: 'singletary-24-5', market: 'Rushing + Receiving Yards', line: 24.5 }),
  ];

  const cards = uniqueTerminalPlayerCards(ranked);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].key, 'singletary-18-5');
});

test('dedupe preserves ranking order by keeping the first matching exact prop as the preview', () => {
  const ranked = [
    group({ key: 'best-ranked', line: 24.5 }),
    group({ key: 'second-ranked', line: 18.5 }),
  ];

  assert.equal(uniqueTerminalPlayerCards(ranked)[0].key, 'best-ranked');
});

test('provider team aliases do not recreate the same player card', () => {
  const cards = uniqueTerminalPlayerCards([
    group({ key: 'abbr', team: 'NYG', providerPlayerId: 'book-a-player' }),
    group({ key: 'full', team: 'New York Giants', providerPlayerId: 'book-b-player' }),
  ]);

  assert.equal(cards.length, 1);
});

test('true namesakes on different teams remain separate', () => {
  const shared = {
    player: 'Chris Smith',
    sport: 'NFL',
    period: 'game',
    startsAt: '2026-09-21T20:00:00Z',
    matchup: 'New York Giants @ New York Jets',
    quotes: [],
  };

  const cards = uniqueTerminalPlayerCards([
    { ...shared, key: 'giants-smith', team: 'New York Giants' },
    { ...shared, key: 'jets-smith', team: 'New York Jets' },
  ]);

  assert.equal(cards.length, 2);
  assert.deepEqual(cards.map((card) => card.key), ['giants-smith', 'jets-smith']);
});

test('different events and periods remain distinct research contexts', () => {
  const cards = uniqueTerminalPlayerCards([
    group({ key: 'game-one', startsAt: '2026-09-21T20:00:00Z', period: 'game' }),
    group({ key: 'game-two', startsAt: '2026-09-28T20:00:00Z', period: 'game' }),
    group({ key: 'first-half', startsAt: '2026-09-21T20:00:00Z', period: '1H' }),
  ]);

  assert.equal(cards.length, 3);
});
