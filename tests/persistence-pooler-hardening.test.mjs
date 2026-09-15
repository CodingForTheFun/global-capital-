import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { releasePublicCycle } from '../lib/ingestion/public-persistence.mjs';

function restoreEnv(restore) {
  for (const [name, value] of Object.entries(restore)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test('scheduler lease release has a pooled fallback after direct DB failure', async () => {
  const restore = {};
  for (const [name, value] of Object.entries({
    AUTOSCOUT_SUPABASE_URL: 'https://example.supabase.co',
    AUTOSCOUT_SUPABASE_PUBLISHABLE_KEY: 'test-key',
    AUTOSCOUT_SUPABASE_INGEST_TOKEN: 'test-token',
    AUTOSCOUT_DIRECT_DB_PRIMARY: 'true',
  })) {
    restore[name] = process.env[name];
    process.env[name] = value;
  }
  const originalFetch = globalThis.fetch;
  const urls = [];
  try {
    globalThis.fetch = async (url) => {
      urls.push(String(url));
      if (urls.length === 1) return { ok: false, status: 500, json: async () => ({ message: 'connection timeout' }) };
      return { ok: true, status: 200, json: async () => ({ released: true }) };
    };
    const result = await releasePublicCycle('owner-1');
    assert.equal(result.released, true);
    assert.equal(urls.length, 2);
    assert.ok(urls[0].endsWith('/functions/v1/autoscout-db-direct'));
    assert.ok(urls[1].endsWith('/rest/v1/rpc/autoscout_public_store'));
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(restore);
  }
});

test('edge persistence does not assume one Supavisor cluster index', async () => {
  const source = await readFile(new URL('../supabase/functions/autoscout-db-direct/index.ts', import.meta.url), 'utf8');
  assert.match(source, /SUPABASE_DB_POOLER_URL/);
  assert.match(source, /SUPABASE_DB_POOLER_HOST/);
  assert.match(source, /Array\.from\(\{ length: 8 \}/);
  assert.match(source, /connect_timeout: 3/);
  assert.match(source, /await candidate`select 1 as ok`/);
  assert.doesNotMatch(source, /SUPABASE_DB_POOLER_HOST"\) \|\| "aws-0-/);
});
