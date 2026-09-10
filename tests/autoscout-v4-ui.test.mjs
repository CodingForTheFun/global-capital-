import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../apex-v2/scout-ui-v4.js', import.meta.url), 'utf8');

test('Auto Scout v4 client bundle parses as JavaScript', () => {
  assert.doesNotThrow(() => new Function(source));
});

test('Auto Scout v4 exposes dense prop comparison UI and player artwork', () => {
  for (const needle of [
    '/api/apex/player-artwork',
    'Sportsbook line shop',
    'Consensus',
    'Best Over',
    'Best Under',
    'asBookRail',
    'AUTO SCOUT RULES',
    'ALT LINES',
    'MAIN ONLY',
    'LINE SHOP',
    'Saved',
    'Research Card',
  ]) {
    assert.ok(source.includes(needle), `missing v4 UI capability: ${needle}`);
  }
});

test('Auto Scout v4 never substitutes made-up research statistics', () => {
  assert.ok(source.includes('Missing values are never fabricated'));
  assert.ok(!/Math\.random\s*\(/.test(source));
});

test('research renders only provider-supplied games, and says why when it cannot', () => {
  // The panel must read its games from the response, never seed its own.
  assert.ok(source.includes('research.games=Array.isArray(d.gameLog)?d.gameLog:[]'),
    'the game log must come from the response');
  assert.ok(source.includes("d.available!==true"),
    'an unavailable response must be honoured rather than rendered as data');
  assert.ok(source.includes('research.reason'),
    'the server-supplied reason must be shown to the user');
});

test('a hit rate is null rather than zero when there is nothing to measure', () => {
  // resHit mirrors lib/research/service.mjs: no line, or no decided games,
  // yields null. A zero would read as "never hit", which is a different claim.
  assert.ok(source.includes('if(l===null)return{hitRate:null'), 'no line means no hit rate');
  assert.ok(source.includes('dec?Math.round(hits/dec*100):null'), 'no decided games means null');
  assert.ok(source.includes("if(v===l){push++;continue;}"), 'a push must not count as a loss');
});
