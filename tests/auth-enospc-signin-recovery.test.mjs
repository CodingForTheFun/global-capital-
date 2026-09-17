import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recoverableLoginMetadataPatch } from '../lib/auth/store.mjs';

test('only successful-login metadata is recoverable when the volume is full', () => {
  assert.equal(recoverableLoginMetadataPatch({
    failedAttempts: 0,
    lockedUntil: null,
    lastLoginAt: new Date().toISOString(),
    lastLoginIp: '203.0.113.10',
  }), true);

  // Opportunistic password rehash after a correct password is also maintenance;
  // the already-valid stored hash remains authoritative if this write cannot land.
  assert.equal(recoverableLoginMetadataPatch({
    failedAttempts: 0,
    lockedUntil: null,
    lastLoginAt: new Date().toISOString(),
    lastLoginIp: null,
    passwordHash: 'rehash-value',
  }), true);

  // A wrong-password attempt must still fail closed; without lastLoginAt this is
  // security state, not successful-login metadata.
  assert.equal(recoverableLoginMetadataPatch({ failedAttempts: 4, lockedUntil: null }), false);

  // Never allow storage exhaustion to bypass a security-critical account write.
  for (const key of ['sessionVersion', 'emailVerified', 'disabled', 'pendingCodes', 'role']) {
    assert.equal(recoverableLoginMetadataPatch({ lastLoginAt: new Date().toISOString(), [key]: true }), false, key);
  }
});

test('the ENOSPC fallback is narrow and every other persistence error is rethrown', () => {
  const source = readFileSync(new URL('../lib/auth/store.mjs', import.meta.url), 'utf8');
  assert.match(source, /error\?\.code === 'ENOSPC' && recoverableLoginMetadataPatch\(fallback\?\.patch\)/);
  assert.match(source, /throw error;/, 'non-ENOSPC and security-critical write failures must still fail closed');
  assert.match(source, /temp\+rename|temp write runs out of space/i, 'the fallback relies on the canonical users file staying atomic');
});
