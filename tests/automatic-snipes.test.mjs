import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  detectSnipe,
  detectStaleLine,
  findSnipeOpportunities,
  staleLineLabel,
} from '../lib/markets/line-lag.mjs';
import { buildSnipeRows, snipeTableHtml } from '../lib/ui/snipe-table.mjs';
import { patchResearchUi } from '../lib/autoscout/research-ui-runtime-patch.mjs';

const NOW = Date.parse('2026-09-13T23:15:00Z');
const fresh = new Date(NOW - 30_000).toISOString();
const old = new Date(NOW - 30 * 60_000).toISOString();

const quote = (sportsbookKey, sportsbook, side, line, extra = {}) => ({
  sportsbookKey,
  sportsbook,
  side,
  line,
  ingestedAt: fresh,
  ...extra,
});

test('two ordinary books disagreeing is not enough to manufacture a snipe', () => {
  const rows = [
    quote('prizepicks', 'PrizePicks', 'OVER', 25.5),
    quote('underdog', 'Underdog', 'OVER', 24.5),
  ];
  assert.equal(detectStaleLine(rows), null);
  assert.equal(detectSnipe(rows, { now: NOW }), null);
});

test('consensus line snipe requires target plus at least two independent references', () => {
  const signal = detectSnipe([
    quote('underdog', 'Underdog', 'OVER', 24.5),
    quote('prizepicks', 'PrizePicks', 'OVER', 25.5),
    quote('fanduel', 'FanDuel', 'OVER', 25.5),
  ], { now: NOW });

  assert.equal(signal.kind, 'line-consensus');
  assert.equal(signal.targetBook, 'Underdog');
  assert.equal(signal.side, 'OVER');
  assert.equal(signal.line, 24.5);
  assert.equal(signal.referenceLine, 25.5);
  assert.equal(signal.lineGap, 1);
  assert.equal(signal.referenceCount, 2);
  assert.equal(signal.supportCount, 2);
  assert.match(staleLineLabel(signal), /Underdog OVER 24.5 vs market 25.5/);
});

test('consensus snipes choose the bettor-friendlier UNDER number', () => {
  const signal = detectSnipe([
    quote('underdog', 'Underdog', 'UNDER', 8.5),
    quote('prizepicks', 'PrizePicks', 'UNDER', 7.5),
    quote('fanduel', 'FanDuel', 'UNDER', 7.5),
  ], { now: NOW });

  assert.equal(signal.kind, 'line-consensus');
  assert.equal(signal.targetBook, 'Underdog');
  assert.equal(signal.line, 8.5);
  assert.equal(signal.referenceLine, 7.5);
});

test('targetBooks limits where the bet is placed but not which books can be references', () => {
  const rows = [
    quote('underdog', 'Underdog', 'OVER', 24.5),
    quote('prizepicks', 'PrizePicks', 'OVER', 25.5),
    quote('fanduel', 'FanDuel', 'OVER', 25.5),
  ];
  assert.equal(findSnipeOpportunities(rows, { now: NOW, targetBooks: ['prizepicks'] }).length, 0);
  const opportunities = findSnipeOpportunities(rows, { now: NOW, targetBooks: ['underdog'] });
  assert.equal(opportunities.length, 1);
  assert.equal(opportunities[0].targetKey, 'underdog');
  assert.equal(opportunities[0].referenceCount, 2);
});

test('fresh ingestion keeps an unchanged provider quote eligible for live snipes', () => {
  const signal = detectSnipe([
    quote('underdog', 'Underdog', 'OVER', 24.5, { providerUpdatedAt: old }),
    quote('prizepicks', 'PrizePicks', 'OVER', 25.5, { providerUpdatedAt: old }),
    quote('fanduel', 'FanDuel', 'OVER', 25.5, { providerUpdatedAt: old }),
  ], { now: NOW });
  assert.equal(signal?.kind, 'line-consensus');
});

