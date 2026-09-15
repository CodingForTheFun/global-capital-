// Retention is the only thing in this codebase that deletes data the product
// cannot re-fetch. These tests exist to pin down the two properties that make
// it safe to ship: it does nothing unless someone asked for it, and it cannot
// be talked into a shorter window than the floor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { retentionConfig, pruneLineSnapshots, persistenceHealth } from '../lib/autoscout/supabase-persistence.mjs';

test('retention is off when no window is configured', () => {
  const config = retentionConfig({});
  assert.equal(config.enabled, false);
  assert.equal(config.days, null);
});

test('an unparseable window disables retention instead of guessing one', () => {
  const config = retentionConfig({ AUTOSCOUT_SNAPSHOT_RETENTION_DAYS: 'soon' });
  assert.equal(config.enabled, false);
  assert.equal(config.reason, 'RETENTION_DAYS_INVALID');
});

test('a window shorter than the floor is raised to the floor', () => {
  assert.equal(retentionConfig({ AUTOSCOUT_SNAPSHOT_RETENTION_DAYS: '1' }).days, 14);
  assert.equal(retentionConfig({ AUTOSCOUT_SNAPSHOT_RETENTION_DAYS: '0' }).days, 14);
  assert.equal(retentionConfig({ AUTOSCOUT_SNAPSHOT_RETENTION_DAYS: '-90' }).days, 14);
});

test('a window longer than the floor is kept as asked', () => {
  assert.equal(retentionConfig({ AUTOSCOUT_SNAPSHOT_RETENTION_DAYS: '30' }).days, 30);
  assert.equal(retentionConfig({ AUTOSCOUT_SNAPSHOT_RETENTION_DAYS: '365' }).days, 365);
});

test('the batch size is bounded so one call cannot become an unbounded delete', () => {
  assert.equal(retentionConfig({ AUTOSCOUT_SNAPSHOT_RETENTION_DAYS: '30', AUTOSCOUT_SNAPSHOT_RETENTION_BATCH: '9999999' }).limit, 50_000);
  assert.equal(retentionConfig({ AUTOSCOUT_SNAPSHOT_RETENTION_DAYS: '30', AUTOSCOUT_SNAPSHOT_RETENTION_BATCH: '0' }).limit, 20_000);
  assert.equal(retentionConfig({ AUTOSCOUT_SNAPSHOT_RETENTION_DAYS: '30' }).limit, 20_000);
});

test('pruning does not run when no window is configured', async () => {
  const result = await pruneLineSnapshots({ env: {} });
  assert.equal(result.ran, false);
  assert.equal(result.reason, 'RETENTION_DISABLED');
});

test('health reports the retention window so a wrong one is visible', () => {
  const retention = persistenceHealth().retention;
  assert.ok(retention, 'persistence health should carry retention state');
  assert.equal(typeof retention.enabled, 'boolean');
});
