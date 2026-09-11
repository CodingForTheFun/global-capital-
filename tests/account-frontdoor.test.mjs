// The account system in its production wiring.
//
// tests/auth-http.test.mjs already covers the flows themselves. What is new —
// and what was broken before this — is that the routes are mounted where
// production can reach them, that Google sign-in is bound to the browser that
// started it, and that the plan limits actually stop a call.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'account-frontdoor-'));
process.env.DATA_DIR = dataDir;
process.env.DASHBOARD_SESSION_SECRET = 'test-secret-for-account-sessions';

const { issueState, verifyState, googleHealth } = await import('../lib/auth/google.mjs');
const { handleGoogleRoutes, STATE_COOKIE, linkGoogleAccount } = await import('../lib/auth/google-routes.mjs');
const { createAccountSessions } = await import('../lib/auth/session.mjs');
const { accountSecret } = await import('../lib/auth/secret.mjs');
const { consume, resetUsage } = await import('../lib/billing/usage.mjs');
const { entitlementFor, publicEntitlement, grantPlan, PLANS } = await import('../lib/billing/entitlements.mjs');
const store = await import('../lib/auth/store.mjs');

const SECRET = 'test-secret-for-account-sessions';
const sessions = createAccountSessions({ secret: SECRET });

function fakeRes() {
  return {
    statusCode: null, headers: null, body: null, ended: false,
    writeHead(status, headers) { this.statusCode = status; this.headers = headers || {}; },
    end(body) { this.body = body ?? null; this.ended = true; },
  };
}

function fakeReq({ method = 'GET', cookie = '', headers = {} } = {}) {
  return { method, headers: { cookie, ...headers }, socket: { remoteAddress: '203.0.113.5' } };
}

const json = (res, status, body, extra = {}) => { res.writeHead(status, extra); res.end(JSON.stringify(body)); };

test('the frontdoor mounts the account routes, not the legacy Scout server', async () => {
  const frontdoor = await fs.readFile(new URL('../frontdoor-prod.mjs', import.meta.url), 'utf8');
  assert.match(frontdoor, /handleAccountRoutes/, 'account routes must be mounted at the frontdoor');
  assert.match(frontdoor, /handleGoogleRoutes/, 'Google routes must be mounted at the frontdoor');
  // server-scout.mjs gates every /api/* path behind its own access code, so a
  // person with no account could never reach register or login through it.
  const accountIndex = frontdoor.indexOf('maybeServeAccount(req, res)');
  const proxyIndex = frontdoor.indexOf('const dst = target(req.url');
  assert.ok(accountIndex > 0 && accountIndex < proxyIndex, 'account routes must run before the proxy');
});

test('the account secret is shared, so a cookie issued at the frontdoor verifies in Scout', () => {
  const a = accountSecret({ DASHBOARD_SESSION_SECRET: 'configured' });
  const b = accountSecret({ DASHBOARD_SESSION_SECRET: 'configured' });
  assert.equal(a, b);
  // Without a configured secret it must still be stable across processes.
  const derivedOne = accountSecret({ DASHBOARD_PASSWORD: 'hunter2' });
  const derivedTwo = accountSecret({ DASHBOARD_PASSWORD: 'hunter2' });
  assert.equal(derivedOne, derivedTwo);
  assert.notEqual(derivedOne, accountSecret({ DASHBOARD_PASSWORD: 'other' }));
});

test('Scout accepts an account cookie as a member, never as the owner', async () => {
  const scout = await fs.readFile(new URL('../server-scout.mjs', import.meta.url), 'utf8');
  assert.match(scout, /accountBridgeSession/);
  assert.match(scout, /role: MEMBER, subject: `\$\{ACCOUNT_SUBJECT_PREFIX\}/);
  assert.doesNotMatch(scout, /role: OWNER, subject: `\$\{ACCOUNT_SUBJECT_PREFIX\}/);
  // The prefix must contain a character encodeSubject() strips, so a legacy
  // access code can never collide with an account's saved props.
  const { encodeSubject } = await import('../lib/session.mjs');
  assert.ok(!encodeSubject('acct:abc').includes(':'));
});

