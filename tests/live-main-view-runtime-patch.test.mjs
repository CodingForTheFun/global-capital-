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
  // The chain grows, so what is pinned is the ordering property rather than
  // whichever variable happens to be last: every UI patch runs before the
  // client-safety pass, because that pass is what proves the result still
  // parses before it reaches a container.
  const lastPatchIndex = Math.max(
    ...[...bootstrap.matchAll(/^const (patched\w+) = patch\w+\(/gm)].map((match) => match.index),
  );
  // The call site, not the function definition - which is declared near the top
  // of the file, long before any patch runs.
  const safetyIndex = bootstrap.indexOf('writeFileSync(uiRuntimePath, makeClientSafeVisualUi(');
  assert.ok(safetyIndex > lastPatchIndex, 'visual safety must run after every UI patch');
  assert.match(bootstrap, /writeFileSync\(uiRuntimePath, makeClientSafeVisualUi\(patched\w+\), 'utf8'\)/,
    'the safety pass must be what is written, not an earlier stage');
});
