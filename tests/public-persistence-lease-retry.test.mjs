import test from 'node:test';
import assert from 'node:assert/strict';
import { __leaseRetryPolicy } from '../lib/autoscout/persistence-scheduler.mjs';

test('retry window clears the observed retry-owned lease drift without polling', () => {
  const policy = __leaseRetryPolicy('scheduled', false);

  // #288 observed the database-authoritative next_at landing roughly 40-60s
  // beyond the process timer after a retry-owned claim. The one permitted
  // second chance must sit beyond that window instead of probing every few
  // seconds toward it.
  assert.equal(policy.delayMs, 75_000);
  assert.equal(policy.delayMs > 60_000, true);
  assert.equal(policy.shouldSchedule, true);
});

test('lease retries are bounded and never recurse', () => {
  assert.equal(__leaseRetryPolicy('scheduled-lease-retry', false).shouldSchedule, false);
  assert.equal(__leaseRetryPolicy('scheduled', true).shouldSchedule, false);
});

test('normal scheduled misses retain exactly one eligible second chance', () => {
  const first = __leaseRetryPolicy('scheduled', false);
  const whilePending = __leaseRetryPolicy('scheduled', true);
  const tagged = __leaseRetryPolicy('scheduled-lease-retry', false);

  assert.deepEqual(first, { delayMs: 75_000, shouldSchedule: true });
  assert.equal(whilePending.shouldSchedule, false);
  assert.equal(tagged.shouldSchedule, false);
});
