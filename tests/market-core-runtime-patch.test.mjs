import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  patchProplineRealtimeCore,
  patchProplineRealtimeFrontdoor,
} from '../lib/autoscout/propline-realtime-runtime-patch.mjs';
import { patchProplinePushBoardCore } from '../lib/autoscout/propline-push-board-runtime-patch.mjs';
import { patchMarketCore, patchMarketCoreFrontdoor } from '../lib/autoscout/market-core-runtime-patch.mjs';

test('market core composes after existing PropLine realtime and push-board patches', () => {
  const base = readFileSync(new URL('../apex-v2/server-core.mjs', import.meta.url), 'utf8');
  const patched = patchMarketCore(patchProplinePushBoardCore(patchProplineRealtimeCore(base)));

  assert.match(patched, /publishMarketEnvelope/);
  assert.match(patched, /handleMarketCoreRequest/);
  assert.match(patched, /marketCoreHealth/);
  assert.match(patched, /url\.pathname\.startsWith\('\/api\/market\/'\)/);
  assert.match(patched, /recordProplineLiveBoardEvent\(event\); const result = await handleProplineRealtimeEvent\(event\); publishMarketEnvelope/);
});

test('frontdoor exposes same-origin stream and state routes through the existing data core', () => {
  const base = readFileSync(new URL('../frontdoor-prod.mjs', import.meta.url), 'utf8');
  const patched = patchMarketCoreFrontdoor(patchProplineRealtimeFrontdoor(base));

  assert.match(patched, /'\/api\/apex\/stream'/);
  assert.match(patched, /'\/api\/market\/stream'/);
  assert.match(patched, /'\/api\/apex\/market-state'/);
  assert.match(patched, /'\/api\/market\/state'/);
});

test('market core patches are idempotent', () => {
  const coreBase = readFileSync(new URL('../apex-v2/server-core.mjs', import.meta.url), 'utf8');
  const once = patchMarketCore(patchProplinePushBoardCore(patchProplineRealtimeCore(coreBase)));
  assert.equal(patchMarketCore(once), once);

  const frontBase = readFileSync(new URL('../frontdoor-prod.mjs', import.meta.url), 'utf8');
  const frontOnce = patchMarketCoreFrontdoor(patchProplineRealtimeFrontdoor(frontBase));
  assert.equal(patchMarketCoreFrontdoor(frontOnce), frontOnce);
});
