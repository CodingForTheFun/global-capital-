import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patchRecentFiveUi } from '../lib/autoscout/recent-five-runtime-patch.mjs';
import { patchAutomaticSpecialPropsUi } from '../lib/autoscout/automatic-special-props-runtime-patch.mjs';

test('production board gets persistent Goblin/Demon dropdown filters and passive refresh', () => {
  const source = readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');
  const patched = patchAutomaticSpecialPropsUi(patchRecentFiveUi(source));

  assert.match(patched, /id="asSpecial"/);
  assert.match(patched, /Green Goblins/);
  assert.match(patched, /Red Demons/);
  assert.match(patched, /autoscout-special-filter/);
  assert.match(patched, /row\.specialVerified===true&&row\.specialType===specialFilter/);
  assert.match(patched, /startAutoBoardRefresh\(\)/);
  assert.match(patched, /setInterval\(autoBoardRefreshSafe,15000\)/);
  assert.match(patched, /Date\.now\(\)-lastAutoBoardRefreshAt<85000/);
  assert.match(patched, /removeExpiredPrizePicksSpecials\(document\)/);
});

test('line-level PrizePicks metadata never invents More or Less in the board UI', () => {
  const source = readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');
  const patched = patchAutomaticSpecialPropsUi(patchRecentFiveUi(source));
  assert.match(patched, /row\.side==='UNDER'\?'Less':row\.side==='OVER'\?'More':''/);
  assert.match(patched, /direction\|\|\(row\.specialType==='demon'\?'Demon':'Goblin'\)/);
  assert.doesNotMatch(patched, /row\.side==='UNDER'\?'Less':'More'/);
});

test('production build applies both presentation patches and fails closed on drift', () => {
  const build = readFileSync(new URL('../scripts/prepare-edge-deploy.mjs', import.meta.url), 'utf8');
  assert.match(build, /patchAutomaticSpecialPropsUi\(patchRecentFiveUi\(uiSource\)\)/);
  assert.match(build, /Automatic special-prop UI build patch made no changes/);
});

test('background ingestion remains automatic and independent of the manual Refresh button', () => {
  const scheduler = readFileSync(new URL('../lib/autoscout/persistence-scheduler.mjs', import.meta.url), 'utf8');
  assert.match(scheduler, /setInterval\(\(\) => \{ void persistBoards\('scheduled'\); \}, ingestSeconds \* 1000\)/);
  assert.match(scheduler, /await publicFeeds\.refresh\(\)/);
  assert.match(scheduler, /TRANSIENT_DATABASE_STATUSES/);
  assert.match(scheduler, /database-degraded/);
});
