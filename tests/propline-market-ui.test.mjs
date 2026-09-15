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
import { patchLiveMainViewUi } from '../lib/autoscout/live-main-view-runtime-patch.mjs';
import { patchProplineRealtimeUi } from '../lib/autoscout/propline-realtime-runtime-patch.mjs';
import { patchProplineMarketUi } from '../lib/autoscout/propline-market-runtime-patch.mjs';

const source = readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');

function productionChain() {
  const research = patchResearchUi(source);
  const fantasy = patchFantasyH2HUi(research);
  const recent = patchRecentFiveUi(fantasy);
  const nfl = patchNflPercentAndOpponentUi(recent);
  const nav = patchNavAndRingUi(nfl);
  const books = patchPropBookSelectorUi(nav);
  const tabs = patchResearchTabsUi(books);
  const live = patchLiveMainViewUi(tabs);
  const realtime = patchProplineRealtimeUi(live);
  return patchProplineMarketUi(realtime);
}

test('PropLine market rail survives the exact production UI patch order', () => {
  const patched = productionChain();

  assert.match(patched, /BEST LINE \+ PRICE/);
  assert.match(patched, /implied/);
  assert.match(patched, /Market change/);
  assert.match(patched, /data-book-link/);
  assert.match(patched, /safeBookLink/);
  assert.match(patched, /book gap/);
  assert.match(patched, /asOddsRail/);
  assert.doesNotThrow(() => new Function(patched));
});

test('PropLine rail preserves the per-prop sportsbook selector and excludes alternates from ranking', () => {
  const patched = productionChain();

  assert.match(patched, /data-prop-book/);
  assert.match(patched, /propBookFor\(g\)/);
  assert.match(patched, /All books · best line/);
  assert.match(patched, /if\(r\.isAlternate\)return/);

  // PrizePicks Goblin/Demon remains in the verified special strip rather than
  // being promoted into the regular cross-book Best Line rail.
  assert.match(patched, /specialRows:specials\.get\(g\.key\)\|\|\[\]/);
  assert.match(patched, /prizePicksSpecialStrip\(g\)/);
});

test('mobile available-lines rail uses the full width without pushing research stats farther down', () => {
  const patched = productionChain();

  // Two books fill one row; additional books remain horizontally scrollable.
  assert.match(patched, /flex:0 0 calc\(50% - 4px\)!important/);
  assert.match(patched, /min-height:76px!important/);
  assert.match(patched, /overflow-x:auto!important/);
  assert.doesNotMatch(patched, /@media\(max-width:540px\)[^`]*flex-basis:148px!important/);
});
