// The Compare tab used to be Props with a different sort.
//
// Every board view rendered the identical card body, so "Line Discrepancies"
// ranked props by how much the books disagreed and then showed a chip strip
// that never displayed the disagreement. A reader was told a difference
// existed and given no way to see it. These pin the fix: Compare renders a
// book-by-book table, and it is genuinely a different body from every other
// tab rather than the same one reordered.
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
import { compareResearchQuotes } from '../lib/ui/line-comparison.mjs';

const source = () => readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');
// The exact chain the image builds, so this proves what actually ships.
const productionClient = () => patchResearchTabsUi(patchPropBookSelectorUi(patchNavAndRingUi(
  patchNflPercentAndOpponentUi(patchRecentFiveUi(patchFantasyH2HUi(patchResearchUi(source())))))));

test('the card body differs by view instead of being one body for all tabs', () => {
  const s = source();
  assert.match(s, /activeView==='discrepancies'\?compareTable\(g\):oddsStrip\(g\)/,
    'Compare must render its own body, not the shared chip strip');
  assert.match(s, /function compareTable\(g\)\{/);
});

// prop-book-selector replaces everything between `function oddsStrip(g){` and
// the sharp-value comment, and throws if that needle is not unique. compareTable
// must therefore sit outside that block and must not duplicate the needle.
test('compareTable is placed where the sportsbook-strip patch cannot delete it', () => {
  const s = source();
  assert.equal((s.match(/function oddsStrip\(g\)\{/g) || []).length, 1, 'oddsStrip must stay unique');
  assert.ok(s.indexOf('function compareTable(g){') < s.indexOf('function oddsStrip(g){'),
    'compareTable must precede the replaced block so it survives the build');
});

test('compareTable survives the whole production patch chain', () => {
  const client = productionClient();
  assert.ok(client.includes('function compareTable(g){'), 'the table must reach the shipped bundle');
  assert.ok(client.includes("activeView==='discrepancies'?compareTable(g):oddsStrip(g)"));
});

// The tabs patch renames the views downstream; the Book Compare tab still
// carries the `discrepancies` key, which is what the card body branches on.
// If that key is ever renamed, this catches it before the table silently
// stops rendering and Compare quietly becomes Props again.
test('the Book Compare tab still keys off the view compareTable branches on', () => {
  const client = productionClient();
  assert.match(client, /discrepancies:'Book Compare'/, 'Compare tab key must stay in sync with the card body');
});

// The honesty property the table leans on: one book is never "the best price".
const quote = (book, side, line, price) => ({
  sport: 'NFL', eventId: 'e1', marketId: 'player_pass_yds', playerId: 'p1', playerName: 'A B',
  entityType: 'player', period: 'game', side, line, price,
  sportsbookKey: book, sportsbook: book, updatedAt: new Date().toISOString(),
});

// Player Index used to be props sorted A-Z: the tab named an index of players
// and listed one card per prop, which is why it read as Props again.
test('Player Index renders one entry per player, not one per prop', () => {
  const s = source();
  assert.match(s, /function playerIndexUnits\(list\)\{/);
  assert.match(s, /playerIndex\?shown\.map\(playerIndexHtml\):shown\.map\(rowHtml\)/,
    'the player view must render its own body');
});

// A player's markets must never be split across two pages, so the page size
// has to count whatever is actually listed rather than always counting props.
test('pagination counts the units actually listed', () => {
  const s = source();
  assert.match(s, /renderPagination\(units\.length\)/);
  assert.match(s, /Math\.ceil\(units\.length\/PAGE_SIZE\)/);
  assert.ok(!/renderPagination\(a\.length\)/.test(s), 'must not page props while listing players');
});

// Each market keeps the key the existing row binding opens, so a market opens
// that prop's drawer without any new click wiring.
test('every market in the index opens its own prop drawer', () => {
  const s = source();
  const fn = s.slice(s.indexOf('function playerIndexHtml(p){'), s.indexOf('function researchParams'));
  assert.match(fn, /data-open="'\+esc\(g\.key\)\+'"/, 'markets must carry the drawer key');
});

test('Player Index survives the production patch chain', () => {
  const client = productionClient();
  assert.ok(client.includes('function playerIndexHtml(p){'));
  assert.match(client, /players:'Player Index'/);
});

test('a lone quote is never marked best; two comparable books are', () => {
  const group = { sport: 'NFL', eventId: 'e1', marketId: 'player_pass_yds', playerId: 'p1', playerName: 'A B', entityType: 'player', period: 'game' };
  const solo = compareResearchQuotes({ ...group, rows: [quote('bookA', 'OVER', 250.5, -110)] }, { line: 250.5, side: 'OVER' });
  assert.deepEqual(solo.bestPrices.OVER, [], 'one book alone cannot be a best price');

  const pair = compareResearchQuotes({ ...group, rows: [
    quote('bookA', 'OVER', 250.5, -110), quote('bookB', 'OVER', 250.5, -105),
  ] }, { line: 250.5, side: 'OVER' });
  assert.equal(pair.bestPrices.OVER.length, 1);
  // compareResearchQuotes lowercases the book key, and compareTable compares
  // against that same normalised value, so the two always agree.
  assert.equal(pair.bestPrices.OVER[0].bookKey, 'bookb', 'the better payout wins');
});

test('the table has a row per book carrying both sides and a line', () => {
  const group = { sport: 'NFL', eventId: 'e1', marketId: 'player_pass_yds', playerId: 'p1', playerName: 'A B', entityType: 'player', period: 'game' };
  const c = compareResearchQuotes({ ...group, rows: [
    quote('bookA', 'OVER', 250.5, -110), quote('bookA', 'UNDER', 250.5, -110),
    quote('bookB', 'OVER', 249.5, -115),
  ] }, { line: 250.5, side: 'OVER' });
  const a = c.rows.find(r => r.bookKey === 'booka');
  assert.ok(a && a.OVER && a.UNDER, 'a book quoting both sides yields one row with both');
  assert.equal(a.line, 250.5);
  assert.ok(c.rows.some(r => r.bookKey === 'bookb' && r.line === 249.5), 'a differing line is its own row');
});
