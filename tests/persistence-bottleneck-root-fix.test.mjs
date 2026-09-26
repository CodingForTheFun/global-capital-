import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalPersistedLineId } from '../lib/autoscout/supabase-persistence.mjs';
import { stableId } from '../lib/autoscout/models.mjs';

const read = (relative) => readFile(new URL(relative, import.meta.url), 'utf8');

test('canonical persistence identity ignores ephemeral row id and price revisions', () => {
  const row = { id: 'ephemeral-old-id', propId: 'prop-1', bookmakerKey: 'underdog', side: 'OVER', line: 14.5, price: -106 };
  const revised = { ...row, id: 'ephemeral-new-id', price: -139 };
  const expected = stableId(['line', 'prop-1', 'underdog', 'OVER', 14.5]);
  assert.equal(canonicalPersistedLineId(row), expected);
  assert.equal(canonicalPersistedLineId(revised), expected);
});

test('canonical persistence uses larger bounded batches', async () => {
  const source = await read('../lib/autoscout/supabase-persistence.mjs');
  assert.match(source, /RPC_BOARD_BATCH_SIZE = 500/);
  assert.doesNotMatch(source, /RPC_BOARD_BATCH_SIZE = (?:1000|[2-9][0-9]{3,})/);
});

test('customer persisted reads keep the existing public-store wire contract', async () => {
  const source = await read('../lib/ingestion/public-persistence.mjs');
  assert.match(source, /store\('read_props'/);
  assert.match(source, /timeoutMs: 900/);
  assert.doesNotMatch(source, /rpc\/autoscout_read_props_fast/);
});

test('database migration removes periodic line rewrites and delegates read_props to the sport-first helper', async () => {
  const sql = await read('../supabase/migrations/20260924093000_reduce_persistence_wal_and_fast_fallback.sql');
  assert.doesNotMatch(sql, /public\.prop_lines\.updated_at < now\(\) - interval '30 minutes'/);
  assert.match(sql, /private\.autoscout_read_props_fast/);
  assert.match(sql, /return private\.autoscout_read_props_fast\(p_token,p_payload->>'sport'\)/);
  assert.match(sql, /cross join lateral/);
  assert.doesNotMatch(sql, /row_number\(\) over\(partition by pl\.prop_id/);
  assert.match(sql, /autovacuum_vacuum_scale_factor = 0\.02/);
});
