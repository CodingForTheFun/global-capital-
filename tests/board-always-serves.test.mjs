// The customer board reads persisted props on a 900ms budget with no direct
// fallback, so a slow database read returns nothing. On a fresh container the
// in-memory feed cache is cold too, and the board renders empty - which is what
// visitors saw today. Holding the last good read per sport turns a database
// blip into lost freshness instead of a lost product.
//
// The two rules that make that safe, rather than just convenient, are pinned
// here: it expires, and it is labelled.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../apex-v2/provider.mjs', import.meta.url), 'utf8');

test('a failed persisted read falls back to the last good copy', () => {
  assert.match(source, /catch \{\s*const recalled = recallPersisted\(sport\);/,
    'an empty board on a timed-out read is the bug being fixed');
  assert.match(source, /persisted = recalled\.rows;/);
});

test('a successful read refreshes the held copy', () => {
  assert.match(source, /persisted = await readPublicProps\(sport\);\s*rememberPersisted\(sport, persisted\);/);
});

test('the held copy expires, so no stale price is served indefinitely', () => {
  assert.match(source, /PERSISTED_FALLBACK_MAX_AGE_MS = 15 \* 60_000/,
    'a stale line someone acts on is worse than no line');
  assert.match(source, /if \(now - hit\.at > PERSISTED_FALLBACK_MAX_AGE_MS\) \{ lastGoodPersisted\.delete\(sport\); return null; \}/);
});

test('serving the held copy marks the board stale rather than passing it off as live', () => {
  assert.match(source, /stale: true, staleSince: servedFromLastGood, staleReason: 'PERSISTED_READ_UNAVAILABLE'/);
});

test('an empty read is not remembered as a good copy', () => {
  assert.match(source, /if \(Array\.isArray\(rows\) && rows\.length\) lastGoodPersisted\.set/,
    'remembering an empty result would cache the very failure being guarded against');
});

test('the fallback state is inspectable', async () => {
  const { __persistedFallbackState } = await import('../apex-v2/provider.mjs');
  const state = __persistedFallbackState();
  assert.ok(Array.isArray(state.sports));
  assert.equal(state.maxAgeMs, 900000);
});
