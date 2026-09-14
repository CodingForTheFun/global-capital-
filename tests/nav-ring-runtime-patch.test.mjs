import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patchResearchUi } from '../lib/autoscout/research-ui-runtime-patch.mjs';
import { patchNavAndRingUi } from '../lib/autoscout/nav-ring-runtime-patch.mjs';

test('nav/ring runtime patch keeps research basis and installs compact glass navigation', () => {
  const original = readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');
  const researchPatched = patchResearchUi(original);
  const output = patchNavAndRingUi(researchPatched);

  assert.match(output, /var ids=\['season','l20','l15','l10','l5'\]/, 'headline research basis must not be changed');
  assert.match(output, /hits\+misses\+pushes===games/, 'ring must validate complete hit\/miss\/push counts');
  assert.match(output, /active=100\*hits\/games/, 'ring must derive percentage from exact counts');
  assert.match(output, /if\(!rates\)return null/, 'invalid samples must remain unavailable');
  assert.match(output, /class="asNavBrand"[^>]*>obligepay\.com<\/a>/, 'ObligePay capsule must be installed');
  assert.match(output, /backdrop-filter:blur\(\d+px\) saturate\(\d+%\)/, 'current premium glass treatment must be installed');
  assert.match(output, /height:44px!important/, 'base mobile nav must stay compact before the screenshot-target override');
  assert.match(output, /env\(safe-area-inset-bottom\)/, 'mobile nav must respect device safe area');
});
