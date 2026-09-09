// Password hashing.
//
// scrypt with a per-user random salt, from Node's own crypto — no dependency.
// Every hash records the parameters that produced it, so cost can be raised
// later without invalidating existing passwords: an old hash still verifies
// against its own recorded parameters and is transparently upgraded on the next
// successful sign-in.
//
// Never log, return, or store a plaintext password. It exists only as a
// function argument, and only long enough to hash or verify.

import crypto from 'node:crypto';

// Deliberately slow. ~100ms on a small Railway instance is the point: it makes
// offline cracking of a stolen hash expensive.
export const CURRENT_PARAMS = Object.freeze({ N: 16384, r: 8, p: 1, keylen: 64 });
const MAXMEM = 64 * 1024 * 1024;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

/** Common passwords are rejected outright regardless of length. */
const BANNED = new Set([
  'password', 'password1', 'password123', '1234567890', 'qwertyuiop',
  'letmein123', 'welcome123', 'admin12345', 'iloveyou1', 'football123',
  'changeme123', 'passw0rd123', 'trustno1234',
]);

function scryptAsync(password, salt, params) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, params.keylen, { N: params.N, r: params.r, p: params.p, maxmem: MAXMEM },
      (error, derived) => (error ? reject(error) : resolve(derived)));
  });
}

/**
 * Validate a candidate password.
 * Length-first, because length beats character-class rules for real strength.
 */
export function validatePassword(password, { email = '' } = {}) {
  const value = String(password ?? '');
  if (value.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, reason: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, reason: `Password must be under ${PASSWORD_MAX_LENGTH} characters.` };
  }
  if (BANNED.has(value.toLowerCase())) {
    return { ok: false, reason: 'That password is too common. Choose something less predictable.' };
  }
  const local = String(email || '').split('@')[0].toLowerCase();
  if (local.length >= 4 && value.toLowerCase().includes(local)) {
    return { ok: false, reason: 'Password must not contain your email address.' };
  }
  if (/^(.)\1+$/.test(value)) {
    return { ok: false, reason: 'Password must not be a single repeated character.' };
  }
  return { ok: true, reason: null };
}

/** Hash a password. Returns an opaque, self-describing string. */
export async function hashPassword(password, params = CURRENT_PARAMS) {
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(String(password), salt, params);
  // scrypt$N$r$p$keylen$salt$hash — parameters travel with the hash.
  return ['scrypt', params.N, params.r, params.p, params.keylen, salt.toString('hex'), derived.toString('hex')].join('$');
}

function parseHash(stored) {
  const parts = String(stored ?? '').split('$');
  if (parts.length !== 7 || parts[0] !== 'scrypt') return null;
  const [, N, r, p, keylen, salt, hash] = parts;
  const params = { N: Number(N), r: Number(r), p: Number(p), keylen: Number(keylen) };
  if (!Object.values(params).every((value) => Number.isInteger(value) && value > 0)) return null;
  if (!/^[0-9a-f]+$/i.test(salt) || !/^[0-9a-f]+$/i.test(hash)) return null;
  return { params, salt: Buffer.from(salt, 'hex'), hash: Buffer.from(hash, 'hex') };
}

/**
 * Verify a password against a stored hash.
 *
 * @returns {Promise<{ok: boolean, needsRehash: boolean}>}
 *          needsRehash is true when the stored hash used weaker parameters than
 *          current, so the caller can silently upgrade it on a good sign-in.
 */
export async function verifyPassword(password, stored) {
  const parsed = parseHash(stored);
  if (!parsed) {
    // Still burn comparable time so a malformed or absent hash is not
    // distinguishable by response latency from a wrong password.
    await scryptAsync(String(password), crypto.randomBytes(16), CURRENT_PARAMS);
    return { ok: false, needsRehash: false };
  }
  const derived = await scryptAsync(String(password), parsed.salt, parsed.params);
  const ok = derived.length === parsed.hash.length && crypto.timingSafeEqual(derived, parsed.hash);
  const needsRehash = ok && (parsed.params.N < CURRENT_PARAMS.N || parsed.params.keylen < CURRENT_PARAMS.keylen);
  return { ok, needsRehash };
}

/**
 * Constant-time-ish dummy verification.
 *
 * Called when no account exists for the submitted email, so an attacker cannot
 * tell a real address from an unknown one by how long the request took.
 */
export async function fakeVerify() {
  await scryptAsync(crypto.randomBytes(16).toString('hex'), crypto.randomBytes(16), CURRENT_PARAMS);
  return { ok: false, needsRehash: false };
}