test('Google state is signed, expiring and single-purpose', () => {
  const state = issueState(SECRET);
  assert.ok(verifyState(state, SECRET));
  assert.ok(!verifyState(state, 'a-different-secret'), 'another secret must not verify');
  assert.ok(!verifyState(state, SECRET, { now: Date.now() + 11 * 60_000 }), 'an expired state must not verify');
  assert.ok(!verifyState(`${state}x`, SECRET), 'a tampered state must not verify');
});

test('the Google callback refuses a state that did not come from this browser', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  process.env.GOOGLE_REDIRECT_URI = 'https://example.test/api/account/google/callback';
  try {
    const state = issueState(SECRET);
    const res = fakeRes();
    // A validly signed state, but no matching cookie: this is the attack where
    // someone hands a victim a callback URL minted in the attacker's browser.
    const url = new URL(`https://example.test/api/account/google/callback?code=abc&state=${encodeURIComponent(state)}`);
    const handled = await handleGoogleRoutes(fakeReq(), res, url, { sessions, json, secret: SECRET });
    assert.equal(handled, true);
    assert.equal(res.statusCode, 302);
    assert.match(String(res.headers.location), /signin=expired/);
    assert.ok(!String(res.headers['set-cookie']).includes('sp_account='), 'no session may be issued');
  } finally {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REDIRECT_URI;
  }
});

test('Google start sets a state cookie that matches the URL it redirects to', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  process.env.GOOGLE_REDIRECT_URI = 'https://example.test/api/account/google/callback';
  try {
    const res = fakeRes();
    const url = new URL('https://example.test/api/account/google/start');
    assert.equal(await handleGoogleRoutes(fakeReq(), res, url, { sessions, json, secret: SECRET }), true);
    assert.equal(res.statusCode, 302);
    const cookie = String(res.headers['set-cookie']);
    assert.match(cookie, /^sp_oauth=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    const stateInCookie = decodeURIComponent(cookie.slice('sp_oauth='.length).split(';')[0]);
    assert.equal(new URL(res.headers.location).searchParams.get('state'), stateInCookie);
    // The secret must never travel to the browser.
    assert.ok(!res.headers.location.includes('test-secret'));
  } finally {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REDIRECT_URI;
  }
});

test('Google sign-in is reported as unavailable until it is configured', () => {
  delete process.env.GOOGLE_CLIENT_ID;
  const health = googleHealth();
  assert.equal(health.available, false);
  assert.ok(health.missing.includes('GOOGLE_CLIENT_ID'));
  // Readiness only: no key, id or address may appear in the public shape.
  assert.deepEqual(Object.keys(health).sort(), ['available', 'missing']);
});

test('a Google address links to the existing local account and verifies it', async () => {
  await store._reset();
  const { user } = await store.createUser({ email: 'linked@example.test', passwordHash: 'x', emailVerified: false });
  const linked = await linkGoogleAccount({ email: 'Linked@Example.test', log: { log() {} } });
  assert.equal(linked.user.id, user.id, 'must reuse the account, not create a second one');
  assert.equal(linked.user.emailVerified, true, 'Google proved the address');
  assert.equal(await store.countUsers(), 1);
});

test('a new Google account is created verified and cannot be signed into by password', async () => {
  await store._reset();
  const linked = await linkGoogleAccount({ email: 'fresh@example.test', log: { log() {} } });
  assert.equal(linked.user.emailVerified, true);
  assert.ok(linked.user.passwordHash, 'a random hash, so there is no password-shaped hole');
  const service = await import('../lib/auth/service.mjs');
  const attempt = await service.login({ email: 'fresh@example.test', password: '' }, { log: { warn() {} } });
  assert.equal(attempt.ok, false);
});

