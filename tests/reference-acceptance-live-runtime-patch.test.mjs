import assert from 'node:assert/strict';
import test from 'node:test';
import { patchReferenceAcceptanceLiveUi } from '../lib/autoscout/reference-acceptance-live-runtime-patch.mjs';

test('live reference acceptance extends the existing Oblige Props style block', () => {
  const source = 'before\n<style id="oblige-props-pixel-target">\n#as5{display:block}\n</style>\nafter';
  const patched = patchReferenceAcceptanceLiveUi(source);

  assert.match(patched, /oblige-reference-acceptance-live-v286/);
  assert.match(patched, /--oblige-reference-acceptance:v286/);
  assert.match(patched, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.equal((patched.match(/<style id="oblige-props-pixel-target">/g) || []).length, 1);
  assert.ok(patched.indexOf('oblige-reference-acceptance-live-v286') < patched.indexOf('</style>'));
});

test('live reference acceptance is idempotent', () => {
  const source = '<style id="oblige-props-pixel-target">#as5{}</style>';
  const once = patchReferenceAcceptanceLiveUi(source);
  const twice = patchReferenceAcceptanceLiveUi(once);
  assert.equal(twice, once);
});

test('live reference acceptance fails closed when the production style anchor is absent', () => {
  assert.throws(
    () => patchReferenceAcceptanceLiveUi('const app = true;'),
    /could not locate the Oblige Props style anchor/,
  );
});
