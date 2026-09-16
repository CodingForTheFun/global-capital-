// The supplement's policy decides how much of a paid PropLine key actually gets
// used. These tests pin the shape of that decision, and that a tier can never
// quietly spend the reserve it sets aside for itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { proplineSupplementPolicy } from '../lib/ingestion/propline-supplement.mjs';

const dayCost = (policy, sports = 12) => {
  const perSportSeconds = policy.intervalSeconds * (sports - 1);
  return sports * (1 + policy.eventLimit) * Math.floor(86400 / perSportSeconds);
};

test('a streaming-lite key covers a full NFL slate', () => {
  const policy = proplineSupplementPolicy({ limit: 250_000, tier: 'streaming-lite' });
  assert.ok(policy.eventLimit >= 16, `an NFL Sunday is 16 games; eventLimit is ${policy.eventLimit}`);
});

test('the widened cap still leaves most of the allowance unspent', () => {
  const policy = proplineSupplementPolicy({ limit: 250_000, tier: 'streaming-lite' });
  const usable = 250_000 - policy.reserve;
  const cost = dayCost(policy);
  assert.ok(cost < usable * 0.5, `projected ${cost}/day against ${usable} usable`);
});

test('every tier keeps a reserve it cannot spend', () => {
  for (const limit of [1_000, 5_000, 25_000, 250_000, 1_000_000]) {
    const policy = proplineSupplementPolicy({ limit });
    assert.ok(policy.reserve > 0, `no reserve at limit ${limit}`);
    assert.ok(dayCost(policy) < limit - policy.reserve, `tier at limit ${limit} would spend its reserve`);
  }
});

test('a sport always comes round again before its cached board expires', () => {
  for (const limit of [1_000, 5_000, 25_000, 250_000, 1_000_000]) {
    const policy = proplineSupplementPolicy({ limit });
    const perSportSeconds = policy.intervalSeconds * (12 - 1);
    assert.ok(perSportSeconds < policy.maxAgeSeconds,
      `at limit ${limit} a sport refreshes every ${perSportSeconds}s but expires at ${policy.maxAgeSeconds}s, so PropLine would contribute nothing in the gap`);
  }
});

test('a smaller key is not widened past what it can afford', () => {
  const free = proplineSupplementPolicy({ limit: 1_000, tier: 'free' });
  assert.ok(free.eventLimit <= 4, 'a free key must stay conservative');
  assert.ok(free.intervalSeconds >= 300);
});

test('an unreported limit falls back to the most cautious policy', () => {
  const unknown = proplineSupplementPolicy({});
  assert.equal(unknown.eventLimit, 2);
  assert.ok(unknown.intervalSeconds >= 900);
});
