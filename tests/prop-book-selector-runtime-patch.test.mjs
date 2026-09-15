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
  const research = patchResearchUi(original);
  const fantasy = patchFantasyH2HUi(research);
  const recentFive = patchRecentFiveUi(fantasy);
  const nflPercent = patchNflPercentAndOpponentUi(recentFive);
  return patchNavAndRingUi(nflPercent);
}

test('each prop gets a real-book selector that reprices that card only', () => {
  const output = patchPropBookSelectorUi(productionUiSource());

  assert.match(output, /var propBookChoices=new Map\(\)/, 'selection must be scoped per prop card');
  assert.match(output, /data-prop-book=/, 'the sportsbook select must render inside each prop');
  assert.match(output, /All books · best line/, 'existing all-book best-line behavior must remain the default');
  assert.match(output, /rowMatchesPropBook\(g,r\)/, 'line and price selection must honor the card sportsbook');
  assert.match(output, /function defaultSide\(g\).*rowMatchesPropBook/s, 'the displayed side must come from the selected sportsbook when possible');
  assert.match(output, /propBookChoices\.set\(key,bookId\(select\.value\)\)/, 'changing the dropdown must update only that card state');
  assert.match(output, /renderListLight\(\)/, 'a book change must immediately redraw research values for the selected line');
  assert.match(output, /asPropBookQuote o/, 'the selector must expose the selected over line');
  assert.match(output, /asPropBookQuote u/, 'the selector must expose the selected under line');
  assert.match(output, /choices\.length\+' live book'/, 'the control must be built from live offers, not a hard-coded provider list');
});

test('sportsbook selector patch adds no provider request path and fails closed on drift', () => {
  const original = productionUiSource();
  const output = patchPropBookSelectorUi(original);
  const injected = output.slice(output.indexOf('var propBookChoices=new Map();'), output.indexOf('var {tacoBadgeHtml'));

  assert.doesNotMatch(injected, /fetch\s*\(/, 'the selector must stay cache-only and never request a provider');
  assert.doesNotMatch(injected, /PrizePicks|DraftKings|FanDuel|Underdog/, 'book choices must come from genuine rows instead of invented options');
  assert.throws(
    () => patchPropBookSelectorUi(original.replace('function oddsStrip(g){', 'function missingOddsStrip(g){')),
    /could not locate sportsbook strip start/,
    'a future UI shape change must stop the runtime build instead of silently dropping the control',
  );
});
