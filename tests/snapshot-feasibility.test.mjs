// Line history stopped for seven hours on 2026-09-15 and every health field
// stayed green, because three independently tunable numbers - cycle interval,
// sports per cycle, snapshot interval - can combine into a configuration where
// a snapshot is never possible. Nothing errors. It just records nothing.
//
// These tests pin the arithmetic that now says so out loud.
import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotFeasibility } from '../lib/autoscout/persistence-scheduler.mjs';

test('the configuration that actually broke production is reported infeasible', () => {
  // What production was running: 12 sports, one per cycle, 300s cycles,
  // snapshots every 1800s. A sport came round every hour; the window was half one.
  const out = snapshotFeasibility({ sports: 12, perCycle: 1, cycleSeconds: 300, snapshotSeconds: 1800 });
  assert.equal(out.feasible, false);
  assert.equal(out.sweepSeconds, 3600);
  assert.equal(out.snapshotSeconds, 1800);
});

test('it names the smallest change that would fix it', () => {
  const out = snapshotFeasibility({ sports: 12, perCycle: 1, cycleSeconds: 300, snapshotSeconds: 1800 });
  // 1800/300 = 6 cycles available in a window; 12 sports over 6 cycles = 2 per cycle.
  assert.equal(out.needsPerCycleAtLeast, 2);
  const fixed = snapshotFeasibility({ sports: 12, perCycle: out.needsPerCycleAtLeast, cycleSeconds: 300, snapshotSeconds: 1800 });
  assert.equal(fixed.feasible, true, 'the recommendation must actually be sufficient');
});

test('the settings production runs now are feasible', () => {
  const out = snapshotFeasibility({ sports: 12, perCycle: 12, cycleSeconds: 300, snapshotSeconds: 300 });
  assert.equal(out.feasible, true);
  assert.equal(out.sweepSeconds, 300);
});

test('a full sweep exactly equal to the window still counts as feasible', () => {
  const out = snapshotFeasibility({ sports: 12, perCycle: 4, cycleSeconds: 100, snapshotSeconds: 300 });
  assert.equal(out.sweepSeconds, 300);
  assert.equal(out.feasible, true);
});

test('a slower sweep than the window is infeasible by one second', () => {
  const out = snapshotFeasibility({ sports: 12, perCycle: 4, cycleSeconds: 100, snapshotSeconds: 299 });
  assert.equal(out.feasible, false);
});

test('taking every sport each cycle is always feasible at equal intervals', () => {
  for (const seconds of [45, 120, 300, 900]) {
    const out = snapshotFeasibility({ sports: 12, perCycle: 12, cycleSeconds: seconds, snapshotSeconds: seconds });
    assert.equal(out.feasible, true, `perCycle=all should be feasible at ${seconds}s`);
  }
});

test('the default is a configuration that can actually record history', async () => {
  const source = await import('node:fs').then(fs => fs.readFileSync(new URL('../lib/autoscout/persistence-scheduler.mjs', import.meta.url), 'utf8'));
  assert.match(source, /AUTOSCOUT_PERSIST_SPORTS_PER_CYCLE, PUBLIC_PERSISTENCE_SPORTS\.length/,
    'with no env var set, every sport must be taken each cycle so history is possible by default');
});

test('an infeasible configuration is warned about at startup', async () => {
  const source = await import('node:fs').then(fs => fs.readFileSync(new URL('../lib/autoscout/persistence-scheduler.mjs', import.meta.url), 'utf8'));
  assert.match(source, /WARNING line history cannot accumulate/, 'silence is what made this cost seven hours');
});
