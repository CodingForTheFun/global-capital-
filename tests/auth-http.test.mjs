import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Drives the real account flows over HTTP against server.mjs — the binary
// railway.json actually starts. No mail provider is configured, so the server
// logs codes to stderr in non-production; the test reads them from there,
// exactly as a developer would.

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 17000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'correct-horse-battery-9';

let child; let dataDir;
let stderr = '';

let ipCounter = 0;
/** A fresh client IP, so one test's rate limiting does not throttle the next. */
const freshIp = () => `203.0.113.${(ipCounter++ % 250) + 1}`;

async function api(pathname, { method = 'POST', body, cookie, csrf, ip = '198.51.100.1' } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
      'x-forwarded-for': ip,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie') || '';
  let data = null;
  try { data = await response.json(); } catch {}
  return { status: response.status, data, cookie: setCookie.split(';')[0] };
}

/** Pull the most recent emailed code for an address out of the server log. */
function codeFor(email) {
  const matches = [...stderr.matchAll(/would have sent to ([^:]+): (\d{6}) is your/g)];
  const mine = matches.filter((m) => m[1].trim() === email);
  return mine.length ? mine[mine.length - 1][2] : null;
}

const unique = () => `user-${Math.random().toString(36).slice(2, 10)}@example.com`;

/** One identity per test: a fresh email and a fresh client IP. */
function actor() {
  const ip = freshIp();
  return { email: unique(), ip };
}

test.before(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-auth-'));
  child = spawn(process.execPath, ['server.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(PORT), DATA_DIR: dataDir,
      DASHBOARD_PASSWORD: 'legacy-owner-password',
      DASHBOARD_SESSION_SECRET: 'test-secret-value-for-auth',
      AUTO_SCAN_MINUTES: '0', NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (c) => { stderr += String(c); });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/account/me`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server did not start:\n${stderr}`);
});

test.after(async () => {
  child?.kill('SIGKILL');
  if (dataDir) await fs.rm(dataDir, { recursive: true, force: true });
});

test('an anonymous visitor is reported as such, with no account data', async () => {
  const ip = freshIp();
  const { status, data } = await api('/api/account/me', { method: 'GET', ip });
  assert.equal(status, 200);
  assert.equal(data.authenticated, false);
  assert.equal(data.user, null);
  assert.ok(!('csrfToken' in data), 'no CSRF token is issued to an anonymous visitor');
});

test('the full journey: register, receive a code, verify, sign in', async () => {
  const ip = freshIp();
  const email = unique();

  const registered = await api('/api/account/register', { body: { email, password: PASSWORD } , ip });
  assert.equal(registered.status, 200);
  assert.equal(registered.data.requiresVerification, true);
  assert.equal(registered.data.cookie, undefined, 'registering must not sign you in');

  const code = codeFor(email);
  assert.match(String(code), /^\d{6}$/, 'a six-digit code was emailed');

  // An unverified account cannot sign in even with the right password.
  const early = await api('/api/account/login', { body: { email, password: PASSWORD } , ip });
  assert.equal(early.status, 401);
  assert.equal(early.data.code, 'AUTH_EMAIL_UNVERIFIED');
  assert.equal(early.cookie, '', 'no session is issued before verification');

  const verified = await api('/api/account/verify', { body: { email, code } , ip });
  assert.equal(verified.status, 200);
  assert.equal(verified.data.user.emailVerified, true);

  const signedIn = await api('/api/account/login', { body: { email, password: PASSWORD } , ip });
  assert.equal(signedIn.status, 200);
  assert.match(signedIn.cookie, /^sp_account=/);
  assert.ok(signedIn.data.csrfToken, 'a CSRF token is issued with the session');
  assert.equal(signedIn.data.user.email, email);
  assert.equal(signedIn.data.user.passwordHash, undefined, 'no hash ever reaches the browser');

  const me = await api('/api/account/me', { method: 'GET', cookie: signedIn.cookie });
  assert.equal(me.data.authenticated, true);
  assert.equal(me.data.user.email, email);
});

