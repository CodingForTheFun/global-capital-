import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('actual Next mobile shell exposes Scores as the fifth bottom-nav destination', () => {
  const chrome = fs.readFileSync(new URL('../apps/oblige-web/components/site-chrome.tsx', import.meta.url), 'utf8');
  assert.match(chrome, /href: '\/scores', label: 'Scores'/);
  assert.match(chrome, /RadioTower/);
  assert.match(chrome, /grid-cols-5/);
});

test('Scores route is a real Next page backed by the live score API', () => {
  const page = fs.readFileSync(new URL('../apps/oblige-web/app/scores/page.tsx', import.meta.url), 'utf8');
  const screen = fs.readFileSync(new URL('../apps/oblige-web/components/scores-screen.tsx', import.meta.url), 'utf8');
  const scoreboard = fs.readFileSync(new URL('../apps/oblige-web/components/scoreboard/scoreboard.tsx', import.meta.url), 'utf8');
  const types = fs.readFileSync(new URL('../apps/oblige-web/components/scoreboard/types.ts', import.meta.url), 'utf8');

  assert.match(page, /ScoresScreen/);
  assert.match(screen, /\/api\/live\?sports=/);
  assert.match(screen, /NFL,NBA,SOCCER,NHL,MLB/);
  assert.match(scoreboard, /finished/);
  assert.match(scoreboard, /No games currently in play/);
  assert.match(types, /export type SportKey = 'nfl' \| 'nba' \| 'mlb' \| 'nhl' \| 'soccer'/);
  assert.match(types, /export type MatchStatus = 'scheduled' \| 'live' \| 'finished'/);
});
