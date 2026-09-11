import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { projectedCreditsPerRefresh } from '../lib/autoscout/providers/the-odds-api.mjs';

const ui = readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');

// The shuffle lives in the injected client bundle, so lift the function out and
// exercise the real source rather than a copy of it.
function loadFisherYates() {
  const start = ui.indexOf('function fisherYates(');
  assert.ok(start > -1, 'fisherYates should exist in the client bundle');
  const end = ui.indexOf('\nfunction ', start + 10);
  // eslint-disable-next-line no-new-func
  return new Function(`${ui.slice(start, end)}\n; return fisherYates;`)();
}

test('Fisher-Yates keeps every element exactly once', () => {
  const fisherYates = loadFisherYates();
  const input = Array.from({ length: 200 }, (_, i) => `prop-${i}`);
  const shuffled = fisherYates(input);
  assert.equal(shuffled.length, input.length);
  assert.deepEqual([...shuffled].sort(), [...input].sort());
  // The source array is not mutated; the board keeps its own ordering.
  assert.deepEqual(input, Array.from({ length: 200 }, (_, i) => `prop-${i}`));
  assert.deepEqual(fisherYates([]), []);
  assert.deepEqual(fisherYates(['only']), ['only']);
});

test('the shuffle actually reorders and is not biased to a fixed permutation', () => {
  const fisherYates = loadFisherYates();
  const input = Array.from({ length: 50 }, (_, i) => i);
  const runs = Array.from({ length: 25 }, () => fisherYates(input).join(','));
  // Two independent shuffles landing on the identical order 25 times would mean
  // the shuffle is not shuffling.
  assert.ok(new Set(runs).size > 1, 'repeated shuffles should differ');
  assert.ok(runs.some((run) => run !== input.join(',')), 'at least one run should not be the input order');

  // Every index should reach the first slot sometimes across many runs — a
  // shuffle that only rotates, or only swaps neighbours, would fail this.
  const firsts = new Set(Array.from({ length: 300 }, () => fisherYates(input)[0]));
  assert.ok(firsts.size > 10, `expected many distinct first elements, saw ${firsts.size}`);
});

test('the board shuffles once per load, not once per render', () => {
  // Re-shuffling inside the render path would move a card out from under the
  // reader and make a page number mean two different things.
  assert.match(ui, /function reshuffleBoard\(\)/);
  assert.match(ui, /reshuffleBoard\(\);page=1;/);
  assert.equal(/function renderListLight\(\)[\s\S]{0,2000}reshuffleBoard\(/.test(ui), false);
});

test('pagination is 20 per page with previous, next and a page indicator', () => {
  assert.match(ui, /var PAGE_SIZE=20;/);
  assert.match(ui, /Page '\+page\+' of '\+pages/);
  assert.match(ui, /id="asPrev"/);
  assert.match(ui, /id="asNext"/);
  // Both ends are disabled rather than wrapping around.
  assert.match(ui, /\(page<=1\?'disabled':''\)/);
  assert.match(ui, /\(page>=pages\?'disabled':''\)/);
});

test('the prediction button is explicit, never fired by a render', () => {
  assert.match(ui, /data-predict=/);
  assert.match(ui, /Generate AI Prediction/);
  // One definition plus exactly two call sites, and both sit inside a click
  // handler — nothing reaches a paid request from a render path.
  const calls = ui.match(/runProjection\(/g) || [];
  assert.equal(calls.length, 3, 'expected one definition and two call sites');
  const handlerCalls = ui.match(/onclick=[^;]{0,120}runProjection\(/g) || [];
  const guardedCalls = ui.match(/if\(g\)runProjection\(/g) || [];
  assert.equal(handlerCalls.length + guardedCalls.length, 2, 'every call site should be a click handler');
});

test('credit cost per refresh follows markets x regions and is reported', () => {
  const previous = process.env.THE_ODDS_API_REGIONS;
  const previousMarkets = process.env.THE_ODDS_API_MAX_MARKETS_PER_EVENT;
  try {
    // Regions scope: five regions bill five times one.
    process.env.THE_ODDS_API_REGIONS = 'us,us2,us_dfs,eu,uk';
    process.env.THE_ODDS_API_MAX_MARKETS_PER_EVENT = '25';
    const wide = projectedCreditsPerRefresh();
    assert.equal(wide.scope, 'regions');
    assert.equal(wide.billedRegions, 5);
    assert.equal(wide.creditsPerEvent, 125);

    // Bookmaker scope: every group of ten books bills as one region.
    process.env.THE_ODDS_API_REGIONS = 'off';
    process.env.THE_ODDS_API_MAX_MARKETS_PER_EVENT = '6';
    const narrow = projectedCreditsPerRefresh();
    assert.equal(narrow.scope, 'bookmakers');
    assert.equal(narrow.billedRegions, 1);
    assert.equal(narrow.creditsPerEvent, 6);

    // The whole point of reporting it: the difference is large and visible.
    assert.ok(wide.creditsPerRefresh > narrow.creditsPerRefresh * 10);
  } finally {
    if (previous === undefined) delete process.env.THE_ODDS_API_REGIONS;
    else process.env.THE_ODDS_API_REGIONS = previous;
    if (previousMarkets === undefined) delete process.env.THE_ODDS_API_MAX_MARKETS_PER_EVENT;
    else process.env.THE_ODDS_API_MAX_MARKETS_PER_EVENT = previousMarkets;
  }
});

test('promotional and non-over/under markets stay excluded when markets widen', () => {
  const provider = readFileSync(new URL('../lib/autoscout/providers/the-odds-api.mjs', import.meta.url), 'utf8');
  // Widening the market list must not quietly readmit alternate lines.
  assert.match(provider, /if \(!includeAlternates && value\.includes\('_alternate'\)\) return false;/);
  assert.match(provider, /if \(NON_OU_MARKETS\.has\(value\)\) return false;/);
});
