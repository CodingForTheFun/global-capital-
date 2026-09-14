import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oblige-owner-passkey-'));
process.env.DATA_DIR = dir;
process.env.NODE_ENV = 'production';
process.env.ACCOUNT_BETA_OPEN = 'true';
process.env.ACCOUNT_OWNER_EMAIL = 'owner@example.com';
process.env.DASHBOARD_SESSION_SECRET = 'test-session-secret-that-is-long-and-random-enough';
process.env.DASHBOARD_PASSWORD = 'legacy-owner-password';

const sessionMod = await import('../lib/session.mjs');
const store = await import('../lib/auth/store.mjs');
const service = await import('../lib/auth/service.mjs');
const passkeys = await import('../lib/auth/passkeys.mjs');
const { landingPage } = await import('../lib/auth/landing.mjs');

const secret = 'passkey-test-secret-not-used-outside-tests';
const b64 = (value) => Buffer.from(value).toString('base64url');
const request = (cookie = '') => ({ headers: { cookie, 'x-forwarded-proto': 'https', host: 'www.obligepay.com' } });

async function reset() {
  await store._reset();
  sessionMod.resetOwnerPasskeyStateCache();
}

async function ownerAccount() {
  const result = await service.register({ email: 'owner@example.com', password: 'LongOwnerPassword!2026' });
  assert.equal(result.ok, true);
  assert.equal(result.user.role, 'owner');
  const raw = await store.findById(result.user.id);
  assert.ok(raw);
  return raw;
}

function authenticatorData(rpId = 'obligepay.com', flags = 0x05, counter = 1) {
  const out = Buffer.alloc(37);
  crypto.createHash('sha256').update(rpId).digest().copy(out, 0);
  out[32] = flags;
  out.writeUInt32BE(counter, 33);
  return out;
}

function challengeCookieValue(setCookie) {
  const pair = String(setCookie).split(';')[0];
  return `${passkeys.PASSKEY_CHALLENGE_COOKIE}=${pair.slice(pair.indexOf('=') + 1)}`;
}

test('legacy owner password sessions are invalidated immediately once an owner has a passkey', async () => {
  await reset();
  const codec = sessionMod.createSessionCodec({ secret: process.env.DASHBOARD_SESSION_SECRET, now: () => 1_000_000 });
  const oldToken = codec.makeToken(sessionMod.OWNER, sessionMod.OWNER);
  assert.equal(codec.readToken(oldToken).role, sessionMod.OWNER);

  const owner = await ownerAccount();
  await store.updateUser(owner.id, () => ({
    passkeys: [{ credentialId: 'credential-one', publicKeySpki: 'unused', algorithm: -7, signCount: 0 }],
  }));

  // Negative state must not be cached: there is no one-second downgrade window.
  assert.equal(sessionMod.ownerPasskeyRequired(), true);
  assert.equal(codec.readToken(oldToken).authenticated, false);
  assert.equal(codec.readToken(oldToken).reason, 'passkey-required');
  assert.throws(() => codec.makeToken(sessionMod.OWNER, sessionMod.OWNER), { code: 'OWNER_PASSKEY_REQUIRED' });

  const passkeyCodec = sessionMod.createSessionCodec({
    secret: process.env.DASHBOARD_SESSION_SECRET,
    now: () => 1_000_000,
    allowPasskeyOwner: true,
  });
  const passkeyToken = passkeyCodec.makeToken(sessionMod.OWNER, sessionMod.OWNER);
  assert.equal(passkeyCodec.readToken(passkeyToken).role, sessionMod.OWNER);
});

test('WebAuthn assertion verifies a real P-256 signature and a challenge cannot be replayed', async () => {
  await reset();
  const owner = await ownerAccount();
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  const credentialId = crypto.randomBytes(32).toString('base64url');
  await store.updateUser(owner.id, () => ({
    passkeys: [{
      credentialId,
      publicKeySpki: b64(spki),
      algorithm: -7,
      signCount: 0,
      transports: ['internal'],
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    }],
  }));

  const begin = passkeys.beginLogin({ req: request(), secret, env: { NODE_ENV: 'production' } });
  assert.equal(begin.body.publicKey.rpId, 'obligepay.com');
  assert.equal(begin.body.publicKey.userVerification, 'required');
  assert.match(begin.cookie, /HttpOnly/);
  assert.match(begin.cookie, /SameSite=Strict/);

  const clientDataBytes = Buffer.from(JSON.stringify({
    type: 'webauthn.get',
    challenge: begin.body.publicKey.challenge,
    origin: 'https://www.obligepay.com',
  }));
  const authData = authenticatorData('obligepay.com', 0x05, 1);
  const signed = Buffer.concat([authData, crypto.createHash('sha256').update(clientDataBytes).digest()]);
  const signature = crypto.sign('sha256', signed, privateKey);
  const body = {
    credentialId,
    rawId: credentialId,
    clientDataJSON: b64(clientDataBytes),
    authenticatorData: b64(authData),
    signature: b64(signature),
  };
  const req = request(challengeCookieValue(begin.cookie));
  const result = await passkeys.finishLogin({ req, body, secret, env: { NODE_ENV: 'production' } });
  assert.equal(result.user.role, 'owner');
  assert.equal(result.user.passkeyEnabled, true);

  await assert.rejects(
    () => passkeys.finishLogin({ req, body, secret, env: { NODE_ENV: 'production' } }),
    { code: 'PASSKEY_CHALLENGE_USED' },
  );
});

