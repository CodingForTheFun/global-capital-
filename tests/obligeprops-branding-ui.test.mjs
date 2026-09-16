import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patchObligePropsVisualUi } from '../lib/autoscout/oblige-props-visual-runtime-patch.mjs';

test('Oblige Props board patch keeps customer-facing identity current', () => {
  const patched = patchObligePropsVisualUi('const ui = true;');
  assert.match(patched, /function obligeCopy/);
  assert.match(patched, /function normalizeBrand/);
  assert.match(patched, /setAttribute\\('aria-label','Oblige Props research'\\)/);
  assert.match(patched, /asHeaderSearchIcon" aria-hidden="true"><\/span>/);
  assert.doesNotMatch(patched, />⌕<\/span>/);
  assert.match(patched, /asBookRail\{display:none!important\}/);
  assert.equal(patchObligePropsVisualUi(patched), patched);
});

test('board source does not expose the retired Auto Scout display name', () => {
  const source = readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Auto Scout/);
});
