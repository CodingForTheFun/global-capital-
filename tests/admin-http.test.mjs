import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Owner-only administration and the live presence panel, driven over HTTP
// against server.mjs. The first account to register becomes owner, so this
// suite creates that account first and a member second.

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 19000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'correct-horse-battery-9';

let child; let dataDir; let stderr = '';
let owner; let member;
let ipCounter = 0;
const freshIp = () => `203.0.113.${(ipCounter++ % 250) + 1}`;

async function api(pathname, { method = 'POST', body, cookie, csrf, ip = '198.51.100.9', agent } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
      ...(agent ? { 'user-agent': agent } : {}),
      'x-forwarded-for': ip,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie') || '';
  let data = null;
  try { data = await response.json(); } catch {}
  return { status: response.status, data, cookie: setCookie.split(';')[0] };
}

function codeFor(email) {
  const matches = [...stderr.matchAll(/would have sent to ([^:]+): (\d{6}) is your/g)];
  const mine = matches.filter((m) => m[1].trim() === email);
  return mine.length ? mine[mine.length - 1][2] : null;
}

/** Register, verify and sign in, returning the live session. */
async function makeAccount(agent = 'Mozilla/5.0 (Macintosh) Chrome/120') {
  const ip = freshIp();
  const email = `u-${Math.random().toString(36).slice(2, 10)}@example.com`;
  await api('/api/account/register', { body: { email, password: PASSWORD }, ip });
  await api('/api/account/verify', { body: { email, code: codeFor(email) }, ip });
  const session = await api('/api/account/login', { body: { email, password: PASSWORD }, ip, agent });
  return { email, ip, cookie: session.cookie, csrf: session.data.csrfToken, user: session.data.user, data: session.data };
}