test('WebAuthn rejects the wrong RP and requires user verification', async () => {
  const verify = passkeys._test.verifyAuthenticatorData;
  assert.throws(() => verify(b64(authenticatorData('evil.example', 0x05)), 'obligepay.com'), { code: 'PASSKEY_RP_INVALID' });
  assert.throws(() => verify(b64(authenticatorData('obligepay.com', 0x01)), 'obligepay.com'), { code: 'PASSKEY_USER_VERIFICATION_REQUIRED' });
  const accepted = verify(b64(authenticatorData('obligepay.com', 0x05, 9)), 'obligepay.com');
  assert.equal(accepted.counter, 9);
});

test('first passkey enrollment creates one-time recovery codes but public user data leaks neither keys nor code hashes', async () => {
  await reset();
  const owner = await ownerAccount();
  const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  const credentialId = crypto.randomBytes(32).toString('base64url');
  const begin = passkeys.beginRegistration({ req: request(), user: owner, secret, env: { NODE_ENV: 'production' } });
  const clientData = Buffer.from(JSON.stringify({
    type: 'webauthn.create',
    challenge: begin.body.publicKey.challenge,
    origin: 'https://www.obligepay.com',
  }));
  const result = await passkeys.finishRegistration({
    req: request(challengeCookieValue(begin.cookie)),
    user: owner,
    secret,
    env: { NODE_ENV: 'production' },
    body: {
      credentialId,
      rawId: credentialId,
      clientDataJSON: b64(clientData),
      authenticatorData: b64(authenticatorData()),
      publicKey: b64(spki),
      publicKeyAlgorithm: -7,
      transports: ['internal'],
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.recoveryCodes.length, passkeys.RECOVERY_CODE_COUNT);
  assert.equal(result.user.passkeyEnabled, true);
  assert.equal(result.user.passkeyCount, 1);
  assert.equal(result.user.recoveryCodesRemaining, passkeys.RECOVERY_CODE_COUNT);
  assert.equal('passkeys' in result.user, false);
  assert.equal('recoveryCodeHashes' in result.user, false);
  assert.equal('passwordHash' in result.user, false);

  const raw = await store.findById(owner.id);
  const serialized = JSON.stringify(raw);
  assert.equal(serialized.includes(result.recoveryCodes[0]), false);
  assert.equal(raw.recoveryCodeHashes.length, passkeys.RECOVERY_CODE_COUNT);

  const first = await passkeys.consumeRecoveryCode({ userId: owner.id, code: result.recoveryCodes[0], secret });
  assert.equal(first.user.role, 'owner');
  assert.equal(first.user.recoveryCodesRemaining, passkeys.RECOVERY_CODE_COUNT - 1);
  assert.equal(await passkeys.consumeRecoveryCode({ userId: owner.id, code: result.recoveryCodes[0], secret }), null);
});

test('signed-out landing loads owner security before the ordinary password form handler', async () => {
  const html = landingPage({ passwordSignup: true, googleSignup: false, beta: true });
  assert.match(html, /Owner: use Face ID \/ passkey/);
  assert.match(html, /navigator\.credentials/);
  const security = html.indexOf('ownerPasskeyClient');
  const ordinary = html.indexOf("var mode='signup'");
  assert.ok(security >= 0 && ordinary > security, 'owner passkey wrapper must run before ordinary sign-in');
});

test('production UI bootstrap prepends owner security before the app captures fetch', async () => {
  const source = await fs.readFile(path.resolve('frontdoor-clearsports.mjs'), 'utf8');
  assert.match(source, /ownerSecurityClient \+ '\\n' \+ makeClientSafeVisualUi/);
  assert.match(source, /new Function\(ownerSecurityClient\)/);
});

test.after(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});
