import test from 'node:test';
import assert from 'node:assert/strict';
import { __publicPersistenceTuning, claimPublicCycle, persistPublicSnapshot, persistGameLogs } from '../lib/ingestion/public-persistence.mjs';

const ok = (body = {}) => ({ ok: true, status: 200, json: async () => body });

function withEnv(name, value, restore) {
  restore[name] = process.env[name];
  process.env[name] = value;
}
function restoreEnv(restore) {
  for (const [name, value] of Object.entries(restore)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test('public persistence uses bounded production write tuning', () => {
  const restore = {};
  try {
    withEnv('AUTOSCOUT_PUBLIC_SNAPSHOT_BATCH_SIZE', '25', restore);
    withEnv('AUTOSCOUT_PUBLIC_HISTORY_BATCH_SIZE', '100', restore);
    withEnv('AUTOSCOUT_PUBLIC_STORE_TIMEOUT_MS', '35000', restore);
    withEnv('AUTOSCOUT_PUBLIC_FALLBACK_DELAY_MS', '750', restore);
    assert.deepEqual(__publicPersistenceTuning(), {
      snapshotBatchSize: 50,
      historyBatchSize: 100,
      storeTimeoutMs: 35000,
      fallbackDelayMs: 750,
      directPrimary: false,
    });
  } finally {
    restoreEnv(restore);
  }
});

test('lease claims stay on the canonical pooled RPC even when direct-primary is enabled', async () => {
  const restore = {};
  const originalFetch = globalThis.fetch;
  const urls = [];
  try {
    withEnv('AUTOSCOUT_SUPABASE_URL', 'https://example.supabase.co', restore);
    withEnv('AUTOSCOUT_SUPABASE_PUBLISHABLE_KEY', 'test-key', restore);
    withEnv('AUTOSCOUT_SUPABASE_INGEST_TOKEN', 'test-token', restore);
    withEnv('AUTOSCOUT_DIRECT_DB_PRIMARY', 'true', restore);
    globalThis.fetch = async (url) => {
      urls.push(String(url));
      return ok({ claimed: false, owner: null });
    };
    const result = await claimPublicCycle(300);
    assert.equal(result.claimed, false);
    assert.equal(urls.length, 1);
    assert.ok(urls[0].endsWith('/rest/v1/rpc/autoscout_public_store'));
    assert.ok(!urls[0].includes('/functions/v1/autoscout-db-direct'));
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(restore);
  }
});

test('prop snapshots are split into bounded chunks before finalization', async () => {
  const restore = {};
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    withEnv('AUTOSCOUT_SUPABASE_URL', 'https://example.supabase.co', restore);
    withEnv('AUTOSCOUT_SUPABASE_PUBLISHABLE_KEY', 'test-key', restore);
    withEnv('AUTOSCOUT_SUPABASE_INGEST_TOKEN', 'test-token', restore);
    withEnv('AUTOSCOUT_PUBLIC_SNAPSHOT_BATCH_SIZE', '50', restore);
    withEnv('AUTOSCOUT_PUBLIC_FALLBACK_DELAY_MS', '0', restore);
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(init.body);
      const rows = request.p_payload?.rows || [];
      calls.push({ rows: rows.length, finalize: request.p_payload?.finalize === true });
      return ok({ written: rows.length });
    };
    const rows = Array.from({ length: 103 }, (_, index) => ({ id: `row-${index}` }));
    const result = await persistPublicSnapshot('prizepicks', rows, '2026-09-15T17:30:00.000Z');
    assert.equal(result.written, 103);
    assert.deepEqual(calls, [
      { rows: 50, finalize: false },
      { rows: 50, finalize: false },
      { rows: 3, finalize: false },
      { rows: 0, finalize: true },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(restore);
  }
});

test('direct-primary write failure never spills into PostgREST', async () => {
  const restore = {};
  const originalFetch = globalThis.fetch;
  const urls = [];
  try {
    withEnv('AUTOSCOUT_SUPABASE_URL', 'https://example.supabase.co', restore);
    withEnv('AUTOSCOUT_SUPABASE_PUBLISHABLE_KEY', 'test-key', restore);
    withEnv('AUTOSCOUT_SUPABASE_INGEST_TOKEN', 'test-token', restore);
    withEnv('AUTOSCOUT_DIRECT_DB_PRIMARY', 'true', restore);
    withEnv('AUTOSCOUT_PUBLIC_SNAPSHOT_BATCH_SIZE', '250', restore);
    globalThis.fetch = async (url) => {
      urls.push(String(url));
      return { ok: false, status: 500, json: async () => ({ message: 'database operation failed' }) };
    };
    await assert.rejects(
      () => persistPublicSnapshot('prizepicks', [{ id: 'row-1' }], '2026-09-15T17:30:00.000Z'),
      (error) => error?.code === 'PUBLIC_STORE_FAILED_500',
    );
    assert.equal(urls.length, 1, 'direct-primary mode gets one write attempt per operation');
    assert.ok(urls[0].endsWith('/functions/v1/autoscout-db-direct'));
    assert.ok(!urls[0].includes('/rest/v1/rpc/'));
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(restore);
  }
});

test('history persistence uses smaller batches', async () => {
  const restore = {};
  const originalFetch = globalThis.fetch;
  const sizes = [];
  try {
    withEnv('AUTOSCOUT_SUPABASE_URL', 'https://example.supabase.co', restore);
    withEnv('AUTOSCOUT_SUPABASE_PUBLISHABLE_KEY', 'test-key', restore);
    withEnv('AUTOSCOUT_SUPABASE_INGEST_TOKEN', 'test-token', restore);
    withEnv('AUTOSCOUT_PUBLIC_HISTORY_BATCH_SIZE', '100', restore);
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(init.body);
      const rows = request.p_payload?.rows || [];
      sizes.push(rows.length);
      return ok({ written: rows.length });
    };
    const rows = Array.from({ length: 205 }, (_, index) => ({ id: `game-${index}` }));
    const result = await persistGameLogs(rows);
    assert.equal(result.written, 205);
    assert.deepEqual(sizes, [100, 100, 5]);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(restore);
  }
});