test.before(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-admin-'));
  child = spawn(process.execPath, ['server.mjs'], {
    cwd: root,
    env: {
      ...process.env, PORT: String(PORT), DATA_DIR: dataDir,
      DASHBOARD_PASSWORD: 'legacy-owner-password',
      DASHBOARD_SESSION_SECRET: 'test-secret-admin', AUTO_SCAN_MINUTES: '0', NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (c) => { stderr += String(c); });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/account/me`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  owner = await makeAccount('Mozilla/5.0 (Macintosh) Chrome/120');
  member = await makeAccount('Mozilla/5.0 (iPhone) Safari/17');
});

test.after(async () => {
  child?.kill('SIGKILL');
  if (dataDir) await fs.rm(dataDir, { recursive: true, force: true });
});

test('the first account is owner and later ones are members', () => {
  assert.equal(owner.user.role, 'owner');
  assert.equal(member.user.role, 'member');
});

test('an owner gets extra capabilities and extra tabs', async () => {
  const asOwner = await api('/api/account/me', { method: 'GET', cookie: owner.cookie, ip: owner.ip });
  const asMember = await api('/api/account/me', { method: 'GET', cookie: member.cookie, ip: member.ip });

  for (const capability of ['viewMembers', 'viewPresence', 'revokeSessions', 'manageConnection', 'runScan']) {
    assert.equal(asOwner.data.capabilities[capability], true, `owner should have ${capability}`);
    assert.equal(asMember.data.capabilities[capability], false, `member must NOT have ${capability}`);
  }
  // Both can use the product itself.
  assert.equal(asMember.data.capabilities.viewProps, true);

  const ownerTabs = asOwner.data.nav.map((t) => t.id);
  const memberTabs = asMember.data.nav.map((t) => t.id);
  for (const tab of ['members', 'presence', 'providers']) {
    assert.ok(ownerTabs.includes(tab), `owner should see the ${tab} tab`);
    assert.ok(!memberTabs.includes(tab), `member must not see the ${tab} tab`);
  }
  assert.ok(memberTabs.includes('props'), 'a member still sees the product tabs');
  assert.ok(ownerTabs.length > memberTabs.length);
});

test('every admin route refuses a member and an anonymous visitor', async () => {
  const routes = [
    ['GET', '/api/admin/overview'], ['GET', '/api/admin/members'], ['GET', '/api/admin/presence'],
    ['POST', '/api/admin/session/revoke'], ['POST', '/api/admin/member/disable'], ['POST', '/api/admin/member/role'],
  ];
  for (const [method, route] of routes) {
    const anon = await api(route, { method, body: method === 'POST' ? {} : undefined });
    assert.equal(anon.status, 401, `${route} must refuse anonymous`);

    const asMember = await api(route, {
      method, cookie: member.cookie, csrf: member.csrf, ip: member.ip,
      body: method === 'POST' ? {} : undefined,
    });
    assert.equal(asMember.status, 403, `${route} must refuse a member`);
    assert.equal(asMember.data.code, 'OWNER_REQUIRED');
  }
});

test('the presence panel shows who is signed in, and on what', async () => {
  const { status, data } = await api('/api/admin/presence', { method: 'GET', cookie: owner.cookie, ip: owner.ip });
  assert.equal(status, 200);
  assert.ok(data.sessions.length >= 2, 'both accounts have a live session');

  const memberSession = data.sessions.find((s) => s.email === member.email);
  assert.ok(memberSession, 'the member appears in the panel');
  assert.equal(memberSession.presence, 'ONLINE');
  assert.match(memberSession.device, /Safari on iOS/, 'the device is described from the user agent');
  assert.ok(memberSession.lastSeenAt);

  const ownerSession = data.sessions.find((s) => s.email === owner.email);
  assert.match(ownerSession.device, /Chrome on macOS/);
});

test('the panel masks IP addresses rather than exposing them', async () => {
  const { data } = await api('/api/admin/presence', { method: 'GET', cookie: owner.cookie, ip: owner.ip });
  for (const session of data.sessions) {
    if (!session.ip) continue;
    assert.match(session.ip, /\.x$|:…$/, `IP should be masked, got ${session.ip}`);
    assert.ok(!/^\d+\.\d+\.\d+\.\d+$/.test(session.ip), 'a full IPv4 address must not be exposed');
  }
});

test('the overview counts online, verified and disabled accounts', async () => {
  const { status, data } = await api('/api/admin/overview', { method: 'GET', cookie: owner.cookie, ip: owner.ip });
  assert.equal(status, 200);
  assert.ok(data.counts.total >= 2);
  assert.ok(data.counts.online >= 2, 'both are currently online');
  assert.equal(data.counts.owners, 1);
  assert.equal(data.counts.disabled, 0);
  assert.ok(data.windows.onlineMs > 0, 'the client is told the thresholds it should label with');
});

test('members list merges accounts with their live devices', async () => {
  const { data } = await api('/api/admin/members', { method: 'GET', cookie: owner.cookie, ip: owner.ip });
  const row = data.members.find((m) => m.email === member.email);
  assert.ok(row);
  assert.equal(row.presence, 'ONLINE');
  assert.equal(row.activeSessions, 1);
  assert.equal(row.devices.length, 1);
  assert.equal(row.passwordHash, undefined, 'no hash reaches the panel');
  assert.equal(row.pendingCodes, undefined);
});

test('the owner can sign out one device without touching the others', async () => {
  // Give the member a second device.
  const second = await api('/api/account/login', {
    body: { email: member.email, password: PASSWORD }, ip: freshIp(), agent: 'Mozilla/5.0 (Windows) Firefox/121',
  });
  assert.equal(second.status, 200);

  const before = await api('/api/admin/presence', { method: 'GET', cookie: owner.cookie, ip: owner.ip });
  const devices = before.data.sessions.filter((s) => s.email === member.email);
  assert.equal(devices.length, 2, 'the member now has two live devices');

  const firefox = devices.find((s) => /Firefox/.test(s.device));
  const revoked = await api('/api/admin/session/revoke', {
    cookie: owner.cookie, csrf: owner.csrf, ip: owner.ip, body: { sessionId: firefox.id },
  });
  assert.equal(revoked.status, 200);
  assert.equal(revoked.data.revoked, true);

  // The revoked device is dead immediately; the original one still works.
  const dead = await api('/api/account/me', { method: 'GET', cookie: second.cookie, ip: member.ip });
  assert.equal(dead.data.authenticated, false, 'the revoked device is signed out at once');
  const survivor = await api('/api/account/me', { method: 'GET', cookie: member.cookie, ip: member.ip });
  assert.equal(survivor.data.authenticated, true, 'their other device is untouched');
});

test('revoking requires a CSRF token even for the owner', async () => {
  const noCsrf = await api('/api/admin/session/revoke', {
    cookie: owner.cookie, ip: owner.ip, body: { sessionId: 'anything' },
  });
  assert.equal(noCsrf.status, 403);
  assert.equal(noCsrf.data.code, 'CSRF_INVALID');
});

test('disabling an account signs it out everywhere and blocks sign-in', async () => {
  const victim = await makeAccount();
  assert.equal((await api('/api/account/me', { method: 'GET', cookie: victim.cookie, ip: victim.ip })).data.authenticated, true);

  const disabled = await api('/api/admin/member/disable', {
    cookie: owner.cookie, csrf: owner.csrf, ip: owner.ip, body: { userId: victim.user.id, disabled: true },
  });
  assert.equal(disabled.status, 200);

  const evicted = await api('/api/account/me', { method: 'GET', cookie: victim.cookie, ip: victim.ip });
  assert.equal(evicted.data.authenticated, false, 'a disabled account is evicted at once');

  const blocked = await api('/api/account/login', { body: { email: victim.email, password: PASSWORD }, ip: victim.ip });
  assert.equal(blocked.status, 401, 'and cannot sign back in');

  // Re-enabling restores the ability to sign in.
  await api('/api/admin/member/disable', {
    cookie: owner.cookie, csrf: owner.csrf, ip: owner.ip, body: { userId: victim.user.id, disabled: false },
  });
  assert.equal((await api('/api/account/login', { body: { email: victim.email, password: PASSWORD }, ip: freshIp() })).status, 200);
});

test('an owner cannot disable themselves or strand the account with no owner', async () => {
  const self = await api('/api/admin/member/disable', {
    cookie: owner.cookie, csrf: owner.csrf, ip: owner.ip, body: { userId: owner.user.id, disabled: true },
  });
  assert.equal(self.status, 400);
  assert.equal(self.data.code, 'SELF_DISABLE');

  const demote = await api('/api/admin/member/role', {
    cookie: owner.cookie, csrf: owner.csrf, ip: owner.ip, body: { userId: owner.user.id, role: 'member' },
  });
  assert.equal(demote.status, 400);
  assert.equal(demote.data.code, 'LAST_OWNER', 'the last owner cannot demote themselves');
});

test('promoting a member grants owner capabilities after they sign back in', async () => {
  const promoted = await makeAccount();
  assert.equal(promoted.user.role, 'member');

  const result = await api('/api/admin/member/role', {
    cookie: owner.cookie, csrf: owner.csrf, ip: owner.ip, body: { userId: promoted.user.id, role: 'owner' },
  });
  assert.equal(result.status, 200);

  // A role change revokes their sessions, so the old cookie is dead.
  const stale = await api('/api/account/me', { method: 'GET', cookie: promoted.cookie, ip: promoted.ip });
  assert.equal(stale.data.authenticated, false, 'a role change forces a fresh session');

  const again = await api('/api/account/login', { body: { email: promoted.email, password: PASSWORD }, ip: freshIp() });
  assert.equal(again.data.user.role, 'owner');
  assert.equal(again.data.capabilities.viewPresence, true);
  assert.ok(again.data.nav.map((t) => t.id).includes('presence'));
});

test('signing out removes the device from the presence panel', async () => {
  const temp = await makeAccount();
  const before = await api('/api/admin/presence', { method: 'GET', cookie: owner.cookie, ip: owner.ip });
  assert.ok(before.data.sessions.some((s) => s.email === temp.email));

  await api('/api/account/logout', { cookie: temp.cookie, ip: temp.ip });

  const after = await api('/api/admin/presence', { method: 'GET', cookie: owner.cookie, ip: owner.ip });
  assert.ok(!after.data.sessions.some((s) => s.email === temp.email), 'the device left the panel');
});

test('a user sees their own devices but never anyone else’s', async () => {
  const me = await api('/api/account/me', { method: 'GET', cookie: member.cookie, ip: member.ip });
  assert.ok(Array.isArray(me.data.devices));
  assert.ok(me.data.devices.length >= 1, 'they can review their own sessions');
  // Every device listed belongs to them.
  const presence = await api('/api/admin/presence', { method: 'GET', cookie: owner.cookie, ip: owner.ip });
  const mine = new Set(presence.data.sessions.filter((s) => s.email === member.email).map((s) => s.id));
  for (const device of me.data.devices) {
    assert.ok(mine.has(device.id), 'a member must only ever see their own sessions');
  }
});

test('no admin response leaks hashes, codes or internals', async () => {
  const bodies = [];
  for (const route of ['/api/admin/overview', '/api/admin/members', '/api/admin/presence']) {
    bodies.push(JSON.stringify((await api(route, { method: 'GET', cookie: owner.cookie, ip: owner.ip })).data));
  }
  const combined = bodies.join('\n');
  for (const marker of ['scrypt$', 'passwordHash', 'pendingCodes', PASSWORD, 'node_modules', '.mjs:', '/app/']) {
    assert.ok(!combined.includes(marker), `leaked: ${marker}`);
  }
});
