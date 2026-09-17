import assert from 'node:assert/strict';
import test from 'node:test';
import { patchMobileNavDockUi } from '../lib/autoscout/mobile-nav-dock-runtime-patch.mjs';

test('mobile nav hides on downward scroll and reappears on upward scroll', () => {
  const source = 'window.__obligePropsBase = true;';
  const patched = patchMobileNavDockUi(source);

  assert.match(patched, /mobile-nav-scroll-hide-runtime-v3/);
  assert.match(patched, /asNavAutoHideRail/);
  assert.match(patched, /asNavScrollHidden/);
  assert.match(patched, /window\.addEventListener\('scroll'/);
  assert.match(patched, /direction>0&&y-directionAnchor>=10/);
  assert.match(patched, /direction<0&&directionAnchor-y>=2/);
  assert.match(patched, /y<=8/);
  assert.match(patched, /max-width:720px/);
  assert.match(patched, /prefers-reduced-motion:reduce/);
  assert.doesNotMatch(patched, /pointerdown/);
  assert.doesNotMatch(patched, /localStorage/);
  assert.doesNotThrow(() => new Function(patched));
  assert.equal(patchMobileNavDockUi(patched), patched);
});
