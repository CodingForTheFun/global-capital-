import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patchResearchUi } from '../lib/autoscout/research-ui-runtime-patch.mjs';
import { patchNavAndRingUi } from '../lib/autoscout/nav-ring-runtime-patch.mjs';
import { patchObligePropsVisualUi } from '../lib/autoscout/oblige-props-visual-runtime-patch.mjs';

test('Oblige Props visual layer keeps real-data UI and matches the mobile target structure', () => {
  const original = readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');
  const output = patchObligePropsVisualUi(patchNavAndRingUi(patchResearchUi(original)));

  assert.match(output, /\.asRingMid,#as5 \.asRingText\{display:none!important\}/, 'legacy SVG percentage must be hidden so the center percentage cannot overlap');
  assert.match(output, /grid-template-columns:repeat\(8,minmax\(0,1fr\)\)!important/, 'all eight metric cells must stay in one mobile row');
  assert.match(output, /\.asNavBrand\{display:grid!important/, 'center ObligePay capsule must remain visible on iPhone');
  assert.match(output, /minmax\(82px,1\.5fr\)/, '430px nav must reserve center space for the brand capsule');
  assert.match(output, /Available\\A At/, 'provider rail must expose the compact Available At label');
  assert.match(output, /Search players, teams, props\.\.\./, 'iPhone header search must be installed');
  assert.match(output, /class="asOblige">oblige<\/span><span class="asPay">pay<\/span>/, 'ObligePay wordmark must be installed without replacing backend routes');
  assert.match(output, /\.asSave:before\{content:"☆"/, 'save action must be represented as the compact card-corner star');
  assert.match(output, /env\(safe-area-inset-bottom\)/, 'floating navigation must respect iPhone safe area');
});
