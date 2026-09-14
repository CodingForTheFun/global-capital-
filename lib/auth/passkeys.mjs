// Owner passkeys (WebAuthn) and offline recovery codes.
//
// This module deliberately keeps the privileged path narrow:
//   * only an already-authenticated account owner may register a passkey
//   * passwordless sign-in accepts only a stored owner credential
//   * user verification is required, so Face ID / Touch ID / device PIN is part
//     of the authenticator ceremony
//   * challenges are short-lived, signed, single-purpose, and replay-tracked
//   * recovery codes are random, stored only as HMACs, and consumed once
//
// Registration uses the browser's standards-defined getPublicKey() export from
// AuthenticatorAttestationResponse. The server still verifies the WebAuthn
// challenge, origin, RP ID hash, user-presence and user-verification flags
// before storing that key. Assertions are verified server-side with Node crypto.

import crypto from 'node:crypto';
import { parseCookies, createSessionCodec, cookieHeader as legacyCookieHeader, OWNER } from '../session.mjs';
import { findById, findByPasskeyCredentialId, publicUser, updateUser } from './store.mjs';

export const PASSKEY_CHALLENGE_COOKIE = 'sp_pk_challenge';
export const PASSKEY_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const RECOVERY_CODE_COUNT = 8;

const MAX_BINARY = 16_384;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const consumedChallenges = new Map();

function b64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function fromB64url(value, max = MAX_BINARY) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max * 2 || !/^[A-Za-z0-9_-]+$/.test(text)) throw authError('PASSKEY_INVALID', 'Passkey response is invalid.');
  const out = Buffer.from(text, 'base64url');
  if (!out.length || out.length > max) throw authError('PASSKEY_INVALID', 'Passkey response is invalid.');
  return out;
}

function safeEqual(a, b) {
  const left = Buffer.isBuffer(a) ? a : Buffer.from(String(a ?? ''));
  const right = Buffer.isBuffer(b) ? b : Buffer.from(String(b ?? ''));
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function authError(code, message) {
  return Object.assign(new Error(message), { code, publicMessage: message });
}

function challengeSignature(payload, secret) {
  return crypto.createHmac('sha256', String(secret)).update(`owner-passkey:${payload}`).digest('base64url');
}

function encodeChallengeState(state, secret) {
  const payload = b64url(Buffer.from(JSON.stringify(state), 'utf8'));
  return `${payload}.${challengeSignature(payload, secret)}`;
}

function decodeChallengeState(token, secret) {
  const [payload, signature, extra] = String(token ?? '').split('.');
  if (!payload || !signature || extra) return null;
  if (!safeEqual(signature, challengeSignature(payload, secret))) return null;
  try {
    const state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!state || !state.challenge || !state.purpose || !Number.isFinite(Number(state.expiresAt))) return null;
    if (Number(state.expiresAt) <= Date.now()) return null;
    return state;
  } catch { return null; }
}

function cleanupConsumed(now = Date.now()) {
  for (const [challenge, expiresAt] of consumedChallenges) if (expiresAt <= now) consumedChallenges.delete(challenge);
  if (consumedChallenges.size > 2_000) {
    const entries = [...consumedChallenges.entries()].sort((a, b) => a[1] - b[1]);
    for (const [key] of entries.slice(0, consumedChallenges.size - 1_500)) consumedChallenges.delete(key);
  }
}

function takeChallenge(req, secret, purpose, userId = null) {
  cleanupConsumed();
  const state = decodeChallengeState(parseCookies(req)[PASSKEY_CHALLENGE_COOKIE], secret);
  if (!state || state.purpose !== purpose) throw authError('PASSKEY_CHALLENGE_INVALID', 'That passkey request expired. Try again.');
  if (userId && state.userId !== String(userId)) throw authError('PASSKEY_CHALLENGE_INVALID', 'That passkey request expired. Try again.');
  if (consumedChallenges.has(state.challenge)) throw authError('PASSKEY_CHALLENGE_USED', 'That passkey request was already used. Try again.');
  consumedChallenges.set(state.challenge, Number(state.expiresAt));
  return state;
}

function secureRequest(req) {
  return String(req?.headers?.['x-forwarded-proto'] || '').toLowerCase() === 'https';
}

