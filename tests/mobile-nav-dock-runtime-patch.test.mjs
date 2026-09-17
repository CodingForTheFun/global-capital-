import assert from 'node:assert/strict';
import test from 'node:test';
import { patchMobileNavDockUi } from '../lib/autoscout/mobile-nav-dock-runtime-patch.mjs';

test('mobile fixed-bottom nav follows gesture direction and survives nav remounts', () => {
  const source = 'window.__obligePropsBase = true;';
  const patched = patchMobileNavDockUi(source);

  assert.match(patched, /mobile-nav-scroll-hide-runtime-v5/);
  assert.match(patched, /asNavAutoHideRail/);
  assert.match(patched, /asNavScrollHidden/);
  assert.match(patched, /transform:translate3d\(0,calc\(100% \+ 24px \+ env\(safe-area-inset-bottom\)\),0\)!important/);
  assert.match(patched, /var desiredHidden=false/);
  assert.match(patched, /if\(delta<0\)setHidden\(true\)/);
  assert.match(patched, /else if\(delta>0\)setHidden\(false\)/);
  assert.match(patched, /window\.addEventListener\('wheel',onWheel/);
  assert.match(patched, /if\(nav\.dataset\.scrollHideReady==='5'\)\{\s*applyHidden\(\)/);
  assert.match(patched, /if\(source!==trackedSource\)\{\s*resetTracking\(source\);\s*if\(y>12\)setHidden\(true\)/);
  assert.match(patched, /direction>0&&y-directionAnchor>=7/);
  assert.match(patched, /direction<0&&directionAnchor-y>=3/);
  assert.match(patched, /max-width:720px/);
  assert.match(patched, /prefers-reduced-motion:reduce/);
  assert.doesNotMatch(patched, /localStorage/);
  assert.doesNotThrow(() => new Function(patched));
  assert.equal(patchMobileNavDockUi(patched), patched);
});
