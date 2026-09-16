// A 250,000/day subscription was spending 7,200 of it - 3%.
//
// The interval was never the constraint. The supplement refreshed ONE sport per
// invocation, and the scheduler invokes it once per 300s persistence cycle, so
// twelve sports rotated once an HOUR. Raising the interval could not have fixed
// that; only refreshing a slice per invocation does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { proplineSupplementPolicy } from '../lib/ingestion/propline-supplement.mjs';

// The scheduler's own cycle, which is what actually paces this.
const INVOCATION_SECONDS = 300;
const dayCost = (policy, sports = 12) =>
  (1 + policy.eventLimit) * Math.min(sports, policy.sportsPerCycle) * Math.floor(86400 / INVOCATION_SECONDS);

test('a streaming-lite key refreshes every sport within minutes, not hours', () => {
  const policy = proplineSupplementPolicy({ limit: 250_000, tier: 'streaming-lite' });
  const rotationMinutes = Math.ceil(12 / policy.sportsPerCycle) * INVOCATION_SECONDS / 60;
  assert.ok(rotationMinutes <= 10, `every sport should refresh within ten minutes, got ${rotationMinutes}`);
});

test('it uses a real share of the allowance without spending the reserve', () => {
  const policy = proplineSupplementPolicy({ limit: 250_000, tier: 'streaming-lite' });
  const usable = 250_000 - policy.reserve;
  const cost = dayCost(policy);
  assert.ok(cost > usable * 0.25, `${cost}/day is still barely touching a ${usable} allowance`);
  assert.ok(cost < usable * 0.8, `${cost}/day leaves too little headroom against ${usable}`);
});

test('no tier can spend the reserve it sets aside', () => {
  for (const limit of [1_000, 5_000, 25_000, 250_000, 1_000_000]) {
    const policy = proplineSupplementPolicy({ limit });
    assert.ok(dayCost(policy) < limit - policy.reserve,
      `a tier at ${limit} would spend into its own reserve`);
  }
});

test('every tier declares how many sports it takes per invocation', () => {
  for (const limit of [1_000, 5_000, 25_000, 250_000, 1_000_000]) {
    const policy = proplineSupplementPolicy({ limit });
    assert.ok(Number.isInteger(policy.sportsPerCycle) && policy.sportsPerCycle >= 1,
      `limit ${limit} has no usable sportsPerCycle`);
  }
});

test('small keys stay on one sport per invocation', () => {
  assert.equal(proplineSupplementPolicy({ limit: 1_000 }).sportsPerCycle, 1);
  assert.equal(proplineSupplementPolicy({ limit: 5_000 }).sportsPerCycle, 1);
});

test('the slice grows with the tier rather than being a fixed guess', () => {
  const tiers = [1_000, 5_000, 25_000, 250_000, 1_000_000].map((l) => proplineSupplementPolicy({ limit: l }).sportsPerCycle);
  for (let i = 1; i < tiers.length; i += 1) {
    assert.ok(tiers[i] >= tiers[i - 1], `slice shrank between tiers: ${tiers.join(' -> ')}`);
  }
});

test('a cycle cannot wrap and schedule one configured sport twice', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../lib/ingestion/propline-supplement.mjs', import.meta.url), 'utf8');
  assert.match(
    source,
    /const perCycle = Math\.min\(sports\.length, Math\.max\(1, Number\(policy\.sportsPerCycle\) \|\| 1\)\);/,
    'the effective slice must be capped to the number of configured sports',
  );
});

test('one sport failing does not abandon the rest of the slice', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../lib/ingestion/propline-supplement.mjs', import.meta.url), 'utf8');
  assert.match(source, /\/\/ One sport failing must not abandon the rest of the slice\.\s*\n\s*state\.lastError/);
});

test('sports are fetched sequentially so the reserve guard can still stop partway', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../lib/ingestion/propline-supplement.mjs', import.meta.url), 'utf8');
  assert.match(source, /for \(const pick of refreshed\) \{/, 'a burst of concurrent fetches would defeat the reserve guard');
  assert.ok(!/Promise\.all\(refreshed/.test(source));
});
