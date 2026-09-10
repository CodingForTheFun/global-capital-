import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

// Isolate the encrypted master key so tests never touch a real data directory.
process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'autoprop-test-'));
process.env.MAIL_PROVIDER = 'console';

const {
  hashPassword, verifyPassword, needsRehash, checkPasswordPolicy, passwordScore, MIN_PASSWORD_LENGTH,
} = await import('../auth/passwords.mjs');
const { sealSession, openSession, deviceFingerprint } = await import('../auth/session.mjs');
const { isValidEmail, normalizeEmail, maskEmailAddress, publicUser, ROLES } = await import('../auth/identity.mjs');
const { mailerConfig } = await import('../auth/mailer.mjs');
const { verificationEmail, passwordResetEmail } = await import('../auth/templates.mjs');
const { supabaseConfig } = await import('../db/supabase.mjs');

test('password hashing round-trips and rejects the wrong password', async () => {
  const hash = await hashPassword('Correct-Horse-9482');
  assert.match(hash, /^scrypt\$\d+\$\d+\$\d+\$/);
  assert.equal(await verifyPassword('Correct-Horse-9482', hash), true);
  assert.equal(await verifyPassword('correct-horse-9482', hash), false);
  assert.equal(await verifyPassword('', hash), false);
});

test('password hashes are salted, so equal passwords differ', async () => {
  const [a, b] = await Promise.all([hashPassword('Repeated-Pass-11'), hashPassword('Repeated-Pass-11')]);
  assert.notEqual(a, b);
  assert.equal(await verifyPassword('Repeated-Pass-11', a), true);
  assert.equal(await verifyPassword('Repeated-Pass-11', b), true);
});

test('malformed stored hashes never verify', async () => {
  for (const stored of ['', 'nonsense', 'scrypt$1$2$3', 'bcrypt$16384$8$1$aa$bb', null, undefined]) {
    assert.equal(await verifyPassword('anything', stored), false);
  }
});

test('needsRehash flags weaker stored parameters', async () => {
  assert.equal(needsRehash(await hashPassword('Fresh-Hash-2291')), false);
  assert.equal(needsRehash('scrypt$1024$8$1$aa$bb'), true);
  assert.equal(needsRehash('not-a-hash'), true);
});

test('password policy rejects weak, common and self-referential passwords', () => {
  assert.equal(checkPasswordPolicy('short').ok, false);
  assert.equal(checkPasswordPolicy('password123').ok, false);
  assert.equal(checkPasswordPolicy('abcdefghijkl').ok, false, 'keyboard run should fail');
  assert.equal(checkPasswordPolicy('Tyler-Scout-88', { email: 'tyler@example.com' }).ok, false, 'contains email local part');
  assert.equal(checkPasswordPolicy('Vault-Quarry-7731').ok, true);
});

test('password policy accepts a long passphrase without symbol soup', () => {
  const result = checkPasswordPolicy('correct battery staple ranch');
  assert.equal(result.ok, true, result.issues.join(' | '));
});

test('password score climbs with real strength', () => {
  assert.equal(passwordScore(''), 0);
  assert.ok(passwordScore('password123') <= 1);
  assert.ok(passwordScore('Vault-Quarry-7731') >= 3);
  assert.ok(MIN_PASSWORD_LENGTH >= 8);
});

test('session envelopes seal, open and reject tampering', async () => {
  const payload = { accessToken: 'jwt.value.here', refreshToken: 'refresh-1', expiresAt: Date.now() + 1000, userId: 'u1' };
  const sealed = await sealSession(payload);
  assert.notEqual(sealed, JSON.stringify(payload));
  assert.ok(!sealed.includes('jwt.value.here'), 'token must not be readable in the cookie');

  assert.deepEqual(await openSession(sealed), payload);

  const [iv, tag, data] = sealed.split('.');
  const flipped = data.startsWith('A') ? `B${data.slice(1)}` : `A${data.slice(1)}`;
  assert.equal(await openSession(`${iv}.${tag}.${flipped}`), null, 'tampered ciphertext must not open');
  assert.equal(await openSession('garbage'), null);
  assert.equal(await openSession(''), null);
});

test('device fingerprints are stable per device and differ across devices', () => {
  const a = deviceFingerprint({ ip: '1.2.3.4', userAgent: 'Firefox' });
  assert.equal(a, deviceFingerprint({ ip: '1.2.3.4', userAgent: 'Firefox' }));
  assert.notEqual(a, deviceFingerprint({ ip: '1.2.3.5', userAgent: 'Firefox' }));
});

test('email validation and masking behave', () => {
  assert.equal(isValidEmail('user@example.com'), true);
  assert.equal(isValidEmail('USER@Example.COM '), true);
  assert.equal(isValidEmail('no-at-sign'), false);
  assert.equal(isValidEmail('a@b'), false);
  assert.equal(isValidEmail(''), false);
  assert.equal(normalizeEmail('  USER@Example.COM '), 'user@example.com');

  const masked = maskEmailAddress('tyler@example.com');
  assert.ok(masked.startsWith('ty'));
  assert.ok(masked.endsWith('@example.com'));
  assert.ok(!masked.includes('tyler'));
});

test('publicUser maps database roles to admin flags', () => {
  const member = publicUser({ id: 'u1', email: 'a@b.com', role: ROLES.USER }, null, null);
  assert.equal(member.isAdmin, false);
  assert.equal(member.subscription.tier, 'free');

  const owner = publicUser({ id: 'u2', email: 'o@b.com', role: ROLES.OWNER }, null, { tier: 'pro', status: 'active' });
  assert.equal(owner.isAdmin, true);
  assert.equal(owner.isOwner, true);
  assert.equal(owner.subscription.active, true);

  const admin = publicUser({ id: 'u3', email: 'c@b.com', role: ROLES.ADMIN }, null, null);
  assert.equal(admin.isAdmin, true);
  assert.equal(admin.isOwner, false);
});

test('publicUser never leaks a raw token or password field', () => {
  const user = publicUser({ id: 'u1', email: 'a@b.com', role: ROLES.USER }, { id: 'u1', email: 'a@b.com' }, null);
  const serialized = JSON.stringify(user);
  assert.ok(!/token|password|secret/i.test(serialized), serialized);
});

test('mailer falls back to the console sink with no provider configured', () => {
  const config = mailerConfig();
  assert.equal(config.provider, 'console');
  assert.equal(config.configured, false);
});

test('email templates carry the code and expiry in both text and html', () => {
  const mail = verificationEmail({ code: '048213', displayName: 'Tyler', minutes: 10 });
  assert.match(mail.subject, /048213/);
  assert.match(mail.text, /048213/);
  assert.match(mail.html, /048213/);
  assert.match(mail.text, /10 minutes/);

  const reset = passwordResetEmail({ code: '900001', displayName: '', minutes: 10 });
  assert.match(reset.html, /900001/);
  assert.ok(!reset.html.includes('undefined'));
});

test('email templates escape html-bearing display names', () => {
  const mail = verificationEmail({ code: '111111', displayName: '<script>alert(1)</script>', minutes: 10 });
  assert.ok(!mail.html.includes('<script>'), 'display name must be escaped');
  assert.ok(mail.html.includes('&lt;script&gt;'));
});

test('supabase client reports unconfigured instead of guessing', () => {
  const config = supabaseConfig();
  assert.equal(typeof config.configured, 'boolean');
  if (!process.env.SUPABASE_URL) assert.equal(config.configured, false);
});

test.after(async () => {
  await fs.rm(process.env.DATA_DIR, { recursive: true, force: true });
});
