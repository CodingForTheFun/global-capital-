import test from 'node:test';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {
  createSessionCodec,
  createRateLimiter,
  permissionsFor,
  parseCookies,
  cookieHeader,
  clearCookieHeader,
  clientKey,
  encodeSubject,
  safeEqual,
  OWNER,
  MEMBER,
} from '../lib/session.mjs';

const SECRET = 'a-long-random-dashboard-session-secret-for-tests';
const sessions = createSessionCodec({ secret: SECRET });

test('owner sessions carry every permission', () => {
  const session = sessions.readToken(sessions.makeToken(OWNER, OWNER));
  assert.deepEqual(session, { authenticated: true, role: OWNER, subject: OWNER, reason: null });
  const permissions = permissionsFor(session.role);
  assert.equal(permissions.canGenerateAccessCodes, true);
  assert.equal(permissions.canRevokeAccessCodes, true);
  assert.equal(permissions.canManageConnection, true);
  assert.equal(permissions.canChangeRules, true);
  assert.equal(permissions.canAdministerOwner, true);
});

test('member sessions can use the dashboard but hold no owner authority', () => {
  const session = sessions.readToken(sessions.makeToken(MEMBER, 'invite-abc'));
  assert.equal(session.role, MEMBER);
  assert.equal(session.subject, 'invite-abc');

  const permissions = permissionsFor(session.role);
  assert.equal(permissions.canViewDashboard, true);
  assert.equal(permissions.canRunScan, true);
  // Everything an owner alone may do:
  assert.equal(permissions.canGenerateAccessCodes, false);
  assert.equal(permissions.canRevokeAccessCodes, false);
  assert.equal(permissions.canListAccessCodes, false);
  assert.equal(permissions.canManageConnection, false);
  assert.equal(permissions.canChangeRules, false);
  assert.equal(permissions.canAdministerOwner, false);
});

test('an unauthenticated visitor holds no permissions at all', () => {
  const permissions = permissionsFor(null);
  for (const [key, value] of Object.entries(permissions)) {
    if (key === 'role') continue;
    assert.equal(value, false, `${key} must be false when unauthenticated`);
  }
});

test('a member cannot forge an owner token by editing the cookie', () => {
  const memberToken = sessions.makeToken(MEMBER, 'invite-abc');
  const [, expires, signature] = memberToken.split('.');

  // Swap the identity, keep the signature: the HMAC covers the identity.
  assert.equal(sessions.readToken(`owner.${expires}.${signature}`).authenticated, false);
  assert.equal(sessions.readToken(`owner.${expires}.${signature}`).reason, 'bad-signature');

  // Re-sign attempts with the wrong secret must fail.
  const attacker = createSessionCodec({ secret: 'guessed-secret' });
  assert.equal(sessions.readToken(attacker.makeToken(OWNER, OWNER)).authenticated, false);
});

test('malformed, empty and tampered tokens are rejected', () => {
  for (const token of ['', null, undefined, 'garbage', 'owner.123', 'a.b.c.d', 'owner..sig', '..']) {
    assert.equal(sessions.readToken(token).authenticated, false, `accepted: ${String(token)}`);
  }
  const valid = sessions.makeToken(OWNER, OWNER);
  assert.equal(sessions.readToken(`${valid}x`).authenticated, false, 'signature suffix must invalidate');
});

test('expired tokens are rejected even with a valid signature', () => {
  let clock = Date.now();
  const codec = createSessionCodec({ secret: SECRET, ttlMs: 1000, now: () => clock });
  const token = codec.makeToken(OWNER, OWNER);
  assert.equal(codec.readToken(token).authenticated, true);
  clock += 2000;
  assert.equal(codec.readToken(token).reason, 'expired');
});

test('an identity we do not recognise never resolves to a role, even correctly signed', () => {
  // Sign a hand-made identity with the *real* secret: the codec must still
  // refuse it, because roles come from an explicit allowlist of identities.
  const expires = Date.now() + 60_000;
  const payload = `superuser.${expires}`;
  const signature = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  const session = sessions.readToken(`${payload}.${signature}`);
  assert.equal(session.authenticated, false);
  assert.equal(session.role, null);
  assert.equal(session.reason, 'unknown-identity');
});

test('member subjects are normalised so they cannot break the token payload', () => {
  assert.equal(encodeSubject('abc.def'), 'abcdef', 'dots would split the payload');
  assert.equal(encodeSubject('../../etc/passwd'), 'etcpasswd');
  assert.equal(encodeSubject(''), 'invite');
  assert.equal(encodeSubject('a'.repeat(200)).length, 64);

  const session = sessions.readToken(sessions.makeToken(MEMBER, 'ok-id_1'));
  assert.equal(session.role, MEMBER);
  assert.equal(session.subject, 'ok-id_1');
});

test('session cookies are HttpOnly, SameSite=Strict and Secure behind TLS', () => {
  const https = cookieHeader({ headers: { 'x-forwarded-proto': 'https' } }, 'token-value');
  assert.match(https, /HttpOnly/);
  assert.match(https, /SameSite=Strict/);
  assert.match(https, /; Secure/);
  assert.match(https, /Path=\//);

  const http = cookieHeader({ headers: {} }, 'token-value');
  assert.ok(!http.includes('Secure'), 'no Secure flag without TLS, or local dev breaks');

  assert.match(clearCookieHeader({ headers: {} }), /Max-Age=0/);
});

test('cookie parsing survives junk without throwing', () => {
  assert.deepEqual(parseCookies({ headers: { cookie: 'aps_session=abc; other=1' } }), { aps_session: 'abc', other: '1' });
  assert.deepEqual(parseCookies({ headers: {} }), {});
  assert.deepEqual(parseCookies({}), {});
  assert.equal(parseCookies({ headers: { cookie: 'bad%%%=value' } })['bad%%%'], 'value');
});

test('rate limiting blocks a burst and recovers after the window', () => {
  let clock = 0;
  const limiter = createRateLimiter({ now: () => clock });
  for (let i = 0; i < 8; i++) assert.equal(limiter.allow('ip:1', 8, 60_000), true, `attempt ${i + 1}`);
  assert.equal(limiter.allow('ip:1', 8, 60_000), false, '9th attempt is blocked');

  // A different client is unaffected.
  assert.equal(limiter.allow('ip:2', 8, 60_000), true);

  clock += 60_001;
  assert.equal(limiter.allow('ip:1', 8, 60_000), true, 'window expiry restores access');
});

test('rate-limit keys separate clients and buckets', () => {
  const a = clientKey({ headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }, socket: {} }, 'unlock');
  const b = clientKey({ headers: {}, socket: { remoteAddress: '203.0.113.9' } }, 'unlock');
  const c = clientKey({ headers: { 'x-forwarded-for': '203.0.113.9' }, socket: {} }, 'scan');
  assert.equal(a, 'unlock:203.0.113.9', 'uses the client IP, not the proxy chain');
  assert.equal(a, b);
  assert.notEqual(a, c, 'buckets are independent');
  assert.equal(clientKey({}, 'unlock'), 'unlock:unknown');
});

test('safeEqual is length-safe and rejects empty comparisons', () => {
  assert.equal(safeEqual('secret', 'secret'), true);
  assert.equal(safeEqual('secret', 'secrey'), false);
  assert.equal(safeEqual('secret', 'sec'), false);
  assert.equal(safeEqual('', ''), false, 'an unset password must never match');
});
