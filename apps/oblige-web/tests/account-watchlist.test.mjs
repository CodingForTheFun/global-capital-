import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('../lib/api.ts', import.meta.url), 'utf8');
const view = readFileSync(new URL('../components/player-view.tsx', import.meta.url), 'utf8');

test('client reads and writes the authenticated account watchlist', () => {
  assert.match(api, /\/api\/account\/watchlist/);
  assert.match(api, /x-csrf-token/);
  assert.match(api, /export async function fetchWatchlist/);
  assert.match(api, /export async function updateWatchlist/);
});

test('research star hydrates remote keys and keeps local fallback', () => {
  assert.match(view, /fetchWatchlist\(controller\.signal\)/);
  assert.match(view, /remoteKeys = items\.map\(\(item\) => item\.key\)/);
  assert.match(view, /writeFavouriteFallback/);
  assert.match(view, /updateWatchlist\(/);
  assert.match(view, /saving \? 'upsert' : 'remove'/);
});

test('watchlist writes persist exact prop identity rather than just player name', () => {
  assert.match(view, /key: group\.key/);
  assert.match(view, /market: group\.market/);
  assert.match(view, /line: group\.line/);
  assert.match(view, /period: group\.period \|\| 'game'/);
  assert.match(view, /propId: group\.propId/);
});
