import assert from 'node:assert/strict';
import test from 'node:test';
import { patchMobileNavDockUi } from '../lib/autoscout/mobile-nav-dock-runtime-patch.mjs';

test('mobile fixed-bottom nav hides downward and reappears upward', () => {
  const source = 'window.__obligePropsBase = true;';
  const patched = patchMobileNavDockUi(source);

  assert.match(patched, /mobile-nav-scroll-hide-runtime-v4/);
  assert.match(patched, /asNavAutoHideRail/);
  assert.match(patched, /asNavScrollHidden/);
  assert.match(patched, /transform:translate3d\(0,calc\(100% \+ 24px \+ env\(safe-area-inset-bottom\)\),0\)!important/);
  assert.doesNotMatch(patched, /calc\(-100%/);
  assert.match(patched, /window\.addEventListener\('scroll'/);
  assert.match(patched, /document\.addEventListener\('scroll',queueScrollUpdate,\{passive:true,capture:true\}\)/);
  assert.match(patched, /document\.addEventListener\('touchmove',onTouchMove/);
  assert.match(patched, /direction>0&&y-directionAnchor>=10/);
  assert.match(patched, /direction<0&&directionAnchor-y>=2/);
  assert.match(patched, /delta<0&&y>8/);
  assert.match(patched, /max-width:720px/);
  assert.match(patched, /prefers-reduced-motion:reduce/);
  assert.doesNotMatch(patched, /pointerdown/);
  assert.doesNotMatch(patched, /localStorage/);
  assert.doesNotThrow(() => new Function(patched));
  assert.equal(patchMobileNavDockUi(patched), patched);
});
