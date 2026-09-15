import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patchLiveMainViewUi } from '../lib/autoscout/live-main-view-runtime-patch.mjs';

test('inline Live patch adds same-page live UI without a page link', () => {
  const source = 'var shell = "asNav";';
  const patched = patchLiveMainViewUi(source);
  assert.match(patched, /asLiveMainTab/);
  assert.match(patched, /asLiveMainView/);
  assert.match(patched, /\/api\/live/);
  assert.match(patched, /searchParams\.set\('view','live'\)/);
  assert.doesNotThrow(() => new Function(patched));
});

test('inline Live patch fails closed when the main navigation is missing', () => {
  assert.throws(() => patchLiveMainViewUi('var shell = 1;'), /could not locate the ObligeProps navigation/);
});

test('production ClearSports bootstrap applies Live, realtime, market rail, then visual safety', () => {
  const bootstrap = readFileSync(new URL('../frontdoor-clearsports.mjs', import.meta.url), 'utf8');
  assert.match(bootstrap, /patchLiveMainViewUi/);
  assert.match(bootstrap, /patchProplineRealtimeUi\(patchedLiveMainViewUi\)/);
  assert.match(bootstrap, /patchProplineMarketUi\(patchedRealtimeUi\)/);
  assert.match(bootstrap, /makeClientSafeVisualUi\(patchedProplineMarketUi\)/);
});
