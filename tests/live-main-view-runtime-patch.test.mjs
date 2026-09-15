import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patchLiveMainViewUi } from '../lib/autoscout/live-main-view-runtime-patch.mjs';

test('inline Scores patch reuses the existing nav slot and renders same-page score sections', () => {
  const source = 'var shell = "asNav";';
  const patched = patchLiveMainViewUi(source);
  assert.match(patched, /querySelector\('\.asNavScores'\)/);
  assert.match(patched, /asLiveMainTab/);
  assert.match(patched, /asLiveMainView/);
  assert.match(patched, /asLiveNowSection/);
  assert.match(patched, /asLiveUpcomingSection/);
  assert.match(patched, /asLiveFinalSection/);
  assert.match(patched, /homeLogo/);
  assert.match(patched, /\/api\/live/);
  assert.match(patched, /searchParams\.set\('view','live'\)/);
  assert.doesNotMatch(patched, /nav\.insertBefore\(liveButton/);
  assert.doesNotThrow(() => new Function(patched));
});

test('inline Scores patch fails closed when the main navigation is missing', () => {
  assert.throws(() => patchLiveMainViewUi('var shell = 1;'), /could not locate the ObligeProps navigation/);
});

test('production ClearSports bootstrap applies the inline score patch after research navigation', () => {
  const bootstrap = readFileSync(new URL('../frontdoor-clearsports.mjs', import.meta.url), 'utf8');
  assert.match(bootstrap, /patchLiveMainViewUi/);
  assert.match(bootstrap, /makeClientSafeVisualUi\(patchedLiveMainViewUi\)/);
  assert.ok(bootstrap.indexOf('patchResearchTabsUi(patchedPropBookSelectorUi)') < bootstrap.indexOf('patchLiveMainViewUi(patchedResearchTabsUi)'));
});
