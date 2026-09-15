// On 2026-09-15 a null ingestion source produced 34 HTTP 500s from
// autoscout_public_store in a twenty-minute window. Not one appeared in a log,
// a health field, or an alert - every caller wraps these writes in `catch {}`
// or `.catch(() => {})`, which is correct control flow (a failed status write
// must not stop an ingestion cycle) and total silence.
//
// The swallowing stays. These tests pin that the failures are counted anyway.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { publicStoreHealth, __resetPublicStoreHealth, recordPublicStatus } from '../lib/ingestion/public-persistence.mjs';

const configure = () => {
  process.env.AUTOSCOUT_SUPABASE_URL = 'http://127.0.0.1:1';
  process.env.AUTOSCOUT_SUPABASE_PUBLISHABLE_KEY = 'test-key';
  process.env.AUTOSCOUT_SUPABASE_INGEST_TOKEN = 'test-token';
};

test('health starts clean', () => {
  __resetPublicStoreHealth();
  const health = publicStoreHealth();
  assert.equal(health.totalFailures, 0);
  assert.equal(health.successes, 0);
  assert.deepEqual(health.failures, []);
});

test('a swallowed status-write failure is still counted', async () => {
  __resetPublicStoreHealth();
  configure();
  // Exactly how every caller does it: fail, swallow, carry on.
  try { await recordPublicStatus('prizepicks', { status: 'available' }); } catch {}
  const health = publicStoreHealth();
  assert.equal(health.totalFailures, 1, 'the failure must be visible even though the caller swallowed it');
  assert.equal(health.failures[0].call, 'autoscout_public_store:status');
  assert.ok(health.failures[0].lastAt, 'a failure must carry when it happened');
});

test('repeated failures accumulate against the same call rather than flooding', async () => {
  __resetPublicStoreHealth();
  configure();
  for (let i = 0; i < 5; i += 1) {
    try { await recordPublicStatus('underdog', { status: 'available' }); } catch {}
  }
  const health = publicStoreHealth();
  assert.equal(health.totalFailures, 5);
  assert.equal(health.failureCalls, 1, 'one call site, one row');
  assert.equal(health.failures[0].count, 5);
});

test('the failure carries a machine-readable code, not a message', async () => {
  __resetPublicStoreHealth();
  configure();
  try { await recordPublicStatus('prizepicks', { status: 'available' }); } catch {}
  const [row] = publicStoreHealth().failures;
  assert.match(row.lastCode, /^[A-Z_0-9]+$/, `expected a code, got "${row.lastCode}"`);
});

test('the failure list is bounded so a long outage cannot grow health without limit', async () => {
  __resetPublicStoreHealth();
  configure();
  for (let i = 0; i < 25; i += 1) {
    try { await recordPublicStatus(`draftkings:NFL`, { status: 'available', i }); } catch {}
  }
  assert.ok(publicStoreHealth().failures.length <= 10, 'health must stay readable during an outage');
});

test('the callers still swallow - this must not change ingestion control flow', () => {
  const worker = readFileSync(new URL('../lib/ingestion/public-worker.mjs', import.meta.url), 'utf8');
  assert.match(worker, /async function status\(source, state\) \{ try \{ await recordStatus\(source, state\); \} catch \{\} \}/,
    'a failed status write must still never stop an ingestion cycle');
});

test('public store health is exposed on /api/health', () => {
  const core = readFileSync(new URL('../apex-v2/server-core.mjs', import.meta.url), 'utf8');
  assert.match(core, /publicStore: publicStoreHealth\(\)/, 'counted failures are useless if nothing reports them');
});
