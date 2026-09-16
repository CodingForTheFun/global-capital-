// Ten paid PropLine endpoints were reachable and invisible: the data layer and
// /api/apex/propline existed, and nothing in the UI ever called them. The drawer
// is the right home for eight of them - it is already the per-prop view and
// already knows the player, market, side and event.
//
// These tests run the patch against the real client and pin that it stays
// enrichment: never blocking, never claiming more than the data supports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patchProplineInsightsUi } from '../lib/autoscout/propline-insights-runtime-patch.mjs';

const source = readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');
const patched = patchProplineInsightsUi(source);

test('the patched client is valid JavaScript', () => {
  // makeClientSafeVisualUi runs new Function() on this at boot; invalid client
  // JS does not fail the build, it fails the container.
  assert.doesNotThrow(() => new Function(patched));
});

test('it applies exactly once at each anchor', () => {
  assert.equal(patched.split('\n loadProplineInsights(g);').length - 1, 1, 'one call site');
  assert.equal(patched.split('function loadProplineInsights(').length - 1, 1, 'one definition');
  assert.equal(patched.split('id="asProplineInsights"').length - 1, 1, 'one section');
});

test('re-running the patch changes nothing instead of duplicating it', () => {
  // This patch inserts beside anchors that survive, so without a guard a second
  // run would define every function twice and append a second section.
  assert.equal(patchProplineInsightsUi(patched), patched);
});

test('all eight per-prop insights are requested', () => {
  for (const kind of ['trends', 'movement', 'best-line', 'closing', 'context', 'projections', 'results']) {
    assert.match(patched, new RegExp(`proplineAsk\\('${kind}'`), `${kind} must be asked for`);
  }
});

test('a stale closing line is labelled, never shown as a real close', () => {
  assert.match(patched, /c\.stale\?'<i class="asPlWarn">close captured early<\/i>':''/);
});

test('a market-implied projection is not passed off as this product modelling it', () => {
  assert.match(patched, /implied by the no-vig market, not a model/);
});

test('a hit rate is only drawn when its sample size is known', () => {
  assert.match(patched, /if\(w\.hitRate==null\|\|!w\.games\)return '';/,
    'a percentage without a sample is not a fact');
});

test('an absent answer hides the section rather than showing an empty shell', () => {
  assert.match(patched, /if\(!html\)\{host\.hidden=true;host\.innerHTML='';return;\}/);
});

test('a failed load can never break the drawer', () => {
  assert.match(patched, /\.catch\(function\(\)\{host\.hidden=true;\}\)/);
  assert.match(patched, /\.catch\(function\(\)\{return null;\}\)/, 'each request degrades on its own');
});

test('a prop opened while requests are in flight does not get the previous prop data', () => {
  assert.match(patched, /if\(token!==proplineToken\)return;/);
});

test('it loads after the drawer has rendered, so research is never delayed', () => {
  const bodyAssign = patched.indexOf("document.getElementById('asDrawerBody').innerHTML=");
  const loadCall = patched.indexOf('\n loadProplineInsights(g);');
  assert.ok(loadCall > bodyAssign, 'enrichment must follow the render it decorates');
});

test('requests are cached, so reopening a prop does not spend the quota again', () => {
  assert.match(patched, /if\(proplineCache\.has\(key\)\)return Promise\.resolve\(proplineCache\.get\(key\)\);/);
});
