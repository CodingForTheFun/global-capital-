// Customer prices must fail closed on freshness. Last-good persisted rows are
// still retained in memory for diagnostics/recovery, but a database read failure
// can no longer substitute that older copy into the live customer board.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../apex-v2/provider.mjs', import.meta.url), 'utf8');

test('a failed persisted read does not promote the held last-good copy', () => {
  assert.match(source, /persistedReadFailed = true;/);
  assert.doesNotMatch(source, /persisted = recalled\.rows;/,
    'recovery data may be retained internally but never substituted into a customer response');
});

test('a successful read still refreshes the held diagnostic copy', () => {
  assert.match(source, /persisted = await readPublicProps\(sport\);\s*rememberPersisted\(sport, persisted\);/);
});

test('the held diagnostic copy stays bounded even though it is not customer-serving', () => {
  assert.match(source, /PERSISTED_FALLBACK_MAX_AGE_MS = 15 \* 60_000/);
  assert.match(source, /if \(now - hit\.at > PERSISTED_FALLBACK_MAX_AGE_MS\) \{ lastGoodPersisted\.delete\(sport\); return null; \}/);
});

test('read failure is observable without labelling an old line as live', () => {
  assert.match(source, /persistedReadFailed: true/);
  assert.doesNotMatch(source, /stale: true, staleSince: servedFromLastGood, staleReason: 'PERSISTED_READ_UNAVAILABLE'/);
});

test('known-stale provider boards are rejected before customer merge', () => {
  assert.match(source, /cached\?\.meta\?\.stale === true/);
  assert.match(source, /base\?\.meta\?\.stale===true/);
  assert.match(source, /filterCustomerBoardFreshness/);
});

test('an empty read is not remembered as a good copy', () => {
  assert.match(source, /if \(Array\.isArray\(rows\) && rows\.length\) lastGoodPersisted\.set/);
});

test('the retained fallback state remains inspectable for operations', async () => {
  const { __persistedFallbackState } = await import('../apex-v2/provider.mjs');
  const state = __persistedFallbackState();
  assert.ok(Array.isArray(state.sports));
  assert.equal(state.maxAgeMs, 900000);
});
