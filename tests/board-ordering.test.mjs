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
  // Every paid entry point must sit behind a user gesture. For each call site,
  // the nearest preceding handler must be closer than the nearest preceding
  // render function — a call added inside a render path would invert that.
  const HANDLER = /onclick\s*=|addEventListener\(\s*'(?:click|submit)'/g;
  for (const fn of ['runProjection', 'askAbout']) {
    const call = new RegExp(`(?<!function )${fn}\\(`, 'g');
    let match;
    let sites = 0;
    while ((match = call.exec(ui)) !== null) {
      sites += 1;
      const before = ui.slice(0, match.index);
      const handlerAt = Math.max(...[...before.matchAll(HANDLER)].map((m) => m.index), -1);
      const renderAt = before.lastIndexOf('function render');
      assert.ok(
        handlerAt > renderAt,
        `${fn} call at ${match.index} is not behind a click or submit handler`,
      );
    }
    assert.ok(sites >= 1, `${fn} should be called somewhere`);
  }
});

test('credit cost per refresh follows markets x regions and is reported', () => {
  const settings = ['THE_ODDS_API_REGIONS', 'THE_ODDS_API_MAX_MARKETS_PER_EVENT',
    'THE_ODDS_API_MAX_EVENTS', 'THE_ODDS_API_BOOKMAKERS', 'THE_ODDS_API_MAX_CREDITS_PER_REFRESH'];
  const previous = Object.fromEntries(settings.map(key => [key, process.env[key]]));
  try {
    process.env.THE_ODDS_API_MAX_EVENTS = '25';
    process.env.THE_ODDS_API_BOOKMAKERS = 'prizepicks,underdog,pick6,dabble_us_dfs,draftkings,fanduel,betmgm,williamhill_us,fanatics,betrivers';
    process.env.THE_ODDS_API_MAX_CREDITS_PER_REFRESH = '250';
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

    // The full-coverage estimate still exposes the cost of wider scope, while
    // the executable refresh estimate must respect its independent budget.
    // Discovery costs one per event; listing the events costs zero.
    assert.equal(wide.fullCoverageCeiling, 25 * (125 + 1));
    assert.equal(narrow.fullCoverageCeiling, 25 * (6 + 1));
    assert.ok(wide.fullCoverageCeiling > narrow.fullCoverageCeiling * 10);
    assert.equal(wide.creditsPerRefresh, 250);
    assert.equal(narrow.creditsPerRefresh, 175);
    process.env.THE_ODDS_API_MAX_CREDITS_PER_REFRESH = '50';
    assert.equal(projectedCreditsPerRefresh().creditsPerRefresh, 50);
  } finally {
    for (const key of settings) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('promotional and non-over/under markets stay excluded when markets widen', () => {
  const provider = readFileSync(new URL('../lib/autoscout/providers/the-odds-api.mjs', import.meta.url), 'utf8');
  // Widening the market list must not quietly readmit alternate lines.
  assert.match(provider, /if \(!includeAlternates && value\.includes\('_alternate'\)\) return false;/);
  assert.match(provider, /if \(NON_OU_MARKETS\.has\(value\)\) return false;/);
});
