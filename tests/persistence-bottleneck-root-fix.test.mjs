import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizedDataFromBoardRows } from '../lib/ingestion/normalize.mjs';
import { stableId } from '../lib/autoscout/models.mjs';

const read = (relative) => readFile(new URL(relative, import.meta.url), 'utf8');

function publicRow(id, price) {
  return {
    id,
    provider: 'propline',
    sport: 'MLB',
    eventId: 'event-1',
    playerId: 'player-1',
    providerPlayerId: 'provider-player-1',
    playerName: 'Fixture Player',
    team: 'AAA',
    position: 'P',
    marketId: 'pitcher_outs',
    market: 'Pitching Outs',
    period: 'game',
    side: 'OVER',
    line: 14.5,
    price,
    sportsbookKey: 'underdog',
    sportsbook: 'Underdog',
    gameStartTime: '2026-09-25T00:00:00.000Z',
    homeTeam: 'AAA',
    awayTeam: 'BBB',
    providerUpdatedAt: '2026-09-24T09:00:00.000Z',
  };
}

test('flat public quote revisions collapse onto stable canonical quote identity', () => {
  const data = normalizedDataFromBoardRows([
    publicRow('ephemeral-old-id', -106),
    publicRow('ephemeral-new-id', -139),
  ], '2026-09-24T09:30:00.000Z');

  assert.equal(data.lines.length, 1);
  const propId = data.props[0].id;
  assert.equal(data.lines[0].id, stableId(['line', propId, 'underdog', 'OVER', 14.5]));
  assert.equal(data.lines[0].price, -139);
});

test('canonical persistence uses larger bounded batches', async () => {
  const source = await read('../lib/autoscout/supabase-persistence.mjs');
  assert.match(source, /RPC_BOARD_BATCH_SIZE = 500/);
  assert.doesNotMatch(source, /RPC_BOARD_BATCH_SIZE = (?:1000|[2-9][0-9]{3,})/);
});

test('customer persisted reads use the sport-first fast RPC', async () => {
  const source = await read('../lib/ingestion/public-persistence.mjs');
  assert.match(source, /rpc\/autoscout_read_props_fast/);
  assert.match(source, /AbortSignal\.timeout\(1_500\)/);
});

test('database migration removes periodic line rewrites and avoids whole-table ranking', async () => {
  const sql = await read('../supabase/migrations/20260924093000_reduce_persistence_wal_and_fast_fallback.sql');
  assert.doesNotMatch(sql, /public\.prop_lines\.updated_at < now\(\) - interval '30 minutes'/);
  assert.match(sql, /autoscout_read_props_fast/);
  assert.match(sql, /cross join lateral/);
  assert.doesNotMatch(sql, /row_number\(\) over\(partition by pl\.prop_id/);
  assert.match(sql, /autovacuum_vacuum_scale_factor = 0\.02/);
});