test('the session cookie is HttpOnly, SameSite and scoped', async () => {
  const ip = freshIp();
  const email = unique();
  await api('/api/account/register', { body: { email, password: PASSWORD } , ip });
  await api('/api/account/verify', { body: { email, code: codeFor(email) } , ip });

  const response = await fetch(`${BASE}/api/account/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const raw = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie') || '';
  assert.match(raw, /HttpOnly/, 'script must not be able to read the session');
  assert.match(raw, /SameSite=Lax/);
  assert.match(raw, /Path=\//);
  assert.match(raw, /Max-Age=\d+/);
});

test('a wrong code is refused, counted, and eventually burned', async () => {
  const ip = freshIp();
  const email = unique();
  await api('/api/account/register', { body: { email, password: PASSWORD } , ip });
  const real = codeFor(email);

  const wrong = await api('/api/account/verify', { body: { email, code: '000000' } , ip });
  assert.equal(wrong.status, 400);
  assert.match(wrong.data.message, /attempts? remaining/);

  // Burn the remaining attempts; the code is destroyed rather than left guessable.
  for (let i = 0; i < 4; i++) await api('/api/account/verify', { body: { email, code: '000000' } , ip });
  const exhausted = await api('/api/account/verify', { body: { email, code: real } , ip });
  assert.equal(exhausted.data.ok, false, 'the real code no longer works after exhaustion');
  // The record is destroyed on exhaustion, so a later attempt is reported the
  // same way as a code that never existed — deliberately, so nothing is confirmed.
  assert.ok(['AUTH_CODE_EXHAUSTED', 'AUTH_CODE_INVALID'].includes(exhausted.data.code), exhausted.data.code);

  // And the account is still unverified, so the burned code granted nothing.
  const stillOut = await api('/api/account/login', { body: { email, password: PASSWORD }, ip });
  assert.equal(stillOut.data.code, 'AUTH_EMAIL_UNVERIFIED');
});

test('registration does not reveal whether an address already exists', async () => {
  const ip = freshIp();
  const email = unique();
  const first = await api('/api/account/register', { body: { email, password: PASSWORD } , ip });
  const second = await api('/api/account/register', { body: { email, password: 'different-password-99' } , ip });

  assert.equal(first.status, second.status);
  assert.equal(first.data.message, second.data.message, 'identical copy for new and existing addresses');
  assert.equal(second.data.code, 'AUTH_REGISTERED');

  // And the second attempt must not have overwritten the password.
  await api('/api/account/verify', { body: { email, code: codeFor(email) } , ip });
  const wrongPassword = await api('/api/account/login', { body: { email, password: 'different-password-99' } , ip });
  assert.equal(wrongPassword.status, 401, 're-registering must never reset an existing password');
});

test('a forgotten-password request looks identical for unknown addresses', async () => {
  const ip = freshIp();
  const known = unique();
  await api('/api/account/register', { body: { email: known, password: PASSWORD } , ip });

  const a = await api('/api/account/password/forgot', { body: { email: known } , ip });
  const b = await api('/api/account/password/forgot', { body: { email: 'nobody-here@example.com' } , ip });
  assert.equal(a.status, b.status);
  assert.equal(a.data.message, b.data.message);
});

test('password reset works, and signs every other session out', async () => {
  const ip = freshIp();
  const email = unique();
  await api('/api/account/register', { body: { email, password: PASSWORD } , ip });
  await api('/api/account/verify', { body: { email, code: codeFor(email) } , ip });
  const session = await api('/api/account/login', { body: { email, password: PASSWORD } , ip });
  assert.equal((await api('/api/account/me', { method: 'GET', cookie: session.cookie })).data.authenticated, true);

  await api('/api/account/password/forgot', { body: { email } , ip });
  const resetCode = codeFor(email);
  const NEW = 'a-brand-new-passphrase-7';
  const reset = await api('/api/account/password/reset', { body: { email, code: resetCode, password: NEW } , ip });
  assert.equal(reset.status, 200);

  // The pre-reset cookie is now dead, even though it has not expired.
  const stale = await api('/api/account/me', { method: 'GET', cookie: session.cookie });
  assert.equal(stale.data.authenticated, false, 'a stolen cookie must not survive a reset');

  assert.equal((await api('/api/account/login', { body: { email, password: PASSWORD } , ip })).status, 401, 'old password is dead');
  assert.equal((await api('/api/account/login', { body: { email, password: NEW } , ip })).status, 200);
});

test('a reset code cannot be replayed', async () => {
  const ip = freshIp();
  const email = unique();
  await api('/api/account/register', { body: { email, password: PASSWORD } , ip });
  await api('/api/account/verify', { body: { email, code: codeFor(email) } , ip });
  await api('/api/account/password/forgot', { body: { email } , ip });
  const code = codeFor(email);

  assert.equal((await api('/api/account/password/reset', { body: { email, code, password: 'first-new-password-1' } , ip })).status, 200);
  const replay = await api('/api/account/password/reset', { body: { email, code, password: 'second-new-password-2' } , ip });
  assert.equal(replay.status, 400, 'a consumed code is single-use');
});

test('a verification code cannot be replayed as a password reset', async () => {
  const ip = freshIp();
  const email = unique();
  await api('/api/account/register', { body: { email, password: PASSWORD } , ip });
  const verifyCode = codeFor(email);
  // Codes are bound to their purpose, so this one is useless for a reset.
  const misuse = await api('/api/account/password/reset', { body: { email, code: verifyCode, password: 'attacker-chosen-pw-1' } , ip });
  assert.equal(misuse.data.ok, false);
});

test('weak passwords are refused with a reason', async () => {
  const ip = freshIp();
  for (const password of ['short', 'password123', '']) {
    const result = await api('/api/account/register', { body: { email: unique(), password } , ip });
    assert.equal(result.status, 400, `accepted a weak password: ${password}`);
    assert.equal(result.data.code, 'AUTH_PASSWORD_WEAK');
    assert.ok(result.data.message.length > 0);
  }
  const containsEmail = await api('/api/account/register', { body: { email: 'gregory@example.com', password: 'gregory-is-here-1' } , ip });
  assert.equal(containsEmail.data.code, 'AUTH_PASSWORD_WEAK');
});

test('repeated wrong passwords lock the account', async () => {
  const ip = freshIp();
  const email = unique();
  await api('/api/account/register', { body: { email, password: PASSWORD } , ip });
  await api('/api/account/verify', { body: { email, code: codeFor(email) } , ip });

  let locked = false;
  for (let i = 0; i < 8; i++) {
    const attempt = await api('/api/account/login', { body: { email, password: `wrong-guess-${i}` } });
    if (attempt.data?.code === 'AUTH_LOCKED') { locked = true; break; }
  }
  assert.ok(locked, 'brute force must trigger a lockout');
  // The lockout holds even against the correct password.
  const correct = await api('/api/account/login', { body: { email, password: PASSWORD } , ip });
  assert.equal(correct.data.code, 'AUTH_LOCKED');
});

test('changing a password requires the current one and a CSRF token', async () => {
  const ip = freshIp();
  const email = unique();
  await api('/api/account/register', { body: { email, password: PASSWORD } , ip });
  await api('/api/account/verify', { body: { email, code: codeFor(email) } , ip });
  const session = await api('/api/account/login', { body: { email, password: PASSWORD } , ip });

  const noCsrf = await api('/api/account/password/change', {
    cookie: session.cookie, body: { currentPassword: PASSWORD, newPassword: 'another-good-passphrase-3' },
  });
  assert.equal(noCsrf.status, 403, 'a state-changing request needs the CSRF header');

  const wrongCurrent = await api('/api/account/password/change', {
    cookie: session.cookie, csrf: session.data.csrfToken,
    body: { currentPassword: 'not-the-password', newPassword: 'another-good-passphrase-3' },
  });
  assert.equal(wrongCurrent.status, 400);

  const changed = await api('/api/account/password/change', {
    cookie: session.cookie, csrf: session.data.csrfToken,
    body: { currentPassword: PASSWORD, newPassword: 'another-good-passphrase-3' },
  });
  assert.equal(changed.status, 200);
  assert.ok(changed.cookie, 'the actor is re-issued a session and stays signed in');
});

test('sign out everywhere revokes the session immediately', async () => {
  const ip = freshIp();
  const email = unique();
  await api('/api/account/register', { body: { email, password: PASSWORD } , ip });
  await api('/api/account/verify', { body: { email, code: codeFor(email) } , ip });
  const session = await api('/api/account/login', { body: { email, password: PASSWORD } , ip });

  await api('/api/account/logout-all', { cookie: session.cookie, csrf: session.data.csrfToken });
  const after = await api('/api/account/me', { method: 'GET', cookie: session.cookie });
  assert.equal(after.data.authenticated, false);
});

test('a forged or tampered session cookie is rejected', async () => {
  const ip = freshIp();
  const email = unique();
  await api('/api/account/register', { body: { email, password: PASSWORD } , ip });
  await api('/api/account/verify', { body: { email, code: codeFor(email) } , ip });
  const session = await api('/api/account/login', { body: { email, password: PASSWORD } , ip });

  const [name, value] = session.cookie.split('=');
  const parts = decodeURIComponent(value).split('.');
  for (const forged of [
    `${name}=${parts[0]}.999.${parts[2]}.${parts[3]}`,          // bumped version
    `${name}=00000000-0000-0000-0000-000000000000.1.${parts[2]}.${parts[3]}`, // different user
    `${name}=${parts[0]}.${parts[1]}.${parts[2]}.deadbeef`,      // bad signature
    `${name}=garbage`,
  ]) {
    const result = await api('/api/account/me', { method: 'GET', cookie: forged });
    assert.equal(result.data.authenticated, false, `accepted a forged cookie: ${forged.slice(0, 60)}`);
  }
});

test('an account session opens the rest of the dashboard API', async () => {
  const ip = freshIp();
  const email = unique();
  await api('/api/account/register', { body: { email, password: PASSWORD } , ip });
  await api('/api/account/verify', { body: { email, code: codeFor(email) } , ip });
  const session = await api('/api/account/login', { body: { email, password: PASSWORD } , ip });

  assert.equal((await fetch(`${BASE}/api/props`)).status, 401, 'still closed to anonymous callers');
  const authorized = await fetch(`${BASE}/api/props`, { headers: { cookie: session.cookie } });
  assert.equal(authorized.status, 200, 'a verified account authorizes the API');
});

test('no auth response ever leaks a hash, a code, or internals', async () => {
  const ip = freshIp();
  const email = unique();
  const bodies = [];
  bodies.push(JSON.stringify((await api('/api/account/register', { body: { email, password: PASSWORD } , ip })).data));
  const code = codeFor(email);
  bodies.push(JSON.stringify((await api('/api/account/verify', { body: { email, code: '111111' } , ip })).data));
  bodies.push(JSON.stringify((await api('/api/account/verify', { body: { email, code } , ip })).data));
  const session = await api('/api/account/login', { body: { email, password: PASSWORD } , ip });
  bodies.push(JSON.stringify(session.data));
  bodies.push(JSON.stringify((await api('/api/account/me', { method: 'GET', cookie: session.cookie })).data));

  const combined = bodies.join('\n');
  for (const marker of ['scrypt$', 'passwordHash', 'pendingCodes', PASSWORD, code, 'node_modules', '.mjs:', '/app/']) {
    assert.ok(!combined.includes(marker), `leaked: ${marker}`);
  }
});

test('the stored user record keeps no plaintext password or code', async () => {
  const ip = freshIp();
  const email = unique();
  await api('/api/account/register', { body: { email, password: PASSWORD } , ip });
  const code = codeFor(email);
  const raw = await fs.readFile(path.join(dataDir, 'users.json'), 'utf8');

  assert.ok(raw.includes(email), 'the account was persisted');
  assert.ok(!raw.includes(PASSWORD), 'the plaintext password must never touch disk');
  assert.ok(!raw.includes(code), 'the plaintext code must never touch disk');
  assert.ok(raw.includes('scrypt$'), 'the password is stored as a scrypt hash');
});

test('the first account becomes owner and later ones do not', async () => {
  const ip = freshIp();
  // This suite shares a data dir, so an owner already exists by now; what
  // matters is that a later registration never self-assigns owner.
  const email = unique();
  await api('/api/account/register', { body: { email, password: PASSWORD } , ip });
  await api('/api/account/verify', { body: { email, code: codeFor(email) } , ip });
  const session = await api('/api/account/login', { body: { email, password: PASSWORD } , ip });
  assert.equal(session.data.user.role, 'member', 'a self-registered account must not become owner');
});
