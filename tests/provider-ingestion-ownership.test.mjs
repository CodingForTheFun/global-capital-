import test from 'node:test';
import assert from 'node:assert/strict';
import { ownsProviderIngestion, publicFeedWorkerActive } from '../lib/autoscout/persistence-scheduler.mjs';

// The regression this pins, exactly as production hit it: provider-mode `mesh`
// turns the public scraped feeds off, so `publicWorkerConfigured()` is false and
// the branch that assigns the lease never runs. Ownership defaulted to false and
// stayed there, so PropLine and Sportradar were never refreshed once —
// `startedAt` stayed null and `cycles` stayed 0 for the life of the process,
// while SportsGameOdds kept working from its own timer.
test('mesh mode owns provider ingestion when no public worker is running', () => {
  assert.equal(publicFeedWorkerActive('mesh', false), false);
  assert.equal(ownsProviderIngestion('mesh', false, false), true);
  assert.equal(ownsProviderIngestion('sportsgameodds', false, false), true);
});

// The lease still decides whenever there is something to decide. A public
// worker that lost the race must not also run the paid providers.
test('a running public worker still arbitrates ownership', () => {
  assert.equal(publicFeedWorkerActive('propline', true), true);
  assert.equal(ownsProviderIngestion('propline', true, false), false, 'a lost lease must not own ingestion');
  assert.equal(ownsProviderIngestion('propline', true, true), true, 'a won lease owns ingestion');
});

// `sportsgameodds` mode skips the public cycle by provider mode rather than by
// configuration, so it owns ingestion even where a worker is configured.
test('sportsgameodds mode never waits on the public lease', () => {
  assert.equal(publicFeedWorkerActive('sportsgameodds', true), false);
  assert.equal(ownsProviderIngestion('sportsgameodds', true, false), true);
});

test('ownership is a boolean for every shape of input', () => {
  for (const mode of ['mesh', 'propline', 'sportsgameodds', '', undefined]) {
    for (const configured of [true, false, undefined, null]) {
      for (const claimed of [true, false, undefined, null]) {
        assert.equal(typeof ownsProviderIngestion(mode, configured, claimed), 'boolean');
      }
    }
  }
});
