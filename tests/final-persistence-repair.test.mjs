import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (relative) => readFile(new URL(relative, import.meta.url), 'utf8');

test('direct persistence discovers the Supavisor cluster instead of pinning aws-0', async () => {
  const source = await read('../supabase/functions/autoscout-db-direct/index.ts');
  assert.match(source, /SUPABASE_DB_POOLER_URL/);
  assert.match(source, /SUPABASE_DB_POOLER_HOST/);
  assert.match(source, /Array\.from\(\{ length: 8 \}/);
  assert.match(source, /connect_timeout: 3/);
  assert.match(source, /await candidate`select 1 as ok`/);
  assert.doesNotMatch(source, /configuredPoolerHost\s*=.*aws-0-us-east-1/);
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
