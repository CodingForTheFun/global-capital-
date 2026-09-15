// The available-lines block spent a lot of vertical space saying very little
// when a prop had one book: a picker with nothing to pick, a "best line" that
// was that one book's line, an O/U pair repeating the chip directly beneath it,
// and a chip locked to half the rail width beside an equal-sized void.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../lib/autoscout/propline-market-runtime-patch.mjs', import.meta.url), 'utf8');

test('one book renders no picker, no duplicate values and no tap-to-choose hint', () => {
  assert.match(source, /var solo=choices\.length<2;/);
  assert.match(source, /\+\(solo\?''\s*\n\s*:'<div class="asPropBookControl">'/,
    'the whole control block must be skipped, not merely hidden');
});

test('two or more books keep the full picker', () => {
  // The control block is still present in the non-solo branch.
  assert.match(source, /asPropBookSelect" data-prop-book=/);
  assert.match(source, /live book'\+\(choices\.length===1\?'':'s'\)/);
});

test('a lone chip fills the row instead of sitting beside an empty half', () => {
  assert.match(source, /#as5 \.asOddsSolo \.asOddsChip\{flex:1 1 auto!important;min-height:0!important\}/);
});

test('a missing price renders nothing rather than a box containing a dash', () => {
  assert.match(source, /\(num\(over\.price\)!=null\?'<i>'\+esc\(money\(over\.price\)\)\+'<\/i>':''\)/);
  assert.match(source, /\(num\(under\.price\)!=null\?'<i>'\+esc\(money\(under\.price\)\)\+'<\/i>':''\)/);
});

test('the line itself is never hidden, only the empty price', () => {
  // Dropping a line would remove real information; only the absent price goes.
  assert.match(source, /<strong>O '\+esc\(dec\(over\.line\)\)\+'<\/strong>/);
  assert.match(source, /<strong>U '\+esc\(dec\(under\.line\)\)\+'<\/strong>/);
});

test('the solo marker is on the strip so it cannot leak into multi-book rows', () => {
  assert.match(source, /asOddsStrip asPropBookStrip'\+\(solo\?' asOddsSolo':''\)\+'"/);
});
