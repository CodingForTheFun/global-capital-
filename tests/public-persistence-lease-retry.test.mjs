import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (relative) => readFile(new URL(relative, import.meta.url), 'utf8');

test('clean unclaimed scheduler leases get one bounded retry after the current pass', async () => {
  const source = await read('../lib/autoscout/persistence-scheduler.mjs');

  assert.match(source, /const LEASE_RETRY_DELAY_MS = 15_000;/);
  assert.match(source, /if \(leaseRetryTimer \|\| String\(reason\)\.includes\('lease-retry'\)\) return;/);
  assert.match(source, /retryLeaseAfterRun = !String\(reason\)\.includes\('lease-retry'\);/);
  assert.match(source, /void persistBoards\(`\$\{reason\}-lease-retry`\);/);
  assert.match(source, /syncRunning = false;\s+if \(retryLeaseAfterRun\) scheduleLeaseRetry\(reason\);/);
});

test('a successful intervening claim cancels a queued lease retry', async () => {
  const source = await read('../lib/autoscout/persistence-scheduler.mjs');

  assert.match(source, /else if \(leaseRetryTimer\) \{\s+\/\/ Another scheduled\/bootstrap pass may have acquired the lease before/);
  assert.match(source, /clearTimeout\(leaseRetryTimer\);\s+leaseRetryTimer = null;/);
});
