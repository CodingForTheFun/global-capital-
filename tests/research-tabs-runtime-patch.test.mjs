import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patchResearchUi } from '../lib/autoscout/research-ui-runtime-patch.mjs';
import { patchFantasyH2HUi } from '../lib/autoscout/fantasy-h2h-runtime-patch.mjs';
import { patchRecentFiveUi } from '../lib/autoscout/recent-five-runtime-patch.mjs';
import { patchNflPercentAndOpponentUi } from '../lib/autoscout/nfl-percent-opponent-runtime-patch.mjs';
import { patchNavAndRingUi } from '../lib/autoscout/nav-ring-runtime-patch.mjs';
import { patchPropBookSelectorUi } from '../lib/autoscout/prop-book-selector-runtime-patch.mjs';
import { patchResearchTabsUi } from '../lib/autoscout/research-tabs-runtime-patch.mjs';

function productionResearchClient() {
  const source = readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');
  const research = patchResearchUi(source);
  const fantasy = patchFantasyH2HUi(research);
  const recent = patchRecentFiveUi(fantasy);
  const nfl = patchNflPercentAndOpponentUi(recent);
  const nav = patchNavAndRingUi(nfl);
  const books = patchPropBookSelectorUi(nav);
  return patchResearchTabsUi(books);
}

test('bottom research tabs use the former Trends slot for real live Scores', () => {
  const client = productionResearchClient();
  assert.match(client, /players:'Player Index'/);
  assert.match(client, /snipes:'Best Lines'/);
  assert.match(client, /discrepancies:'Book Compare'/);
  assert.match(client, /class="asNavScores"[^>]*>[\s\S]*?<span>Scores<\/span><\/button>/);
  assert.doesNotMatch(client, /<button data-view="popular"[^>]*>[\s\S]*?<span>Trends<\/span><\/button>/);
  assert.match(client, /<span>Best Lines<\/span>/);
  assert.doesNotMatch(client, /activeView==='snipes'[^\n]*a=a\.filter\(g=>staleFor\(g\)\)/);
  assert.doesNotMatch(client, /activeView==='discrepancies'[^\n]*a=a\.filter\(g=>spreads\.get\(g\.key\)>0\)/);
});

test('legacy Trends ranking remains non-empty if deep-linked while Scores owns the nav slot', () => {
  const client = productionResearchClient();
  assert.match(client, /xw=xr\?\.windows\?\.l5/);
  assert.match(client, /yr5-xr5\|\|yg-xg\|\|books\(y\)\.length-books\(x\)\.length/);
  assert.match(client, /trend history is still loading, props fall back to strongest live book coverage/i);
});

test('Best Lines and Compare keep live rows visible when a special signal is absent', () => {
  const client = productionResearchClient();
  assert.match(client, /Number\(Boolean\(staleFor\(y\)\)\)-Number\(Boolean\(staleFor\(x\)\)\)/);
  assert.match(client, /bestLineSpreads/);
  assert.match(client, /if\(multiBook\.length\)a=multiBook/);
  assert.match(client, /if only one book is available, the live quote still remains visible instead of a blank page/i);
  assert.doesNotThrow(() => new Function(client));
});

test('production bootstrap applies the research-tabs patch before the inline score view patch', () => {
  const frontdoor = readFileSync(new URL('../frontdoor-clearsports.mjs', import.meta.url), 'utf8');
  assert.match(frontdoor, /patchResearchTabsUi/);
  assert.match(frontdoor, /patchLiveMainViewUi/);
  assert.ok(frontdoor.indexOf('patchResearchTabsUi(patchedPropBookSelectorUi)') < frontdoor.indexOf('patchLiveMainViewUi(patchedResearchTabsUi)'));
});
