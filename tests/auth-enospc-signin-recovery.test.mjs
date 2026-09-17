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

test('the account-store ENOSPC fallback is narrow and every other persistence error is rethrown', () => {
  const source = readFileSync(new URL('../lib/auth/store.mjs', import.meta.url), 'utf8');
  assert.match(source, /error\?\.code === 'ENOSPC' && recoverableLoginMetadataPatch\(fallback\?\.patch\)/);
  assert.match(source, /throw error;/, 'non-ENOSPC and security-critical write failures must still fail closed');
  assert.match(source, /temp\+rename|temp write runs out of space/i, 'the fallback relies on the canonical users file staying atomic');
});

test('new device presence falls back to process memory only when ENOSPC blocks persistence', () => {
  const source = readFileSync(new URL('../lib/auth/presence.mjs', import.meta.url), 'utf8');
  assert.match(source, /const ephemeralSessions = new Map\(\)/);
  assert.match(source, /if \(error\?\.code !== 'ENOSPC'\) throw error;/,
    'unexpected session-store errors must still fail closed');
  assert.match(source, /ephemeralSessions\.set\(id, record\)/,
    'a full disk may preserve a newly authenticated device only in process memory');
  assert.match(source, /if \(error\?\.code === 'ENOSPC'\) return;/,
    'a heartbeat write must not turn a valid signed session into a 500');
  assert.match(source, /ephemeralSessions\.clear\(\)/,
    'the test/reset path must never leave emergency sessions behind');
});

test('per-device validation remains in the account request path', () => {
  const routes = readFileSync(new URL('../lib/auth/routes.mjs', import.meta.url), 'utf8');
  assert.match(routes, /session\.sessionId && !\(await isSessionActive\(session\.sessionId\)\)/,
    'sessions with a device id must still be checked server-side');
});

test('self sign-out always clears the account cookie even if presence cleanup fails', () => {
  const routes = readFileSync(new URL('../lib/auth/routes.mjs', import.meta.url), 'utf8');
  const logout = routes.match(/if \(path === '\/api\/account\/logout'\) \{([\s\S]*?)\n    \}\n\n    if \(path === '\/api\/account\/logout-all'\)/)?.[1] || '';
  assert.match(logout, /try \{/,
    'device-presence cleanup during self sign-out must be best effort');
  assert.match(logout, /catch \(error\)/,
    'a presence persistence failure must not escape the self sign-out route');
  assert.match(logout, /clearAccountCookie\(req\)/,
    'self sign-out must always expire the browser account cookie');
  assert.ok(logout.indexOf('clearAccountCookie(req)') > logout.indexOf('catch (error)'),
    'cookie clearing must happen after the best-effort cleanup boundary');
});
