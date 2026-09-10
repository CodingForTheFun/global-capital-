import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runIngestCycle, startIngestWorker, stopIngestWorker, ingestHealth,
  ingestConfig, _resetIngestState,
} from '../lib/autoscout/ingest-worker.mjs';

const quiet = { log() {}, error() {} };
const board = (events, lines = 5) => ({ meta: { events }, props: [] , _lines: lines });
const persistOk = (counts = { snapshots: 5, lines: 5 }) => async () => ({ configured: true, persisted: true, counts });

test.beforeEach(() => {
  _resetIngestState();
  delete process.env.AUTOSCOUT_INGEST_SPORTS;
  delete process.env.AUTOSCOUT_INGEST_MAX_CYCLES_PER_DAY;
  delete process.env.AUTOSCOUT_INGEST_ENABLED;
});
test.after(() => { stopIngestWorker(); });

test('a cycle persists each league that has events', async () => {
  const persisted = [];
  const result = await runIngestCycle({
    sports: ['NFL', 'NBA'],
    fetchBoard: async (sport) => board(sport === 'NFL' ? 3 : 2),
    persist: async (b) => { persisted.push(b.meta.events); return { persisted: true, counts: { snapshots: 4, lines: 4 } }; },
    log: quiet,
  });
  assert.equal(persisted.length, 2);
  assert.equal(result.written.snapshots, 8);
  assert.deepEqual(result.leagues.map((r) => r.persisted), [true, true]);
});

test('the cache is bypassed, or a cycle would write nothing', async () => {
  let sawForce = null;
  await runIngestCycle({
    sports: ['NFL'],
    fetchBoard: async (_s, options) => { sawForce = options?.force; return board(1); },
    persist: persistOk(), log: quiet,
  });
  assert.equal(sawForce, true, 'a cache hit persists nothing, which is what kept the table flat');
});

test('a league with no events is not persisted', async () => {
  let persistCalls = 0;
  const result = await runIngestCycle({
    sports: ['NHL'],
    fetchBoard: async () => board(0),
    persist: async () => { persistCalls += 1; return { persisted: true, counts: {} }; },
    log: quiet,
  });
  assert.equal(persistCalls, 0);
  assert.equal(result.leagues[0].persisted, false);
});

test('an empty league is skipped on later cycles instead of burning requests', async () => {
  let fetches = 0;
  const deps = {
    sports: ['NHL'],
    fetchBoard: async () => { fetches += 1; return board(0); },
    persist: persistOk(), log: quiet,
  };
  await runIngestCycle(deps);            // cycle 1: looks, finds nothing
  const second = await runIngestCycle(deps); // cycle 2: should sit out
  assert.equal(fetches, 1, 'the idle league was not re-fetched immediately');
  assert.equal(second.leagues[0].skipped, true);
  assert.match(second.leagues[0].reason, /no events/i);
});

test('a league that comes back to life is picked up again', async () => {
  let events = 0;
  const deps = {
    sports: ['NHL'],
    fetchBoard: async () => board(events),
    persist: persistOk(), log: quiet,
  };
  for (let i = 0; i < 6; i += 1) await runIngestCycle(deps); // build an empty streak
  events = 4;
  let sawPersist = false;
  for (let i = 0; i < 7; i += 1) {
    const r = await runIngestCycle({ ...deps, persist: async () => { sawPersist = true; return { persisted: true, counts: {} }; } });
    if (r.leagues[0]?.persisted) break;
  }
  assert.equal(sawPersist, true, 'an idle league must be re-checked, not abandoned');
});

test('the daily cycle budget is enforced', async () => {
  process.env.AUTOSCOUT_INGEST_MAX_CYCLES_PER_DAY = '2';
  const deps = { sports: ['NFL'], fetchBoard: async () => board(1), persist: persistOk(), log: quiet };
  await runIngestCycle(deps);
  await runIngestCycle(deps);
  const third = await runIngestCycle(deps);
  assert.equal(third.skipped, true);
  assert.match(third.reason, /budget/i);
});

test('one league failing does not stop the rest of the cycle', async () => {
  const result = await runIngestCycle({
    sports: ['NFL', 'NBA'],
    fetchBoard: async (sport) => { if (sport === 'NFL') throw Object.assign(new Error('upstream 502'), { code: 'ODDS_UPSTREAM' }); return board(2); },
    persist: persistOk(), log: quiet,
  });
  assert.equal(result.leagues[0].error, 'ODDS_UPSTREAM');
  assert.equal(result.leagues[1].persisted, true, 'the healthy league still ran');
});

test('a persistence failure is recorded rather than counted as a write', async () => {
  const result = await runIngestCycle({
    sports: ['NFL'],
    fetchBoard: async () => board(2),
    persist: async () => ({ configured: true, persisted: false, error: 'DATABASE_WRITE_FAILED' }),
    log: quiet,
  });
  assert.equal(result.leagues[0].persisted, false);
  assert.equal(result.written.snapshots, 0);
});

test('AUTOSCOUT_INGEST_SPORTS overrides the league list', async () => {
  process.env.AUTOSCOUT_INGEST_SPORTS = 'MLB';
  const seen = [];
  await runIngestCycle({
    sports: ['NFL', 'NBA'],
    fetchBoard: async (sport) => { seen.push(sport); return board(1); },
    persist: persistOk(), log: quiet,
  });
  assert.deepEqual(seen, ['MLB']);
});

test('the worker stays idle when disabled or when there is nowhere to write', () => {
  process.env.AUTOSCOUT_INGEST_ENABLED = 'false';
  assert.equal(startIngestWorker({ sports: [], fetchBoard: async () => board(0), persist: persistOk(), log: quiet }), null);

  process.env.AUTOSCOUT_INGEST_ENABLED = 'true';
  assert.equal(
    startIngestWorker({ sports: [], fetchBoard: async () => board(0), persist: persistOk(), persistenceConfigured: () => false, log: quiet }),
    null,
    'snapshots would be discarded with no database, so do not spend requests',
  );
});

test('the interval has a floor, so a typo cannot hammer the odds provider', () => {
  const before = process.env.AUTOSCOUT_INGEST_INTERVAL_MINUTES;
  process.env.AUTOSCOUT_INGEST_INTERVAL_MINUTES = '1';
  assert.ok(ingestConfig().intervalMinutes >= 5);
  if (before === undefined) delete process.env.AUTOSCOUT_INGEST_INTERVAL_MINUTES;
  else process.env.AUTOSCOUT_INGEST_INTERVAL_MINUTES = before;
});

test('health reports progress and never leaks a credential', async () => {
  await runIngestCycle({ sports: ['NFL'], fetchBoard: async () => board(2), persist: persistOk(), log: quiet });
  const health = ingestHealth();
  assert.equal(health.cycles, 1);
  assert.equal(health.written.snapshots, 5);
  assert.ok(health.leagues.NFL);
  const text = JSON.stringify(health);
  assert.ok(!/key|token|secret|password|apikey/i.test(text), text);
});
