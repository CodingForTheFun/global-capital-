import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const driver = readFileSync(new URL('../scripts/public-production-smoke-driver.mjs', import.meta.url), 'utf8');
const authenticated = readFileSync(new URL('../scripts/public-production-smoke-v2.mjs', import.meta.url), 'utf8');

test('production smoke never creates a customer account', () => {
  for (const source of [driver, authenticated]) {
    assert.doesNotMatch(source, /\/api\/account\/register/, 'production smoke must never register an account');
    assert.doesNotMatch(source, /@smoke\.autoscout\.test/, 'production smoke must not generate fake customer identities');
  }
});

test('authenticated production smoke requires an explicit pre-provisioned identity', () => {
  assert.match(driver, /AUTOSCOUT_SMOKE_EMAIL/);
  assert.match(driver, /AUTOSCOUT_SMOKE_PASSWORD/);
  assert.match(driver, /SMOKE_EMAIL && SMOKE_PASSWORD/);
  assert.match(driver, /skipped-no-credentials/);

  assert.match(authenticated, /AUTOSCOUT_SMOKE_EMAIL/);
  assert.match(authenticated, /AUTOSCOUT_SMOKE_PASSWORD/);
  assert.match(authenticated, /\/api\/account\/login/);
  assert.match(authenticated, /pre-provisioned/);
});
