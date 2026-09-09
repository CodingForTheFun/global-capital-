import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Boots the real server and drives it over HTTP, so the owner/member boundary is
// verified as deployed rather than through a stubbed handler.

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OWNER_PASSWORD = 'test-owner-password-not-a-real-secret';
const PORT = 3000 + Math.floor(Math.random() * 4000);
const BASE = `http://127.0.0.1:${PORT}`;

let child;
let dataDir;
const stderr = [];

async function waitForServer(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/api/auth/status`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`server did not start:\n${stderr.join('')}`);
}

test.before(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoprop-http-'));
  child = spawn(process.execPath, ['server-professional.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: dataDir,
      DASHBOARD_PASSWORD: OWNER_PASSWORD,
      DASHBOARD_SESSION_SECRET: 'test-session-secret-value',
      AUTO_SCAN_MINUTES: '0',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)));
  await waitForServer();
});

test.after(async () => {
  child?.kill('SIGKILL');
  if (dataDir) await fs.rm(dataDir, { recursive: true, force: true });
});

function cookieFrom(response) {
  const header = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie') || '';
  return header.split(';')[0];
}

async function call(pathname, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await response.json(); } catch {}
  return { status: response.status, data, response };
}

async function loginAs(credential) {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: credential }),
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data, cookie: cookieFrom(response) };
}

const OWNER_ONLY = [
  ['GET', '/api/access-codes'],
  ['POST', '/api/access-codes/generate'],
  ['POST', '/api/access-codes/revoke'],
  ['POST', '/api/connect'],
  ['POST', '/api/disconnect'],
  ['PUT', '/api/rules'],
];

test('every API route is closed to unauthenticated callers', async () => {
  for (const pathname of ['/api/status', '/api/history', '/api/rules', '/api/access-codes', '/api/scan']) {
    const { status, data } = await call(pathname);
    assert.equal(status, 401, `${pathname} should require auth`);
    assert.equal(data.authRequired, true);
  }
});

test('the owner password unlocks a session with full permissions', async () => {
  const { status, data, cookie } = await loginAs(OWNER_PASSWORD);
  assert.equal(status, 200);
  assert.equal(data.role, 'owner');
  assert.equal(data.canGenerateAccessCodes, true);
  assert.equal(data.canManageConnection, true);
  assert.equal(data.canChangeRules, true);
  assert.match(cookie, /^aps_session=/);

  const status2 = await call('/api/auth/status', { cookie });
  assert.equal(status2.data.role, 'owner');
  assert.equal(status2.data.canAdministerOwner, true);
});

test('a wrong password is refused and says nothing about which credential failed', async () => {
  const { status, data } = await loginAs('definitely-not-the-password');
  assert.equal(status, 401);
  assert.equal(data.message, 'Incorrect dashboard password or access code.');
});

test('owner generates a code; the member unlocks with it and gets no owner authority', async () => {
  const owner = await loginAs(OWNER_PASSWORD);
  const generated = await call('/api/access-codes/generate', {
    cookie: owner.cookie,
    method: 'POST',
    body: { label: 'Friend access', expiresInDays: 30, maxUses: 5 },
  });
  assert.equal(generated.status, 200);
  assert.match(generated.data.code, /^AP-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  const member = await loginAs(generated.data.code);
  assert.equal(member.status, 200);
  assert.equal(member.data.role, 'member');
  assert.equal(member.data.canGenerateAccessCodes, false);
  assert.equal(member.data.canManageConnection, false);
  assert.equal(member.data.canChangeRules, false);
  assert.equal(member.data.canAdministerOwner, false);

  // The member can still use the dashboard it was invited to.
  const dashboard = await call('/api/status', { cookie: member.cookie });
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.data.running, false);

  // ...but every owner-only route refuses it.
  for (const [method, pathname] of OWNER_ONLY) {
    const result = await call(pathname, { cookie: member.cookie, method, body: method === 'GET' ? undefined : {} });
    assert.equal(result.status, 403, `${method} ${pathname} must be owner-only (got ${result.status})`);
    assert.match(result.data.message, /owner access is required/i);
  }
});

test('the member listing never exposes a code, a hash, or the owner password', async () => {
  const owner = await loginAs(OWNER_PASSWORD);
  const generated = await call('/api/access-codes/generate', {
    cookie: owner.cookie, method: 'POST', body: { label: 'Audit' },
  });
  const listing = await call('/api/access-codes', { cookie: owner.cookie });
  assert.equal(listing.status, 200);

  const serialised = JSON.stringify(listing.data);
  assert.ok(!serialised.includes(generated.data.code), 'the generated code must appear only in its own response');
  assert.ok(!serialised.includes(OWNER_PASSWORD));
  assert.ok(!/codeHash|"salt"|PEPPER/.test(serialised), 'no hash material may cross the API');
  assert.ok(listing.data.codes.every((row) => row.hint?.startsWith('••••')));
});

test('revoking a code ends an already-open member session immediately', async () => {
  const owner = await loginAs(OWNER_PASSWORD);
  const generated = await call('/api/access-codes/generate', {
    cookie: owner.cookie, method: 'POST', body: { label: 'Revoke me', maxUses: 5 },
  });
  const member = await loginAs(generated.data.code);
  assert.equal((await call('/api/status', { cookie: member.cookie })).status, 200);

  const revoked = await call('/api/access-codes/revoke', {
    cookie: owner.cookie, method: 'POST', body: { id: generated.data.id },
  });
  assert.equal(revoked.status, 200);
  assert.equal(revoked.data.code.active, false);

  // The 30-day cookie is still cryptographically valid — the code behind it is not.
  const after = await call('/api/status', { cookie: member.cookie });
  assert.equal(after.status, 401, 'the revoked member session must be rejected');

  // And the code cannot be redeemed again.
  assert.equal((await loginAs(generated.data.code)).status, 401);
});

test('no API response leaks internals, stack traces or automation detail', async () => {
  const owner = await loginAs(OWNER_PASSWORD);
  const bodies = [];
  for (const pathname of ['/api/status', '/api/history', '/api/rules', '/api/access-codes', '/api/auth/status']) {
    bodies.push(JSON.stringify((await call(pathname, { cookie: owner.cookie })).data));
  }
  // Malformed input must not produce a parser error message either.
  const bad = await fetch(`${BASE}/api/rules`, {
    method: 'PUT',
    headers: { cookie: owner.cookie, 'content-type': 'application/json' },
    body: '{not valid json',
  });
  bodies.push(JSON.stringify(await bad.json().catch(() => ({}))));

  const combined = bodies.join('\n');
  for (const marker of ['locator.', 'Call log', 'cl-modalBackdrop', 'intercepts pointer events', 'playwright', 'node_modules', '.mjs:', '/app/', 'at Object.', 'ECONNREFUSED', 'JSON.parse']) {
    assert.ok(!combined.includes(marker), `leaked internal marker: ${marker}`);
  }
});

test('login is rate limited so codes and the owner password cannot be ground down', async () => {
  let sawLimit = false;
  for (let attempt = 0; attempt < 15; attempt++) {
    const { status } = await loginAs('AP-ZZZZ-ZZZZ-ZZZZ');
    if (status === 429) { sawLimit = true; break; }
  }
  assert.ok(sawLimit, 'repeated unlock attempts must be throttled');

  // The throttle applies to the owner password too, not just codes.
  const owner = await loginAs(OWNER_PASSWORD);
  assert.equal(owner.status, 429);
});
