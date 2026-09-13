import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectSnipe, detectStaleLine, staleLineLabel } from '../lib/markets/line-lag.mjs';
import { patchResearchUi } from '../lib/autoscout/research-ui-runtime-patch.mjs';

const NOW = Date.parse('2026-09-13T22:30:00Z');
const fresh = new Date(NOW - 60_000).toISOString();

test('automatic snipes find a friendlier DFS main line without American odds', () => {
  const rows = [
    { sportsbookKey: 'prizepicks', sportsbook: 'PrizePicks', side: 'OVER', line: 25.5, providerUpdatedAt: fresh },
    { sportsbookKey: 'underdog', sportsbook: 'Underdog', side: 'OVER', line: 24.5, providerUpdatedAt: fresh },
  ];

  // The strict stale-line detector still requires a sharp sportsbook price.
  assert.equal(detectStaleLine(rows), null);

  const signal = detectSnipe(rows, { now: NOW });
  assert.equal(signal.kind, 'crossbook');
  assert.equal(signal.side, 'OVER');
  assert.equal(signal.retailBook, 'Underdog');
  assert.equal(signal.line, 24.5);
  assert.equal(signal.referenceBook, 'PrizePicks');
  assert.equal(signal.referenceLine, 25.5);
  assert.equal(signal.lineMove, 1);
  assert.match(staleLineLabel(signal), /Underdog OVER 24.5 vs PrizePicks 25.5/);
});

test('automatic snipes choose the bettor-friendlier UNDER line', () => {
  const signal = detectSnipe([
    { sportsbookKey: 'prizepicks', sportsbook: 'PrizePicks', side: 'UNDER', line: 7.5, providerUpdatedAt: fresh },
    { sportsbookKey: 'underdog', sportsbook: 'Underdog', side: 'UNDER', line: 8.5, providerUpdatedAt: fresh },
  ], { now: NOW });

  assert.equal(signal.kind, 'crossbook');
  assert.equal(signal.retailBook, 'Underdog');
  assert.equal(signal.line, 8.5);
  assert.equal(signal.referenceLine, 7.5);
});

test('old explicitly timestamped quotes do not create new automatic snipes', () => {
  const old = new Date(NOW - 30 * 60_000).toISOString();
  const signal = detectSnipe([
    { sportsbookKey: 'prizepicks', sportsbook: 'PrizePicks', side: 'OVER', line: 25.5, providerUpdatedAt: old },
    { sportsbookKey: 'underdog', sportsbook: 'Underdog', side: 'OVER', line: 24.5, providerUpdatedAt: fresh },
  ], { now: NOW });
  assert.equal(signal, null);
});

test('sharp stale-line evidence remains the preferred automatic signal', () => {
  const signal = detectSnipe([
    { sportsbookKey: 'pinnacle', sportsbook: 'Pinnacle', side: 'OVER', line: 26.5, price: -132, providerUpdatedAt: fresh },
    { sportsbookKey: 'fanduel', sportsbook: 'FanDuel', side: 'OVER', line: 25.5, price: -108, providerUpdatedAt: fresh },
    { sportsbookKey: 'underdog', sportsbook: 'Underdog', side: 'OVER', line: 24.5, providerUpdatedAt: fresh },
  ], { now: NOW });

  assert.equal(signal.kind, 'line');
  assert.equal(signal.source, 'sharp-lag');
  assert.equal(signal.retailBook, 'FanDuel');
  assert.equal(signal.sharpBook, 'Pinnacle');
});

test('runtime UI patch creates an automatic Snipes view and still parses', () => {
  const source = readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');
  const patched = patchResearchUi(source);

  assert.match(patched, /detectStaleLine, detectSnipe, staleLineLabel/);
  assert.match(patched, /snipes:'Automatic Snipes'/);
  assert.match(patched, /data-view="snipes"/);
  assert.match(patched, /🎯 Snipe/);
  assert.match(patched, /New snipe detected/);
  assert.match(patched, /announceSnipes\(\);render\(\);syncPropRoute\(\)/);

  // Parse the generated browser bundle without executing it.
  assert.doesNotThrow(() => new Function(patched));
});
