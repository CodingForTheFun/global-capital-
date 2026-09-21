import assert from 'node:assert/strict';
import test from 'node:test';
import { patchMobileNavDockUi } from '../lib/autoscout/mobile-nav-dock-runtime-patch.mjs';

test('mobile fixed-bottom nav follows gesture direction and survives nav remounts', () => {
  const source = 'window.__obligePropsBase = true;';
  const patched = patchMobileNavDockUi(source);

  assert.match(patched, /mobile-nav-scroll-hide-runtime-v5/);
  assert.match(patched, /asNavAutoHideRail/);
  assert.match(patched, /asNavScrollHidden/);
  assert.match(patched, /transform:translate3d\(-50%,calc\(100% \+ 24px \+ env\(safe-area-inset-bottom\)\),0\)!important/);
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

// The dock is centred by `left:50%` plus `transform:translateX(-50%)`. Every
// rule here is `.asNav.asNavAutoHideRail`, which outranks the one-class rule
// that centres it, so a transform written without the -50% does not merely skip
// an animation — it strands the dock at the 50% mark. Measured on a 390px
// viewport before this was fixed: left 195, right 571, so 181px of the dock sat
// off the right edge, and since it is not a scroll container, four of its seven
// destinations could not be reached at all.
//
// Asserted as a property over every transform the patch emits rather than as
// one literal, because the literal is exactly what drifted last time.
test('every dock transform keeps the -50% that centres it', () => {
  const patched = patchMobileNavDockUi('window.__obligePropsBase = true;');
  const transforms = [...patched.matchAll(/transform:translate3d\(([^,]+),/g)].map((m) => m[1].trim());

  assert.ok(transforms.length >= 3, `expected the dock's transforms, found ${transforms.length}`);
  for (const x of transforms) {
    assert.equal(x, '-50%', `a dock transform uses X=${x}, which un-centres a left:50% element`);
  }
});
