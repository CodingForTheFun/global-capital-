import assert from 'node:assert/strict';
import test from 'node:test';
import { patchMobileNavDockUi } from '../lib/autoscout/mobile-nav-dock-runtime-patch.mjs';

test('mobile nav slide-away patch is idempotent and emits valid client JavaScript', () => {
  const source = 'window.__obligePropsBase = true;';
  const patched = patchMobileNavDockUi(source);

  assert.match(patched, /mobile-nav-slide-runtime-v2/);
  assert.match(patched, /asNavSlideRail/);
  assert.match(patched, /asNavEdgeHandle/);
  assert.match(patched, /asNavCollapsed/);
  assert.match(patched, /obligeprops-nav-collapsed/);
  assert.match(patched, /aria-expanded/);
  assert.match(patched, /Show navigation/);
  assert.match(patched, /Hide navigation/);
  assert.match(patched, /pointerdown/);
  assert.match(patched, /ArrowRight/);
  assert.match(patched, /ArrowLeft/);
  assert.match(patched, /prefers-reduced-motion:reduce/);
  assert.doesNotThrow(() => new Function(patched));
  assert.equal(patchMobileNavDockUi(patched), patched);
});
