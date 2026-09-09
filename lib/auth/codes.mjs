// One-time email codes: verification, password reset, and sign-in challenges.
//
// Rules that make a 6-digit code safe despite being short:
//   - stored hashed, never in plaintext, so a leaked users.json reveals nothing
//   - short TTL (10 minutes)
//   - hard attempt cap, then the code is destroyed rather than left guessable
//   - single use: consumed on success
//   - issuing a new code invalidates the previous one for that purpose
//
// 6 digits is a million possibilities. With 5 attempts and a 10-minute window,
// a guess has odds of 1 in 200,000 — and the surrounding rate limits make
// repeated issuance expensive too.

import crypto from 'node:crypto';

export const CODE_PURPOSES = Object.freeze({
  VERIFY_EMAIL: 'verify_email',
  RESET_PASSWORD: 'reset_password',
});

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;
// Stops someone spamming a stranger's inbox by hammering "resend".
export const RESEND_COOLDOWN_MS = 60 * 1000;

const DIGITS = 6;

/** A uniformly random 6-digit code. randomInt avoids modulo bias. */
export function generateCode() {
  return String(crypto.randomInt(0, 10 ** DIGITS)).padStart(DIGITS, '0');
}

/**
 * Hash a code. Bound to the user id and purpose, so a verification code cannot
 * be replayed as a password-reset code, or against a different account.
 */
export function hashCode(code, { userId, purpose, secret }) {
  return crypto.createHmac('sha256', String(secret))
    .update(`${purpose}:${userId}:${String(code).trim()}`)
    .digest('hex');
}

function safeEqualHex(a, b) {
  const left = Buffer.from(String(a ?? ''), 'hex');
  const right = Buffer.from(String(b ?? ''), 'hex');
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * Build the record stored on the user for a freshly issued code.
 * Returns { record, code } — `code` is the plaintext, for the email only.
 */
export function issueCode({ userId, purpose, secret, now = Date.now() }) {
  const code = generateCode();
  return {
    code,
    record: {
      hash: hashCode(code, { userId, purpose, secret }),
      purpose,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + CODE_TTL_MS).toISOString(),
      attempts: 0,
    },
  };
}

/** True while the previous code for this purpose is still within cooldown. */
export function withinCooldown(record, now = Date.now()) {
  if (!record?.createdAt) return false;
  const issued = Date.parse(record.createdAt);
  return Number.isFinite(issued) && now - issued < RESEND_COOLDOWN_MS;
}

export function cooldownRemainingMs(record, now = Date.now()) {
  if (!withinCooldown(record, now)) return 0;
  return Math.max(0, RESEND_COOLDOWN_MS - (now - Date.parse(record.createdAt)));
}

export const CODE_RESULT = Object.freeze({
  OK: 'ok',
  MISSING: 'missing',
  EXPIRED: 'expired',
  MISMATCH: 'mismatch',
  EXHAUSTED: 'exhausted',
});

/**
 * Check a submitted code.
 *
 * @returns {{result: string, record: object|null, consumed: boolean}}
 *          `record` is the record to store back (with the attempt counted), or
 *          null when it should be deleted — on success, expiry, or exhaustion.
 *          The caller persists that decision.
 */
export function verifyCode(record, submitted, { userId, purpose, secret, now = Date.now() }) {
  if (!record?.hash) return { result: CODE_RESULT.MISSING, record: null, consumed: false };

  const expires = Date.parse(record.expiresAt ?? '');
  if (!Number.isFinite(expires) || now >= expires) {
    // Expired codes are removed, never left to be guessed at leisure.
    return { result: CODE_RESULT.EXPIRED, record: null, consumed: false };
  }

  const attempts = Number(record.attempts || 0);
  if (attempts >= MAX_CODE_ATTEMPTS) {
    return { result: CODE_RESULT.EXHAUSTED, record: null, consumed: false };
  }

  const expected = hashCode(submitted, { userId, purpose, secret });
  if (!safeEqualHex(record.hash, expected)) {
    const next = attempts + 1;
    // The final wrong guess destroys the code rather than leaving one left.
    if (next >= MAX_CODE_ATTEMPTS) return { result: CODE_RESULT.EXHAUSTED, record: null, consumed: false };
    return { result: CODE_RESULT.MISMATCH, record: { ...record, attempts: next }, consumed: false };
  }

  return { result: CODE_RESULT.OK, record: null, consumed: true };
}

/** Attempts remaining, for a message that helps without aiding a guesser. */
export function attemptsRemaining(record) {
  if (!record) return 0;
  return Math.max(0, MAX_CODE_ATTEMPTS - Number(record.attempts || 0));
}
