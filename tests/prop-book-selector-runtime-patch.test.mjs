import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patchResearchUi } from '../lib/autoscout/research-ui-runtime-patch.mjs';
import { patchFantasyH2HUi } from '../lib/autoscout/fantasy-h2h-runtime-patch.mjs';
import { patchRecentFiveUi } from '../lib/autoscout/recent-five-runtime-patch.mjs';
import { patchNflPercentAndOpponentUi } from '../lib/autoscout/nfl-percent-opponent-runtime-patch.mjs';
import { patchNavAndRingUi } from '../lib/autoscout/nav-ring-runtime-patch.mjs';
import { patchPropBookSelectorUi } from '../lib/autoscout/prop-book-selector-runtime-patch.mjs';

function productionUiSource() {
  const original = readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');
  return patchNavAndRingUi(patchNflPercentAndOpponentUi(patchRecentFiveUi(patchFantasyH2HUi(patchResearchUi(original)))));
}

test('each prop gets a real-book selector that reprices that card only', () => {
  const output = patchPropBookSelectorUi(productionUiSource());
  assert.match(output, /var propBookChoices=new Map\(\)/);
  assert.match(output, /data-prop-book=/);
  assert.match(output, /All books · best line/);
  assert.match(output, /rowMatchesPropBook\(g,r\)/);
  assert.match(output, /function defaultSide\(g\).*rowMatchesPropBook/s);
  assert.match(output, /propBookChoices\.set\(key,bookId\(select\.value\)\)/);
  assert.match(output, /renderListLight\(\)/);
  assert.match(output, /quote\(over,'OVER'\)/);
  assert.match(output, /quote\(under,'UNDER'\)/);
  assert.match(output, /choices\.length\+' live book'/);
});

test('sportsbook selector patch adds no provider request path and fails closed on drift', () => {
  const original = productionUiSource();
  const output = patchPropBookSelectorUi(original);
  const injected = output.slice(output.indexOf('var propBookChoices=new Map();'), output.indexOf('var {tacoBadgeHtml'));
  assert.doesNotMatch(injected, /fetch\s*\(/);
  assert.doesNotMatch(injected, /PrizePicks|DraftKings|FanDuel|Underdog/);
  assert.throws(() => patchPropBookSelectorUi(original.replace('function oddsStrip(g){', 'function missingOddsStrip(g){')), /could not locate sportsbook strip start/);
});
