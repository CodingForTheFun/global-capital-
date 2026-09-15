import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patchRecentFiveUi } from '../lib/autoscout/recent-five-runtime-patch.mjs';
import { patchProplineMarketUi } from '../lib/autoscout/propline-market-runtime-patch.mjs';

const source = readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');

test('PropLine market rail adds best-line, freshness, probability and safe click-out presentation', () => {
  const withSpecials = patchRecentFiveUi(source);
  const patched = patchProplineMarketUi(withSpecials);

  assert.match(patched, /BEST LINE \+ PRICE/);
  assert.match(patched, /implied/);
  assert.match(patched, /Market change/);
  assert.match(patched, /data-book-link/);
  assert.match(patched, /safeBookLink/);
  assert.match(patched, /book gap/);
  assert.match(patched, /asOddsRail/);

  // PrizePicks Goblin/Demon stays isolated in the verified special strip; the
  // regular Best Line rail never promotes an alternate into the comparison.
  assert.match(patched, /specialRows:specials\.get\(g\.key\)\|\|\[\]/);
  assert.match(patched, /prizePicksSpecialStrip\(g\)/);
  assert.match(patched, /if\(r\.isAlternate\)/);

  assert.doesNotThrow(() => new Function(patched));
});
