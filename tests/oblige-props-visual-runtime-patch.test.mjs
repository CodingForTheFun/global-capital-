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
  // The edge build renames that midpoint to .asRingCenter, so hiding only
  // .asRingMid left two centre percentages stacked in the same box.
  assert.match(
    output,
    /#as5 \.asRing\[data-premium-ring="1"\] \.asRingCenter\{display:none!important\}/,
    'the edge build centre percentage must be hidden wherever the premium hit-rate centre replaces it',
  );
  assert.match(output, /grid-template-columns:repeat\(8,minmax\(0,1fr\)\)!important/, 'all eight metric cells must stay in one mobile row');
  assert.match(output, /\.asNavBrand\{display:grid!important/, 'center ObligePay capsule must remain visible on iPhone');
  assert.match(output, /minmax\(82px,1\.5fr\)/, '430px nav must reserve center space for the brand capsule');
  assert.match(output, /Available\\A At/, 'provider rail must expose the compact Available At label');
  assert.match(output, /Search players, teams, props\.\.\./, 'iPhone header search must be installed');
  assert.match(output, /class="asOblige">oblige<\/span><span class="asPay">pay<\/span>/, 'ObligePay wordmark must be installed without replacing backend routes');
  assert.match(output, /\.asSave:before\{content:"☆"/, 'save action must be represented as the compact card-corner star');
  assert.match(output, /env\(safe-area-inset-bottom\)/, 'floating navigation must respect iPhone safe area');
});

test('the centre hit rate fits inside the donut hole at every ring size', () => {
  const original = readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');
  const output = patchObligePropsVisualUi(patchNavAndRingUi(patchResearchUi(original)));

  // The ring is viewBox 64 with r=26, so the hole radius is (26 - stroke/2)
  // scaled by size/64. The percentage is typeset in whatever the font stack
  // resolves to: the app names Inter but never loads an @font-face for it, so
  // the real metric is the system fallback, measured at 3.246x the font size
  // for the widest value ("57.6%") and one line box tall.
  const stroke = Number(/#as5 \.asRingSvg circle\{stroke-width:(\d+(?:\.\d+)?)!important\}/.exec(output)?.[1]);
  assert.ok(Number.isFinite(stroke), 'ring stroke width must be pinned in the patch');
  const WIDEST = 3.246, reach = f => Math.hypot(WIDEST * f / 2, f / 2);

  // Only this patch's own stylesheet matters: it is appended last and every one
  // of its ring rules is !important, so it overrides the nav/ring sheet that
  // ships earlier in the bundle. Walking both as one stylesheet would pair a
  // ring size from one with a font size from the other.
  const sheet = /<style id="oblige-props-pixel-target">([\s\S]*?)<\/style>/.exec(output)?.[1];
  assert.ok(sheet, 'the visual patch stylesheet must be present');
  // Walk the cascade: base rules first, then each narrower media block, each
  // inheriting whatever it does not restate.
  const blocks = sheet.split(/@media\(max-width:(\d+)px\)\{/);
  let size = null, font = null, checked = 0;
  for (let i = 0; i < blocks.length; i += (i === 0 ? 1 : 2)) {
    const css = i === 0 ? blocks[0] : blocks[i + 1];
    if (!css) continue;
    const sizes = [...css.matchAll(/#as5 [^{]*\.asRingSvg[^{]*\{width:(\d+)px!important/g)];
    const fonts = [...css.matchAll(/#as5 \.asHitChance strong\{font-size:(\d+)px!important/g)];
    if (sizes.length) size = Number(sizes.at(-1)[1]);
    if (fonts.length) font = Number(fonts.at(-1)[1]);
    if (size == null || font == null) continue;
    const hole = size * (26 - stroke / 2) / 64;
    assert.ok(
      reach(font) <= hole - 2,
      `a ${font}px percentage reaches ${reach(font).toFixed(1)}px inside a ${size}px ring whose hole is ${hole.toFixed(1)}px — it would touch the stroke`,
    );
    checked++;
  }
  assert.ok(checked >= 4, `every ring size must be covered, only checked ${checked}`);

  // The caption used to sit under the number inside the hole, where nothing of
  // that width fits. It stays in the DOM for screen readers but must not paint.
  assert.match(
    output,
    /#as5 \.asHitChance span\{position:absolute!important;[^}]*clip-path:inset\(50%\)!important/,
    'the centre caption must be screen-reader only, not painted inside the donut',
  );
  assert.match(output, /#as5 \.asRingLegend \.asWin b\{/, 'the legend must mark which side the centre number reports');
});

test('an absent value is stated but never wears the typography of a result', () => {
  const original = readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');
  const output = patchObligePropsVisualUi(patchNavAndRingUi(patchResearchUi(original)));

  // The board already rendered a missing value muted via .asUnavailable; the
  // drawer panels showed "Unavailable" in the same large green type as a real
  // hit rate, so a gap read as a broken number.
  assert.match(output, /#as5 \.asMatchMetric>strong\.asUnavailable\{/,
    'a missing hit rate must be styled down, not shown in the result colour');
  assert.match(output, /tidyUnavailable\(\)/, 'the decorator must run');
  for (const slot of ['.asMatchMetric>strong', '.asMatchMetric dd', '.asCtx b', '.asProjectedStat b']) {
    assert.ok(output.includes(slot), `${slot} must be covered by the unavailable pass`);
  }

  // This string reaches the browser through a template literal, where an
  // escaped slash collapses and would end a regex literal early — the bundle
  // then fails to parse and the whole board white-screens. Compare plainly.
  // Slice forward from the function itself: the nav/ring patch ships its own
  // decorate() earlier in the bundle, so anchoring on that name finds the wrong one.
  const start = output.indexOf('function tidyUnavailable');
  assert.ok(start > 0, 'the unavailable pass must be present');
  const decorator = output.slice(start, start + 700);
  assert.doesNotMatch(decorator, /\/\^|\$\//, 'no regex literal may be emitted here');
  assert.match(decorator, /toLowerCase\(\)/);
  assert.match(decorator, /'n\/a'/);
});
