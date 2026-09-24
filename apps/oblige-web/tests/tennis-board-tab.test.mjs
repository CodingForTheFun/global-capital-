import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const board = readFileSync(new URL('../components/board-view.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../lib/api.ts', import.meta.url), 'utf8');
const card = readFileSync(new URL('../components/player-prop-research-card.tsx', import.meta.url), 'utf8');

test('Tennis is a first-class sport in the current Next prop board', () => {
  const match = board.match(/const SPORTS = \[([^\]]+)\]/);
  assert.ok(match, 'SPORTS list should exist');
  assert.match(match[1], /'TENNIS'/);
  assert.match(board, /SPORTS\.map\(\(option\)/);
  assert.match(board, /selectSport\(option\)/);
});

test('the board API remains sport-parameterized rather than creating a Tennis-only data path', () => {
  assert.match(api, /fetchBoard\(sport/);
  assert.match(api, /sport=.*encodeURIComponent|encodeURIComponent\(sport\)/);
});

test('Tennis research keeps using the existing verified context path', () => {
  assert.match(card, /fetchTennisContext/);
  assert.match(card, /TennisContextResponse/);
});