test('plan limits stop the call rather than merely describing it', () => {
  resetUsage();
  const limit = PLANS.free.predictionsPerDay;
  for (let i = 0; i < limit; i += 1) {
    assert.equal(consume({ subject: 'user:a', action: 'predict', limit }).allowed, true, `call ${i + 1} should be allowed`);
  }
  const blocked = consume({ subject: 'user:a', action: 'predict', limit });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  // A blocked retry must not push the user further from the reset.
  assert.equal(consume({ subject: 'user:a', action: 'predict', limit }).used, limit);
  // Another account is unaffected, and so is another action.
  assert.equal(consume({ subject: 'user:b', action: 'predict', limit }).allowed, true);
  assert.equal(consume({ subject: 'user:a', action: 'ask', limit: PLANS.free.askPerDay }).allowed, true);
});

test('usage buckets roll over at the UTC day boundary', () => {
  resetUsage();
  const day = Date.parse('2026-03-01T23:59:00Z');
  assert.equal(consume({ subject: 'user:c', action: 'predict', limit: 1, now: day }).allowed, true);
  assert.equal(consume({ subject: 'user:c', action: 'predict', limit: 1, now: day }).allowed, false);
  assert.equal(consume({ subject: 'user:c', action: 'predict', limit: 1, now: day + 2 * 60_000 }).allowed, true);
});

test('everyone resolves to free until a processor event grants otherwise', async () => {
  const anonymous = await entitlementFor(null);
  assert.equal(anonymous.plan.id, 'free');
  assert.equal(publicEntitlement(anonymous).signedIn, false);

  const unknown = await entitlementFor('nobody');
  assert.equal(unknown.plan.id, 'free');

  // A grant must name what authorised it, so no entitlement appears from nowhere.
  await assert.rejects(() => grantPlan({ accountId: 'u1', plan: 'pro' }), /source is required/i);
  await assert.rejects(() => grantPlan({ accountId: 'u1', plan: 'unlimited', source: 'stripe' }), /Unknown plan/i);
});

test('an expired subscription is a free account, with no grace period', async () => {
  await grantPlan({ accountId: 'u2', plan: 'pro', source: 'test', expiresAt: '2020-01-01T00:00:00.000Z' });
  const expired = await entitlementFor('u2');
  assert.equal(expired.plan.id, 'free');

  await grantPlan({ accountId: 'u3', plan: 'pro', source: 'test', expiresAt: '2099-01-01T00:00:00.000Z' });
  const live = await entitlementFor('u3');
  assert.equal(live.plan.id, 'pro');
  // The public shape must never leak how the entitlement was obtained.
  const shape = publicEntitlement(live);
  assert.ok(!('source' in shape) && !('reference' in shape));
});

test('the sign-in panel never claims a path that is not configured', async () => {
  const ui = await fs.readFile(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');
  // The Google button is rendered only behind the availability flag.
  assert.match(ui, /accountHealth\.google\.available\)return ''/);
  // And there is a plain explanation when neither path is switched on.
  assert.match(ui, /Sign-in is not switched on yet/);
});

test.after(async () => { await fs.rm(dataDir, { recursive: true, force: true }); });

test('ACCOUNT_OWNER_EMAIL decides who is owner, not who registers first', async () => {
  const { roleForNewAccount } = await import('../lib/auth/service.mjs');
  // Unset: a private install bootstraps its operator from the first account.
  delete process.env.ACCOUNT_OWNER_EMAIL;
  assert.equal(roleForNewAccount('anyone@example.test', 0), 'owner');
  assert.equal(roleForNewAccount('anyone@example.test', 1), 'member');

  // Set: a public sign-up page can no longer hand ownership to a stranger.
  process.env.ACCOUNT_OWNER_EMAIL = 'boss@example.test';
  try {
    assert.equal(roleForNewAccount('stranger@example.test', 0), 'member');
    assert.equal(roleForNewAccount('BOSS@Example.test', 7), 'owner');
  } finally {
    delete process.env.ACCOUNT_OWNER_EMAIL;
  }
});
