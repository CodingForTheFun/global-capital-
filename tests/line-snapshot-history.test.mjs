// Line history stopped being recorded on 2026-09-13 and nothing said so.
//
// The scheduler is production's only continuous writer, and a commit that
// moved persistence to public feeds also passed includeSnapshots:false. The
// table kept its 222k existing rows, /api/health kept reporting persistence
// healthy with lastError null, and every historical line-movement feature
// quietly had no data to stand on - including the "permanent line-history
// storage" the pricing page sells.
//
// It was switched off for a real reason: the unique key includes
// provider_updated_at, so a book re-stamping an unchanged line wrote a fresh
// row every cycle - 222k rows holding only 86k distinct values. Recording only
// what moved is what makes keeping the history affordable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { changedSnapshots, persistenceHealth } from '../lib/autoscout/supabase-persistence.mjs';

const quote = (over = {}) => ({ propId: 'p1', bookmakerKey: 'pinnacle', side: 'OVER', line: 250.5, price: -110,
  providerUpdatedAt: '2026-09-15T12:00:00.000Z', ingestedAt: '2026-09-15T12:00:00.000Z', ...over });

test('an unchanged quote seeds once and is not recorded as movement', () => {
  const seen = new Map();
  assert.equal(changedSnapshots([quote()], seen).length, 0, 'the first sighting seeds the restart cache');
  assert.equal(changedSnapshots([quote()], seen).length, 0, 'the same number again is not history');
  // A fresh provider timestamp on an unchanged number is exactly the noise
  // that filled the table; it must not create a row.
  assert.equal(changedSnapshots([quote({ providerUpdatedAt: '2026-09-15T12:05:00.000Z' })], seen).length, 0);
});

test('a moved line or a moved price is recorded', () => {
  const seen = new Map();
  changedSnapshots([quote()], seen);
  assert.equal(changedSnapshots([quote({ line: 251.5 })], seen).length, 1, 'a line move is history');
  assert.equal(changedSnapshots([quote({ line: 251.5, price: -115 })], seen).length, 1, 'a price move is history');
  assert.equal(changedSnapshots([quote({ line: 251.5, price: -115 })], seen).length, 0, 'and then it settles');
});

test('each book and side is tracked on its own', () => {
  const seen = new Map();
  const first = changedSnapshots([
    quote(), quote({ bookmakerKey: 'fanduel' }), quote({ side: 'UNDER' }),
  ], seen);
  assert.equal(first.length, 0, 'first sightings seed each independent quote');
  const moved = changedSnapshots([
    quote({ line: 251.5 }),
    quote({ bookmakerKey: 'fanduel', line: 252.5 }),
    quote({ side: 'UNDER', line: 249.5 }),
  ], seen);
  assert.equal(moved.length, 3, 'each book and side records its own movement');
  assert.equal(changedSnapshots([quote({ bookmakerKey: 'fanduel', line: 252.5 })], seen).length, 0);
});

test('a row that cannot identify a quote is never written', () => {
  const seen = new Map();
  assert.equal(changedSnapshots([
    quote({ propId: '' }), quote({ bookmakerKey: '' }), quote({ side: '' }),
    quote({ line: null }), quote({ line: undefined }),
  ], seen).length, 0);
});

test('the tracking map stays bounded in a long-running process', () => {
  const seen = new Map();
  for (let i = 0; i < 61_500; i++) changedSnapshots([quote({ propId: `p${i}` })], seen);
  assert.ok(seen.size <= 60_000, `expected the map to stay bounded, saw ${seen.size}`);
});

test('a movement snapshot carries what the history table needs', () => {
  const seen = new Map();
  changedSnapshots([quote()], seen);
  const [row] = changedSnapshots([quote({ line: 251.5 })], seen);
  assert.deepEqual(Object.keys(row).sort(),
    ['bookmaker_key', 'ingested_at', 'line', 'price', 'prop_id', 'provider_updated_at', 'side']);
  assert.equal(row.prop_id, 'p1');
  assert.equal(row.line, 251.5);
});

// The scheduler is the only thing writing continuously; if it stops sending
// snapshots again, history stops again.
test('the persistence scheduler still asks for snapshots', () => {
  const source = readFileSync(new URL('../lib/autoscout/persistence-scheduler.mjs', import.meta.url), 'utf8');
  assert.match(source, /persistNormalizedBoard\(board, \{ includeSnapshots: true \}\)/);
  assert.ok(!/includeSnapshots: false/.test(source), 'the scheduler must not disable line history');
});

// Health said configured/lastError-null for two days while writing nothing.
test('health reports when history was last written, so silence is visible', () => {
  const health = persistenceHealth();
  assert.ok('lastSnapshotAt' in health, 'health must say when history was last recorded');
  assert.ok('lastSnapshotError' in health, 'and must surface a snapshot failure');
});

test('a snapshot failure is recorded rather than swallowed', () => {
  const source = readFileSync(new URL('../lib/autoscout/supabase-persistence.mjs', import.meta.url), 'utf8');
  assert.ok(!/\} catch \{\}/.test(source), 'no bare catch may hide a history write failure');
  assert.match(source, /lastSnapshotError = \{/);
});
