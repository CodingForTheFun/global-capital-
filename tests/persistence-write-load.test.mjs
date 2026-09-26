// On 2026-09-15 the database stopped accepting board writes entirely: dirty
// buffers climbed from 10% to 33%, one checkpoint took 719s against a 270s
// pacing target, and every autoscout_ingest_board call failed with a statement
// timeout. The scheduler was asking for a write every four seconds - twelve
// sports on a 45-second timer - and most of those writes carried an
// out-of-season board with nothing in it.
//
// These tests pin the two reductions so the load cannot silently come back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { persistNormalizedBoard } from '../lib/autoscout/supabase-persistence.mjs';
import { __testNextSports, fairSportPersistenceBudget } from '../lib/autoscout/persistence-scheduler.mjs';
import { readFileSync } from 'node:fs';

const SPORTS = ['NFL','NBA','WNBA','MLB','NHL','NCAAF','NCAAB','SOCCER','MLS','EPL','UCL','TENNIS'];

// Persistence is only reached when it is configured, so the write path needs
// credentials to be exercised at all. They point at a closed local port: the
// skip must happen before any request, and the non-empty case must fail on the
// connection rather than quietly do nothing.
process.env.AUTOSCOUT_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.AUTOSCOUT_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
process.env.AUTOSCOUT_SUPABASE_INGEST_TOKEN = 'test-ingest-token';

test('an empty board is not written to the database at all', async () => {
  const result = await persistNormalizedBoard({ data: { events: [], players: [], props: [], lines: [] } });
  assert.equal(result.skipped, 'EMPTY_BOARD');
  assert.equal(result.counts.props, 0);
});

test('a board with anything in it is still attempted', async () => {
  const board = { data: { events: [], players: [], props: [], lines: [{ id: 'l1', propId: 'p1', bookmakerKey: 'fanduel', side: 'OVER', line: 1.5, price: -110 }] } };
  const result = await persistNormalizedBoard(board);
  assert.notEqual(result.skipped, 'EMPTY_BOARD');
  assert.equal(result.persisted, false, 'the closed port should surface as a failed write, not a skip');
});

test('each cycle takes only a slice of the sports, not all twelve', () => {
  const picked = __testNextSports(SPORTS, 4, 0);
  assert.equal(picked.length, 4);
  assert.deepEqual(picked, ['NFL','NBA','WNBA','MLB']);
});

test('the slices advance so every sport is still reached', () => {
  const seen = new Set();
  let cursor = 0;
  for (let cycle = 0; cycle < 3; cycle += 1) {
    for (const sport of __testNextSports(SPORTS, 4, cursor)) seen.add(sport);
    cursor += 4;
  }
  assert.equal(seen.size, SPORTS.length, 'three cycles of four should cover all twelve sports');
});

test('the cursor wraps instead of running off the end', () => {
  const picked = __testNextSports(SPORTS, 4, 10);
  assert.deepEqual(picked, ['UCL','TENNIS','NFL','NBA']);
});

test('asking for more sports than exist still returns each one once', () => {
  const picked = __testNextSports(SPORTS, 99, 0);
  assert.deepEqual(picked, SPORTS);
});


test('all-sport persistence shares the remaining cycle budget instead of letting early sports starve later ones', () => {
  assert.equal(fairSportPersistenceBudget({ cycleMs: 270_000, elapsedMs: 25_000, sportsRemaining: 12, maxSportMs: 60_000, safetyMs: 10_000 }), 19_583);
  assert.equal(fairSportPersistenceBudget({ cycleMs: 270_000, elapsedMs: 150_000, sportsRemaining: 6, maxSportMs: 60_000, safetyMs: 10_000 }), 18_333);
  assert.equal(fairSportPersistenceBudget({ cycleMs: 270_000, elapsedMs: 0, sportsRemaining: 2, maxSportMs: 60_000, safetyMs: 10_000 }), 60_000);
});

test('canonical RPC board chunks reduce round trips but remain bounded', () => {
  const source = readFileSync(new URL('../lib/autoscout/supabase-persistence.mjs', import.meta.url), 'utf8');
  assert.match(source, /RPC_BOARD_BATCH_SIZE = 500/);
  assert.doesNotMatch(source, /RPC_BOARD_BATCH_SIZE = (?:1000|[2-9][0-9]{3,})/);
});
