import assert from 'node:assert/strict';
import test from 'node:test';
import { patchMobileNavDockUi } from '../lib/autoscout/mobile-nav-dock-runtime-patch.mjs';

test('mobile nav dock patch is idempotent and emits valid client JavaScript', () => {
  const source = 'window.__obligePropsBase = true;';
  const patched = patchMobileNavDockUi(source);

  assert.match(patched, /mobile-nav-dock-runtime-v1/);
  assert.match(patched, /asNavDockToggle/);
  assert.match(patched, /asNavDockOpen/);
  assert.match(patched, /safe-area-inset-right/);
  assert.match(patched, /background:rgba\(4,12,25,\.17\)!important/);
  assert.match(patched, /max-height:min\(72vh,520px\)!important/);
  assert.match(patched, /aria-expanded/);
  assert.match(patched, /Open navigation/);
  assert.match(patched, /event\.key==='Escape'/);
  assert.match(patched, /prefers-reduced-motion:reduce/);
  assert.doesNotThrow(() => new Function(patched));
  assert.equal(patchMobileNavDockUi(patched), patched);
});
