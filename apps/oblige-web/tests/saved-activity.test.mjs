import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const account = readFileSync(new URL('../components/account-view.tsx', import.meta.url), 'utf8');
const player = readFileSync(new URL('../components/player-view.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../lib/api.ts', import.meta.url), 'utf8');

test('saved props preserve event and market identity for exact realtime matching', () => {
  assert.match(player, /eventId,/);
  assert.match(player, /marketId: group\.marketId/);
  assert.match(api, /eventId\?: string \| null/);
  assert.match(api, /marketId\?: string \| null/);
});

test('saved activity requires exact event, player and market identity', () => {
  const start = account.indexOf('function savedActivity');
  const end = account.indexOf('function activityLabel', start);
  const helper = account.slice(start, end);
  assert.match(helper, /item\.eventId/);
  assert.match(helper, /item\.marketId/);
  assert.match(helper, /row\.eventId/);
  assert.match(helper, /row\.playerName/);
  assert.match(helper, /row\.marketKey/);
  assert.match(helper, /\(item\.period \|\| 'game'\) !== 'game'/);
  assert.doesNotMatch(helper, /marketDescription/);
});

test('saved activity reuses the authenticated Live Moves feed without provider polling', () => {
  assert.match(account, /fetchLiveMoves\(\{ limit: 300 \}/);
  assert.match(account, /data-qa="saved-activity"/);
  assert.match(account, /Refresh saved prop activity/);
  assert.match(account, /Line \$\{previous\} → \$\{current\}/);
});
