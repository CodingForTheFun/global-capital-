import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { persistPublicSnapshot, releasePublicCycle } from '../lib/ingestion/public-persistence.mjs';

const read = (relative) => readFile(new URL(relative, import.meta.url), 'utf8');

function restoreEnv(restore) {
  for (const [name, value] of Object.entries(restore)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test('direct persistence fails closed until an explicit Supavisor pooler is configured', async () => {
  const source = await read('../supabase/functions/autoscout-db-direct/index.ts');
  assert.match(source, /SUPABASE_DB_POOLER_URL/);
  assert.match(source, /SUPABASE_DB_POOLER_HOST/);
  assert.match(source, /database_pooler_not_configured/);
  assert.match(source, /connect_timeout: 3/);
  assert.match(source, /await candidate`select 1 as ok`/);
  assert.doesNotMatch(source, /aws-[0-9]-us-east-1\.pooler\.supabase\.com/);
});

test('PostgREST write failures do not jump to an unverified direct database path by default', async () => {
  const restore = {};
  const originalFetch = globalThis.fetch;
  const urls = [];
  try {
    for (const [name, value] of Object.entries({
      AUTOSCOUT_SUPABASE_URL: 'https://example.supabase.co',
      AUTOSCOUT_SUPABASE_PUBLISHABLE_KEY: 'test-key',
      AUTOSCOUT_SUPABASE_INGEST_TOKEN: 'test-token',
      AUTOSCOUT_DIRECT_DB_PRIMARY: 'false',
      AUTOSCOUT_DIRECT_DB_FALLBACK: 'false',
    })) {
      restore[name] = process.env[name];
      process.env[name] = value;
    }
    globalThis.fetch = async (url) => {
      urls.push(String(url));
      return { ok: false, status: 500, json: async () => ({ message: 'temporary database pressure' }) };
    };
    await assert.rejects(() => persistPublicSnapshot('prizepicks', [{ id: 'row-1' }]), /PUBLIC_STORE_FAILED/);
    assert.equal(urls.length, 1);
    assert.ok(urls[0].includes('/rest/v1/rpc/autoscout_public_store'));
    assert.ok(!urls[0].includes('/functions/v1/autoscout-db-direct'));
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(restore);
  }
});

test('scheduler lease release always uses the pooled canonical RPC', async () => {
  const restore = {};
  const originalFetch = globalThis.fetch;
  const urls = [];
  try {
    for (const [name, value] of Object.entries({
      AUTOSCOUT_SUPABASE_URL: 'https://example.supabase.co',
      AUTOSCOUT_SUPABASE_PUBLISHABLE_KEY: 'test-key',
      AUTOSCOUT_SUPABASE_INGEST_TOKEN: 'test-token',
      AUTOSCOUT_DIRECT_DB_PRIMARY: 'true',
    })) {
      restore[name] = process.env[name];
      process.env[name] = value;
    }
    globalThis.fetch = async (url) => {
      urls.push(String(url));
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
    await releasePublicCycle('owner-1');
    assert.equal(urls.length, 1);
    assert.ok(urls[0].includes('/rest/v1/rpc/autoscout_public_store'));
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(restore);
  }
});

test('snapshot acceptance repair preserves observed time while allowing queued writes', async () => {
  const sql = await read('../supabase/migrations/20260915_0023_widen_public_snapshot_acceptance_window.sql');
  assert.match(sql, /v_observed<now\(\)-interval '5 minutes'/);
  assert.match(sql, /v_observed<now\(\)-interval '15 minutes'/);
  assert.doesNotMatch(sql, /update\s+public\.active_props/i);
});

test('public source allowlist stays bounded to known books and sports', async () => {
  const sql = await read('../supabase/migrations/20260915_0024_unify_public_sportsbook_source_allowlist.sql');
  for (const book of ['draftkings','fanduel','pinnacle','betrivers','bvda','betmgm']) assert.match(sql, new RegExp(`'${book}'`));
  for (const sport of ['NFL','NBA','WNBA','MLB','NHL','NCAAF','NCAAB','TENNIS','SOCCER']) assert.match(sql, new RegExp(`'${sport}'`));
  assert.match(sql, /split_part\(v_source,':',1\)/);
  assert.match(sql, /split_part\(v_source,':',2\)/);
});
