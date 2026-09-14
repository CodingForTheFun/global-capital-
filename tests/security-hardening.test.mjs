import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { accountSecret } from '../lib/auth/secret.mjs';
import { accountCookie } from '../lib/auth/session.mjs';
import { cookieHeader } from '../lib/session.mjs';
import { SECURITY_HEADERS } from '../lib/web/public-surface.mjs';

function withEnv(patch, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { return fn(); }
  finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('hosted production refuses to start with a public fallback account secret', () => {
  assert.throws(() => accountSecret({ NODE_ENV: 'production' }), (error) => error?.code === 'AUTH_SECRET_REQUIRED');
  assert.throws(() => accountSecret({ RAILWAY_PROJECT_ID: 'project' }), (error) => error?.code === 'AUTH_SECRET_REQUIRED');
});

test('configured account secrets win and local development remains usable', () => {
  assert.equal(accountSecret({ DASHBOARD_SESSION_SECRET: 'configured-secret' }), 'configured-secret');
  const derived = accountSecret({ DASHBOARD_PASSWORD: 'owner-password' });
  assert.match(derived, /^[0-9a-f]{64}$/);
  assert.equal(accountSecret({}), accountSecret({}), 'local fallback is stable for local-only development');
});

test('hosted cookies stay HttpOnly and Secure even if a proxy omits forwarded proto', () => {
  withEnv({ NODE_ENV: 'production', RAILWAY_PROJECT_ID: undefined }, () => {
    const req = { headers: {} };
    for (const value of [accountCookie(req, 'account-token'), cookieHeader(req, 'legacy-token')]) {
      assert.match(value, /HttpOnly/);
      assert.match(value, /Secure/);
      assert.match(value, /Priority=High/);
    }
  });
});

test('public responses use a restrictive same-origin browser policy', () => {
  const csp = SECURITY_HEADERS['content-security-policy'];
  for (const expected of [
    "default-src 'self'", "script-src 'self' 'unsafe-inline'", "connect-src 'self'",
    "frame-src 'none'", "frame-ancestors 'none'", "object-src 'none'",
    "base-uri 'self'", "form-action 'self'", 'upgrade-insecure-requests',
  ]) assert.match(csp, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(SECURITY_HEADERS['x-frame-options'], 'DENY');
  assert.equal(SECURITY_HEADERS['x-permitted-cross-domain-policies'], 'none');
});

test('no static bootstrap access credential remains in the access-code module', async () => {
  const source = await fs.readFile(new URL('../access-codes.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /friend-20260908/);
  assert.doesNotMatch(source, /bootstrapDigest/);
  assert.match(source, /Ignore any legacy bootstrap row left on disk/);
});
