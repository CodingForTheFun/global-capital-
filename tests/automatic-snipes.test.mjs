import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectSnipe, detectStaleLine, findSnipeOpportunities, staleLineLabel } from '../lib/markets/line-lag.mjs';
import { patchResearchUi } from '../lib/autoscout/research-ui-runtime-patch.mjs';

const NOW = Date.parse('2026-09-13T23:15:00Z');
const fresh = new Date(NOW - 60_000).toISOString();
const old = new Date(NOW - 30 * 60_000).toISOString();
const q = (sportsbookKey, sportsbook, side, line, extra = {}) => ({ sportsbookKey, sportsbook, side, line, ingestedAt: fresh, ...extra });

test('two ordinary books disagreeing is not enough to manufacture a snipe', () => {
  const rows = [q('prizepicks', 'PrizePicks', 'OVER', 25.5), q('underdog', 'Underdog', 'OVER', 24.5)];
  assert.equal(detectStaleLine(rows), null);
  assert.equal(detectSnipe(rows, { now: NOW }), null);
});

test('consensus line snipe requires target plus two independent references', () => {
  const signal = detectSnipe([
    q('underdog', 'Underdog', 'OVER', 24.5),
    q('prizepicks', 'PrizePicks', 'OVER', 25.5),
    q('fanduel', 'FanDuel', 'OVER', 25.5),
  ], { now: NOW });
  assert.equal(signal.kind, 'line-consensus');
  assert.equal(signal.targetBook, 'Underdog');
  assert.equal(signal.line, 24.5);
  assert.equal(signal.referenceLine, 25.5);
  assert.equal(signal.lineGap, 1);
  assert.equal(signal.referenceCount, 2);
  assert.equal(signal.supportCount, 2);
  assert.match(staleLineLabel(signal), /Underdog OVER 24.5 vs market 25.5/);
});

test('consensus UNDER snipe chooses the higher bettor-friendly number', () => {
  const signal = detectSnipe([
    q('underdog', 'Underdog', 'UNDER', 8.5),
    q('prizepicks', 'PrizePicks', 'UNDER', 7.5),
    q('fanduel', 'FanDuel', 'UNDER', 7.5),
  ], { now: NOW });
  assert.equal(signal.kind, 'line-consensus');
  assert.equal(signal.targetBook, 'Underdog');
  assert.equal(signal.line, 8.5);
  assert.equal(signal.referenceLine, 7.5);
});

test('targetBooks restrict the executable venue but not the market references', () => {
  const rows = [
    q('underdog', 'Underdog', 'OVER', 24.5),
    q('prizepicks', 'PrizePicks', 'OVER', 25.5),
    q('fanduel', 'FanDuel', 'OVER', 25.5),
  ];
  assert.equal(findSnipeOpportunities(rows, { now: NOW, targetBooks: ['prizepicks'] }).length, 0);
  const signals = findSnipeOpportunities(rows, { now: NOW, targetBooks: ['underdog'] });
  assert.equal(signals.length, 1);
  assert.equal(signals[0].targetKey, 'underdog');
  assert.equal(signals[0].referenceCount, 2);
});

test('old board observations do not create new snipes', () => {
  const signal = detectSnipe([
    { sportsbookKey: 'underdog', sportsbook: 'Underdog', side: 'OVER', line: 24.5, ingestedAt: old },
    { sportsbookKey: 'prizepicks', sportsbook: 'PrizePicks', side: 'OVER', line: 25.5, ingestedAt: old },
    { sportsbookKey: 'fanduel', sportsbook: 'FanDuel', side: 'OVER', line: 25.5, ingestedAt: old },
  ], { now: NOW });
  assert.equal(signal, null);
});

test('fresh ingestion keeps unchanged provider quotes eligible', () => {
  const signal = detectSnipe([
    q('underdog', 'Underdog', 'OVER', 24.5, { providerUpdatedAt: old }),
    q('prizepicks', 'PrizePicks', 'OVER', 25.5, { providerUpdatedAt: old }),
    q('fanduel', 'FanDuel', 'OVER', 25.5, { providerUpdatedAt: old }),
  ], { now: NOW });
  assert.equal(signal?.kind, 'line-consensus');
});

test('sharp stale-line evidence can qualify with two books', () => {
  const signal = detectSnipe([
    q('pinnacle', 'Pinnacle', 'OVER', 26.5, { price: -132 }),
    q('fanduel', 'FanDuel', 'OVER', 25.5, { price: -108 }),
  ], { now: NOW });
  assert.equal(signal.kind, 'sharp-line');
  assert.equal(signal.source, 'sharp-lag');
  assert.equal(signal.targetBook, 'FanDuel');
  assert.equal(signal.referenceBook, 'Pinnacle');
});

test('same-line price snipe uses a multi-book no-vig consensus', () => {
  const signal = findSnipeOpportunities([
    q('fanduel', 'FanDuel', 'OVER', 25.5, { price: 105 }),
    q('fanduel', 'FanDuel', 'UNDER', 25.5, { price: -125 }),
    q('draftkings', 'DraftKings', 'OVER', 25.5, { price: -130 }),
    q('draftkings', 'DraftKings', 'UNDER', 25.5, { price: 110 }),
    q('betmgm', 'BetMGM', 'OVER', 25.5, { price: -125 }),
    q('betmgm', 'BetMGM', 'UNDER', 25.5, { price: 105 }),
  ], { now: NOW, targetBooks: ['fanduel'] })[0];
  assert.equal(signal.kind, 'price-consensus');
  assert.equal(signal.targetBook, 'FanDuel');
  assert.equal(signal.referenceCount, 2);
  assert.ok(signal.edgePct >= 3);
});

test('runtime UI patch still creates the Snipes view and parses', () => {
  const source = readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');
  const patched = patchResearchUi(source);
  assert.match(patched, /detectStaleLine, detectSnipe, staleLineLabel/);
  assert.match(patched, /snipes:'Automatic Snipes'/);
  assert.match(patched, /data-view="snipes"/);
  assert.match(patched, /🎯 Snipe/);
  assert.match(patched, /announceSnipes\(\);render\(\);syncPropRoute\(\)/);
  assert.doesNotThrow(() => new Function(patched));
});
