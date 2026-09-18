import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { patchResearchUi } from '../lib/autoscout/research-ui-runtime-patch.mjs';
import { patchFantasyH2HUi } from '../lib/autoscout/fantasy-h2h-runtime-patch.mjs';
import { patchRecentFiveUi } from '../lib/autoscout/recent-five-runtime-patch.mjs';
import { patchNflPercentAndOpponentUi } from '../lib/autoscout/nfl-percent-opponent-runtime-patch.mjs';
import { patchNavAndRingUi } from '../lib/autoscout/nav-ring-runtime-patch.mjs';
import { patchPropBookSelectorUi } from '../lib/autoscout/prop-book-selector-runtime-patch.mjs';
import { patchResearchTabsUi } from '../lib/autoscout/research-tabs-runtime-patch.mjs';
import { patchLiveMainViewUi } from '../lib/autoscout/live-main-view-runtime-patch.mjs';
import { patchProplineRealtimeUi } from '../lib/autoscout/propline-realtime-runtime-patch.mjs';
import { patchProplineMarketUi } from '../lib/autoscout/propline-market-runtime-patch.mjs';
import { patchProplineInsightsUi } from '../lib/autoscout/propline-insights-runtime-patch.mjs';
import { patchProplineFullUi } from '../lib/autoscout/propline-full-runtime-patch.mjs';
import { patchProplinePushBoardUi } from '../lib/autoscout/propline-push-board-runtime-patch.mjs';
import { patchObligePropsVisualUi } from '../lib/autoscout/oblige-props-visual-runtime-patch.mjs';
import { patchPlayerDetailReferenceUi } from '../lib/autoscout/player-detail-reference-runtime-patch.mjs';

function productionUiBeforeReferencePatch() {
  let source = readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');
  source = patchResearchUi(source);
  source = patchFantasyH2HUi(source);
  source = patchRecentFiveUi(source);
  source = patchNflPercentAndOpponentUi(source);
  source = patchNavAndRingUi(source);
  source = patchPropBookSelectorUi(source);
  source = patchResearchTabsUi(source);
  source = patchLiveMainViewUi(source);
  source = patchProplineRealtimeUi(source);
  source = patchProplineMarketUi(source);
  source = patchProplineInsightsUi(source);
  source = patchProplineFullUi(source);
  source = patchProplinePushBoardUi(source);
  return patchObligePropsVisualUi(source);
}

test('dense player detail patch applies to the real production UI chain', () => {
  const patched = patchPlayerDetailReferenceUi(productionUiBeforeReferencePatch());

  assert.match(patched, /autoscout-player-detail-reference-v1/);
  assert.match(patched, /detailRefDecorateDrawer\(g,base,line,side\)/);
  assert.match(patched, /class=\\"asPeriodPills\\"/);
  assert.match(patched, /class=\\"asChartBar dnp\\"/);
  assert.match(patched, /class=\\"asHeaderOdds\\"/);
  assert.match(patched, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\) 38px/);

  const chartStart = patched.indexOf('function chartHtml(r){');
  const chartEnd = patched.indexOf('\nfunction secondaryHeaders', chartStart);
  const chart = patched.slice(chartStart, chartEnd);
  assert.ok(chartStart >= 0 && chartEnd > chartStart);
  assert.doesNotMatch(chart, /asChartLegend/);
  assert.match(chart, /Math\.max\(320,rows\.length\*38\)/);
});

test('dense player detail patch is idempotent', () => {
  const source = productionUiBeforeReferencePatch();
  const once = patchPlayerDetailReferenceUi(source);
  const twice = patchPlayerDetailReferenceUi(once);
  assert.equal(twice, once);
});

test('generated production client remains valid JavaScript after style and runtime extraction', () => {
  const patched = patchPlayerDetailReferenceUi(productionUiBeforeReferencePatch());
  const withStyle = patched.replace(
    /<style id="oblige-props-pixel-target">([\s\S]*?)<\/style>/,
    (_match, css) => `\n;(function(){var css=${JSON.stringify(css)};void css;})();\n`,
  );
  const client = withStyle.replace(
    /<script id="oblige-props-pixel-target-runtime">([\s\S]*?)<\/script>/,
    (_match, js) => `\n${js}\n`,
  );
  assert.doesNotThrow(() => new Function(client));
});
