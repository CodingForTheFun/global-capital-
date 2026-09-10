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
    'FAVORITES',
    'Research Card',
  ]) {
    assert.ok(source.includes(needle), `missing v4 UI capability: ${needle}`);
  }
});

test('Auto Scout v4 never substitutes made-up research statistics', () => {
  assert.ok(source.includes('Missing values are never fabricated'));
  assert.ok(!/Math\.random\s*\(/.test(source));
});
