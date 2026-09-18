import assert from 'node:assert/strict';
import test from 'node:test';
import { patchHeaderMenuUi } from '../lib/autoscout/header-menu-runtime-patch.mjs';

const productionShape = `var html = 'class="asBar" id="asProfileMenu"';`;

test('live header patch turns the existing account control into a hamburger menu', () => {
  const patched = patchHeaderMenuUi(productionShape);
  assert.match(patched, /__OBLIGE_LIVE_HEADER_MENU_V1__/);
  assert.match(patched, /asHeaderMenuIcon/);
  assert.match(patched, /Open menu/);
  assert.match(patched, /grid-template-areas:"brand search actions"/);
  assert.match(patched, /menu\.parentElement!==right/);
  assert.doesNotThrow(() => new Function(patched));
});

test('live header patch is idempotent', () => {
  const once = patchHeaderMenuUi(productionShape);
  assert.equal(patchHeaderMenuUi(once), once);
});

test('live header patch fails closed on the wrong UI surface', () => {
  assert.throws(
    () => patchHeaderMenuUi('var app = true;'),
    /could not locate the production header/,
  );
  assert.throws(
    () => patchHeaderMenuUi(`var html = 'class="asBar"';`),
    /could not locate the existing account menu/,
  );
});