export function challengeCookie(req, token) {
  return `${PASSKEY_CHALLENGE_COOKIE}=${encodeURIComponent(token)}; Path=/api/account/passkey; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(PASSKEY_CHALLENGE_TTL_MS / 1000)}${secureRequest(req) ? '; Secure' : ''}`;
}

export function clearChallengeCookie(req) {
  return `${PASSKEY_CHALLENGE_COOKIE}=; Path=/api/account/passkey; HttpOnly; SameSite=Strict; Max-Age=0${secureRequest(req) ? '; Secure' : ''}`;
}

export function passkeyRpId(env = process.env) {
  const configured = String(env.PASSKEY_RP_ID || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  if (configured) return configured;
  if (String(env.NODE_ENV || '').toLowerCase() !== 'production') return 'localhost';
  return 'obligepay.com';
}

function allowedOrigins(env = process.env) {
  const configured = String(env.PASSKEY_ORIGINS || '').split(',').map((v) => v.trim()).filter(Boolean);
  if (configured.length) return new Set(configured);
  if (String(env.NODE_ENV || '').toLowerCase() !== 'production') {
    return new Set(['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000', 'http://127.0.0.1:3001']);
  }
  return new Set(['https://obligepay.com', 'https://www.obligepay.com']);
}

function verifyClientData(encoded, { challenge, type, env = process.env }) {
  const bytes = fromB64url(encoded, 8_192);
  let data;
  try { data = JSON.parse(bytes.toString('utf8')); }
  catch { throw authError('PASSKEY_INVALID', 'Passkey response is invalid.'); }
  if (data?.type !== type || data?.challenge !== challenge) throw authError('PASSKEY_CHALLENGE_INVALID', 'That passkey request expired. Try again.');
  if (!allowedOrigins(env).has(String(data.origin || ''))) throw authError('PASSKEY_ORIGIN_INVALID', 'Passkey origin was rejected.');
  return { data, bytes };
}

function verifyAuthenticatorData(encoded, rpId) {
  const bytes = fromB64url(encoded);
  if (bytes.length < 37) throw authError('PASSKEY_INVALID', 'Passkey response is invalid.');
  const expectedRpHash = crypto.createHash('sha256').update(rpId).digest();
  if (!safeEqual(bytes.subarray(0, 32), expectedRpHash)) throw authError('PASSKEY_RP_INVALID', 'Passkey relying party was rejected.');
  const flags = bytes[32];
  if ((flags & 0x01) === 0) throw authError('PASSKEY_USER_PRESENCE_REQUIRED', 'Passkey user presence was not verified.');
  if ((flags & 0x04) === 0) throw authError('PASSKEY_USER_VERIFICATION_REQUIRED', 'Face ID, Touch ID, or device verification is required.');
  return { bytes, counter: bytes.readUInt32BE(33) };
}

function canonicalCredentialId(body) {
  const raw = fromB64url(body?.rawId || body?.credentialId, 2_048);
  const canonical = b64url(raw);
  if (body?.credentialId && String(body.credentialId) !== canonical) throw authError('PASSKEY_INVALID', 'Passkey credential identity is invalid.');
  return canonical;
}

function validatePublicKey(encoded, algorithm) {
  const alg = Number(algorithm);
  if (![-7, -257].includes(alg)) throw authError('PASSKEY_ALGORITHM_UNSUPPORTED', 'This passkey algorithm is not supported.');
  const der = fromB64url(encoded, 8_192);
  let key;
  try { key = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' }); }
  catch { throw authError('PASSKEY_INVALID', 'Passkey public key is invalid.'); }
  if (alg === -7 && key.asymmetricKeyType !== 'ec') throw authError('PASSKEY_INVALID', 'Passkey public key type is invalid.');
  if (alg === -257 && key.asymmetricKeyType !== 'rsa') throw authError('PASSKEY_INVALID', 'Passkey public key type is invalid.');
  return { alg, der, key };
}

function randomRecoveryCode() {
  let raw = '';
  for (let i = 0; i < 16; i += 1) raw += RECOVERY_ALPHABET[crypto.randomInt(0, RECOVERY_ALPHABET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12)}`;
}

function normalizeRecoveryCode(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function recoveryCodeHash(code, { userId, secret }) {
  return crypto.createHmac('sha256', String(secret)).update(`owner-recovery:${userId}:${normalizeRecoveryCode(code)}`).digest('hex');
}

export function beginRegistration({ req, user, secret, env = process.env }) {
  if (!user || user.role !== 'owner') throw authError('OWNER_REQUIRED', 'Owner access is required.');
  const challenge = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + PASSKEY_CHALLENGE_TTL_MS;
  const state = { purpose: 'register', userId: String(user.id), challenge, expiresAt };
  const token = encodeChallengeState(state, secret);
  const rpId = passkeyRpId(env);
  return {
    cookie: challengeCookie(req, token),
    body: {
      ok: true,
      publicKey: {
        challenge,
        rp: { name: 'Oblige Props', id: rpId },
        user: {
          id: b64url(Buffer.from(String(user.id), 'utf8')),
          name: String(user.email),
          displayName: 'Oblige Props Owner',
        },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
        timeout: PASSKEY_CHALLENGE_TTL_MS,
        attestation: 'none',
        excludeCredentials: (Array.isArray(user.passkeys) ? user.passkeys : []).map((row) => ({
          type: 'public-key', id: row.credentialId, transports: Array.isArray(row.transports) ? row.transports : undefined,
        })),
      },
    },
  };
}

export async function finishRegistration({ req, user, body, secret, env = process.env }) {
  if (!user || user.role !== 'owner') throw authError('OWNER_REQUIRED', 'Owner access is required.');
  const state = takeChallenge(req, secret, 'register', user.id);
  const rpId = passkeyRpId(env);
  verifyClientData(body?.clientDataJSON, { challenge: state.challenge, type: 'webauthn.create', env });
  const authData = verifyAuthenticatorData(body?.authenticatorData, rpId);
  const credentialId = canonicalCredentialId(body);
  const publicKey = validatePublicKey(body?.publicKey, body?.publicKeyAlgorithm);
  const existing = await findByPasskeyCredentialId(credentialId);
  if (existing && existing.id !== user.id) throw authError('PASSKEY_ALREADY_REGISTERED', 'That passkey is already registered.');

  const now = new Date().toISOString();
  let recoveryCodes = [];
  const updated = await updateUser(user.id, (current) => {
    const passkeys = Array.isArray(current.passkeys) ? current.passkeys.slice() : [];
    if (!passkeys.some((row) => row.credentialId === credentialId)) {
      passkeys.push({
        credentialId,
        publicKeySpki: b64url(publicKey.der),
        algorithm: publicKey.alg,
        signCount: authData.counter,
        transports: Array.isArray(body?.transports) ? body.transports.map(String).slice(0, 8) : [],
        createdAt: now,
        lastUsedAt: null,
      });
    }
    let recoveryCodeHashes = Array.isArray(current.recoveryCodeHashes) ? current.recoveryCodeHashes.slice() : [];
    if (!recoveryCodeHashes.length) {
      recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, randomRecoveryCode);
      recoveryCodeHashes = recoveryCodes.map((code) => recoveryCodeHash(code, { userId: current.id, secret }));
    }
    return { passkeys, recoveryCodeHashes };
  });
  if (!updated) throw authError('OWNER_REQUIRED', 'Owner access is required.');
  return { ok: true, code: 'PASSKEY_REGISTERED', message: 'Passkey added.', user: publicUser(updated), recoveryCodes };
}

export function beginLogin({ req, secret, remember = false, env = process.env }) {
  const challenge = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + PASSKEY_CHALLENGE_TTL_MS;
  const state = { purpose: 'login', challenge, expiresAt, remember: remember === true };
  const token = encodeChallengeState(state, secret);
  return {
    cookie: challengeCookie(req, token),
    body: {
      ok: true,
      publicKey: {
        challenge,
        rpId: passkeyRpId(env),
        timeout: PASSKEY_CHALLENGE_TTL_MS,
        userVerification: 'required',
        allowCredentials: [],
      },
    },
  };
}

export async function finishLogin({ req, body, secret, env = process.env }) {
  const state = takeChallenge(req, secret, 'login');
  const rpId = passkeyRpId(env);
  const { bytes: clientDataBytes } = verifyClientData(body?.clientDataJSON, { challenge: state.challenge, type: 'webauthn.get', env });
  const authData = verifyAuthenticatorData(body?.authenticatorData, rpId);
  const credentialId = canonicalCredentialId(body);
  const user = await findByPasskeyCredentialId(credentialId);
  if (!user || user.role !== 'owner' || user.disabled || !user.emailVerified) throw authError('PASSKEY_NOT_RECOGNIZED', 'That passkey is not recognized for the owner account.');
  const record = (Array.isArray(user.passkeys) ? user.passkeys : []).find((row) => row.credentialId === credentialId);
  if (!record) throw authError('PASSKEY_NOT_RECOGNIZED', 'That passkey is not recognized for the owner account.');

  if (body?.userHandle) {
    const expectedHandle = b64url(Buffer.from(String(user.id), 'utf8'));
    if (!safeEqual(String(body.userHandle), expectedHandle)) throw authError('PASSKEY_USER_MISMATCH', 'Passkey user identity was rejected.');
  }

  const { key } = validatePublicKey(record.publicKeySpki, record.algorithm);
  const signature = fromB64url(body?.signature, 8_192);
  const signed = Buffer.concat([authData.bytes, crypto.createHash('sha256').update(clientDataBytes).digest()]);
  let verified = false;
  try { verified = crypto.verify('sha256', signed, key, signature); }
  catch { verified = false; }
  if (!verified) throw authError('PASSKEY_SIGNATURE_INVALID', 'Passkey verification failed.');

  const previousCount = Number(record.signCount || 0);
  if (previousCount > 0 && authData.counter > 0 && authData.counter <= previousCount) {
    throw authError('PASSKEY_COUNTER_REPLAY', 'This passkey response could not be accepted.');
  }

  const now = new Date().toISOString();
  const updated = await updateUser(user.id, (current) => ({
    passkeys: (Array.isArray(current.passkeys) ? current.passkeys : []).map((row) => row.credentialId === credentialId
      ? { ...row, signCount: authData.counter, lastUsedAt: now }
      : row),
    failedAttempts: 0,
    lockedUntil: null,
    lastLoginAt: now,
  }));
  if (!updated) throw authError('PASSKEY_NOT_RECOGNIZED', 'That passkey is not recognized for the owner account.');
  return { ok: true, user: publicUser(updated), sessionVersion: updated.sessionVersion, remember: state.remember === true };
}

export async function consumeRecoveryCode({ userId, code, secret }) {
  let matched = false;
  const updated = await updateUser(userId, (current) => {
    const hashes = Array.isArray(current.recoveryCodeHashes) ? current.recoveryCodeHashes.slice() : [];
    const candidate = recoveryCodeHash(code, { userId: current.id, secret });
    const index = hashes.findIndex((hash) => safeEqual(hash, candidate));
    if (index < 0) return {};
    matched = true;
    hashes.splice(index, 1);
    return { recoveryCodeHashes: hashes, lastLoginAt: new Date().toISOString(), failedAttempts: 0, lockedUntil: null };
  });
  return matched && updated ? { user: publicUser(updated), sessionVersion: updated.sessionVersion } : null;
}

function legacySessionSecret(env = process.env) {
  const password = String(env.DASHBOARD_PASSWORD || '');
  return env.DASHBOARD_SESSION_SECRET || crypto.createHash('sha256').update(`scout-pro:${password || 'local-only'}`).digest('hex');
}

export function legacyOwnerCookie(req, { remember = false, env = process.env } = {}) {
  const ttlMs = remember ? 30 * 24 * 60 * 60 * 1000 : 14 * 24 * 60 * 60 * 1000;
  const codec = createSessionCodec({ secret: legacySessionSecret(env), ttlMs, allowPasskeyOwner: true });
  const token = codec.makeToken(OWNER, OWNER);
  return legacyCookieHeader(req, token, { ttlMs });
}

export const _test = Object.freeze({ verifyClientData, verifyAuthenticatorData, normalizeRecoveryCode, encodeChallengeState, decodeChallengeState });
