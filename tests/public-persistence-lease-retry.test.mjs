import test from 'node:test';
import assert from 'node:assert/strict';
import { __leaseRetryPolicy } from '../lib/autoscout/persistence-scheduler.mjs';

test('retry waits just past the database-authoritative next_at', () => {
  const policy = __leaseRetryPolicy('scheduled', false, {
    dbNow: '2026-09-17T17:16:21.000Z',
    nextAt: '2026-09-17T17:18:35.000Z',
  });

  assert.equal(policy.delayMs, 139_000);
  assert.equal(policy.shouldSchedule, true);
});

test('database-timed retry stays bounded', () => {
  const near = __leaseRetryPolicy('scheduled', false, {
    dbNow: '2026-09-17T17:18:34.000Z',
    nextAt: '2026-09-17T17:18:35.000Z',
  });
  const far = __leaseRetryPolicy('scheduled', false, {
    dbNow: '2026-09-17T17:10:00.000Z',
    nextAt: '2026-09-17T17:30:00.000Z',
  });

  assert.equal(near.delayMs, 6_000);
  assert.equal(far.delayMs, 305_000);
});

test('missing timing falls back to the previous safe bounded delay', () => {
  const policy = __leaseRetryPolicy('scheduled', false, null);
  assert.deepEqual(policy, { delayMs: 75_000, shouldSchedule: true });
});

test('lease retries are bounded and never recurse', () => {
  assert.equal(__leaseRetryPolicy('scheduled-lease-retry', false).shouldSchedule, false);
  assert.equal(__leaseRetryPolicy('scheduled', true).shouldSchedule, false);
});