test('quotes that were not observed on a current board cannot create a snipe', () => {
  const signal = detectSnipe([
    { sportsbookKey: 'underdog', sportsbook: 'Underdog', side: 'OVER', line: 24.5, ingestedAt: old },
    { sportsbookKey: 'prizepicks', sportsbook: 'PrizePicks', side: 'OVER', line: 25.5, ingestedAt: old },
    { sportsbookKey: 'fanduel', sportsbook: 'FanDuel', side: 'OVER', line: 25.5, ingestedAt: old },
  ], { now: NOW });
  assert.equal(signal, null);
});

test('same-line sportsbook price snipe uses a two-book no-vig reference consensus', () => {
  const rows = [
    quote('fanduel', 'FanDuel', 'OVER', 25.5, { price: 105 }),
    quote('fanduel', 'FanDuel', 'UNDER', 25.5, { price: -125 }),
    quote('draftkings', 'DraftKings', 'OVER', 25.5, { price: -130 }),
    quote('draftkings', 'DraftKings', 'UNDER', 25.5, { price: 110 }),
    quote('betmgm', 'BetMGM', 'OVER', 25.5, { price: -125 }),
    quote('betmgm', 'BetMGM', 'UNDER', 25.5, { price: 105 }),
  ];
  const signal = findSnipeOpportunities(rows, { now: NOW, targetBooks: ['fanduel'] })[0];
  assert.equal(signal.kind, 'price-consensus');
  assert.equal(signal.targetBook, 'FanDuel');
  assert.equal(signal.referenceCount, 2);
  assert.ok(signal.edgePct >= 3);
  assert.match(staleLineLabel(signal), /estimated EV vs no-vig market/);
});

test('sharp stale-line evidence can still create a two-book snipe', () => {
  const signal = detectSnipe([
    quote('pinnacle', 'Pinnacle', 'OVER', 26.5, { price: -132 }),
    quote('fanduel', 'FanDuel', 'OVER', 25.5, { price: -108 }),
  ], { now: NOW });

  assert.equal(signal.kind, 'sharp-line');
  assert.equal(signal.source, 'sharp-lag');
  assert.equal(signal.targetBook, 'FanDuel');
  assert.equal(signal.referenceBook, 'Pinnacle');
});

test('dedicated snipe rows use all books as references while targeting selected books', () => {
  const group = {
    key: 'NBA|evt|player|points',
    sport: 'NBA',
    playerName: 'Example Player',
    market: 'Points',
    marketId: 'player_points',
    awayTeam: 'AWY',
    homeTeam: 'HME',
    gameStartTime: '2026-09-14T00:00:00Z',
    comparisonOffers: [
      quote('underdog', 'Underdog', 'OVER', 24.5),
      quote('prizepicks', 'PrizePicks', 'OVER', 25.5),
      quote('fanduel', 'FanDuel', 'OVER', 25.5),
    ],
  };

  const rows = buildSnipeRows([group], { sport: 'NBA', targetBooks: ['underdog'], now: NOW });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].groupKey, group.key);
  assert.equal(rows[0].targetBook, 'Underdog');

  const html = snipeTableHtml(rows);
  assert.match(html, /Take this quote/);
  assert.match(html, /Market reference/);
  assert.match(html, /Specific executable snipe/);
  assert.match(html, /data-open="NBA\|evt\|player\|points"/);
});

test('runtime UI patch creates a separate Snipes table and still parses', () => {
  const source = readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');
  const patched = patchResearchUi(source);

  assert.match(patched, /detectStaleLine, detectSnipe, staleLineLabel/);
  assert.match(patched, /snipe-table\.mjs/);
  assert.match(patched, /snipes:'Live Snipes'/);
  assert.match(patched, /data-view="snipes"/);
  assert.match(patched, /activeView==='snipes'\?snipeRows\(\):cardList\(\)/);
  assert.match(patched, /snipeTableHtml/);
  assert.match(patched, /No verified market snipes right now/);
  assert.match(patched, /Regular player props are intentionally not copied into this table/);
  assert.match(patched, /New market snipe detected/);
  assert.doesNotMatch(patched, /<button class="asBtn" id="asRefresh">Refresh<\/button>/);
  assert.match(patched, /<span id="asRefresh" hidden aria-hidden="true"><\/span>/);

  assert.doesNotThrow(() => new Function(patched));
});
