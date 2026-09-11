// Authentication flows.
//
// Two rules shape almost every decision here:
//
// 1. NO USER ENUMERATION. Registering, signing in, and requesting a reset all
//    return the same shape and burn comparable time whether or not the address
//    exists. An attacker must not be able to harvest which emails have accounts.
//
// 2. FAIL CLOSED. An unverified account cannot sign in. A locked account cannot
//    sign in. A mail outage does not silently grant access.
//
// The caller (routes.mjs) owns HTTP concerns and rate limiting; this file owns
// correctness of the flows themselves.

import crypto from 'node:crypto';
import {
  findByEmail, findById, createUser, updateUser, revokeSessions,
  normalizeEmail, looksLikeEmail, publicUser, countUsers,
} from './store.mjs';
import { hashPassword, verifyPassword, fakeVerify, validatePassword } from './passwords.mjs';
import {
  CODE_PURPOSES, CODE_RESULT, issueCode, verifyCode, withinCooldown,
  cooldownRemainingMs, attemptsRemaining,
} from './codes.mjs';
import * as mailer from './mailer.mjs';

// Account lockout after repeated failures, with escalating duration.
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_STEPS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

/** Identical copy for every "we may or may not have sent mail" outcome. */
const NEUTRAL_SENT = 'If that email address has an account, a code is on its way.';
const GENERIC_CREDENTIALS = 'Incorrect email or password.';

function codeSecret() {
  const secret = process.env.DASHBOARD_SESSION_SECRET || process.env.AUTOPROP_MASTER_KEY || process.env.DASHBOARD_PASSWORD;
  if (secret) return secret;
  // Without a configured secret, derive a stable per-install value rather than
  // a constant, so codes are not forgeable across deployments.
  return crypto.createHash('sha256').update(`scoutpro:codes:${process.env.DATA_DIR || 'local'}`).digest('hex');
}

/**
 * Which role a newly created account gets.
 *
 * On a private install the first account is the operator, so it becomes owner.
 * That rule is wrong the moment the site is public — the first stranger to sign
 * up would inherit it — so ACCOUNT_OWNER_EMAIL overrides it: set it, and only
 * that address can ever be owner, no matter who registers first.
 */
export function roleForNewAccount(email, existingCount) {
  const designated = normalizeEmail(process.env.ACCOUNT_OWNER_EMAIL || '');
  if (designated) return normalizeEmail(email) === designated ? 'owner' : 'member';
  return existingCount === 0 ? 'owner' : 'member';
}

function lockoutFor(failedAttempts) {
  const over = failedAttempts - LOCKOUT_THRESHOLD;
  if (over < 0) return 0;
  return LOCKOUT_STEPS_MS[Math.min(over, LOCKOUT_STEPS_MS.length - 1)];
}

function isLocked(user, now = Date.now()) {
  const until = Date.parse(user?.lockedUntil ?? '');
  return Number.isFinite(until) && until > now;
}

async function deliver(user, purpose, { log = console, fetchImpl } = {}) {
  const { code, record } = issueCode({ userId: user.id, purpose, secret: codeSecret() });
  // Issuing invalidates any previous code for this purpose.
  await updateUser(user.id, (current) => ({ pendingCodes: { ...current.pendingCodes, [purpose]: record } }));

  const template = purpose === CODE_PURPOSES.RESET_PASSWORD ? mailer.resetEmail(code) : mailer.verificationEmail(code);
  const result = await mailer.send({ to: user.email, ...template }, { log, fetchImpl });
  if (!result.ok && !result.notConfigured) {
    log?.error?.(`[Scout Pro auth] failed to deliver ${purpose} to user ${user.id}`);
  }
  return result;
}

/**
 * Register an account.
 *
 * Always reports success. When the address is already taken we send a
 * "someone tried to register your address" style verification instead of an
 * error, so the response cannot be used to test whether an account exists.
 */
export async function register({ email, password }, { log = console, fetchImpl } = {}) {
  const normalized = normalizeEmail(email);
  if (!looksLikeEmail(normalized)) {
    return { ok: false, code: 'AUTH_EMAIL_INVALID', message: 'Enter a valid email address.' };
  }
  const strength = validatePassword(password, { email: normalized });
  if (!strength.ok) {
    return { ok: false, code: 'AUTH_PASSWORD_WEAK', message: strength.reason };
  }

  const existing = await findByEmail(normalized);
  if (existing) {
    // Do not reveal the collision. If they never verified, re-send so a genuine
    // owner who lost the first email can still finish; if verified, send nothing
    // and still report success.
    if (!existing.emailVerified && !withinCooldown(existing.pendingCodes?.[CODE_PURPOSES.VERIFY_EMAIL])) {
      await deliver(existing, CODE_PURPOSES.VERIFY_EMAIL, { log, fetchImpl });
    }
    return { ok: true, code: 'AUTH_REGISTERED', message: NEUTRAL_SENT, requiresVerification: true, email: normalized };
  }

  // The very first account becomes the owner; everyone after is a member.
  const role = roleForNewAccount(normalized, await countUsers());
  const passwordHash = await hashPassword(password);
  const { user } = await createUser({ email: normalized, passwordHash, role, emailVerified: false });
  await deliver(user, CODE_PURPOSES.VERIFY_EMAIL, { log, fetchImpl });

  return { ok: true, code: 'AUTH_REGISTERED', message: NEUTRAL_SENT, requiresVerification: true, email: normalized };
}

/** Confirm an emailed verification code and activate the account. */
export async function verifyEmail({ email, code }, { log = console } = {}) {
  const user = await findByEmail(email);
  if (!user) return { ok: false, code: 'AUTH_CODE_INVALID', message: 'That code is not valid. Request a new one.' };
  if (user.emailVerified) return { ok: true, code: 'AUTH_ALREADY_VERIFIED', message: 'Your email is already verified.', user: publicUser(user) };

  const purpose = CODE_PURPOSES.VERIFY_EMAIL;
  const record = user.pendingCodes?.[purpose];
  const outcome = verifyCode(record, code, { userId: user.id, purpose, secret: codeSecret() });

  await updateUser(user.id, (current) => {
    const pending = { ...current.pendingCodes };
    if (outcome.record) pending[purpose] = outcome.record; else delete pending[purpose];
    return outcome.result === CODE_RESULT.OK
      ? { pendingCodes: pending, emailVerified: true, failedAttempts: 0, lockedUntil: null }
      : { pendingCodes: pending };
  });

  if (outcome.result === CODE_RESULT.OK) {
    const fresh = await findById(user.id);
    log?.log?.(`[Scout Pro auth] email verified for user ${user.id}`);
    return { ok: true, code: 'AUTH_VERIFIED', message: 'Email verified. You can sign in now.', user: publicUser(fresh) };
  }
  if (outcome.result === CODE_RESULT.EXPIRED) {
    return { ok: false, code: 'AUTH_CODE_EXPIRED', message: 'That code expired. Request a new one.' };
  }
  if (outcome.result === CODE_RESULT.EXHAUSTED) {
    return { ok: false, code: 'AUTH_CODE_EXHAUSTED', message: 'Too many incorrect attempts. Request a new code.' };
  }
  const left = attemptsRemaining(outcome.record);
  return { ok: false, code: 'AUTH_CODE_INVALID', message: `That code is not correct. ${left} attempt${left === 1 ? '' : 's'} remaining.` };
}

/** Re-send a code. Rate limited by cooldown, and never confirms the address. */
export async function resendCode({ email, purpose = CODE_PURPOSES.VERIFY_EMAIL }, { log = console, fetchImpl } = {}) {
  const user = await findByEmail(email);
  if (!user || (purpose === CODE_PURPOSES.VERIFY_EMAIL && user.emailVerified) || user.disabled) {
    return { ok: true, code: 'AUTH_CODE_SENT', message: NEUTRAL_SENT };
  }
  const existing = user.pendingCodes?.[purpose];
  if (withinCooldown(existing)) {
    const seconds = Math.ceil(cooldownRemainingMs(existing) / 1000);
    return { ok: false, code: 'AUTH_CODE_COOLDOWN', message: `Please wait ${seconds}s before requesting another code.`, retryAfterSeconds: seconds };
  }
  await deliver(user, purpose, { log, fetchImpl });
  return { ok: true, code: 'AUTH_CODE_SENT', message: NEUTRAL_SENT };
}

/**
 * Sign in.
 *
 * Returns the user only on full success. Unverified and locked accounts are
 * refused, and every refusal that could leak account existence uses identical
 * copy and comparable timing.
 */
export async function login({ email, password, ip = null }, { log = console } = {}) {
  const user = await findByEmail(email);

  if (!user) {
    // Burn equivalent scrypt time so an unknown address is not faster.
    await fakeVerify();
    return { ok: false, code: 'AUTH_INVALID_CREDENTIALS', message: GENERIC_CREDENTIALS };
  }
  if (user.disabled) {
    await fakeVerify();
    return { ok: false, code: 'AUTH_INVALID_CREDENTIALS', message: GENERIC_CREDENTIALS };
  }
  if (isLocked(user)) {
    const seconds = Math.ceil((Date.parse(user.lockedUntil) - Date.now()) / 1000);
    return { ok: false, code: 'AUTH_LOCKED', message: `Too many failed attempts. Try again in ${seconds}s.`, retryAfterSeconds: seconds };
  }

  const { ok, needsRehash } = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const failed = Number(user.failedAttempts || 0) + 1;
    const lockMs = lockoutFor(failed);
    await updateUser(user.id, () => ({
      failedAttempts: failed,
      lockedUntil: lockMs ? new Date(Date.now() + lockMs).toISOString() : null,
    }));
    log?.warn?.(`[Scout Pro auth] failed sign-in for user ${user.id} (attempt ${failed})`);
    return { ok: false, code: 'AUTH_INVALID_CREDENTIALS', message: GENERIC_CREDENTIALS };
  }

  // Correct password, but the address was never confirmed. Refuse, and help
  // them finish — this is safe to disclose because they proved the password.
  if (!user.emailVerified) {
    return { ok: false, code: 'AUTH_EMAIL_UNVERIFIED', message: 'Verify your email before signing in. Check your inbox for a code.', requiresVerification: true, email: user.email };
  }

  const patch = {
    failedAttempts: 0,
    lockedUntil: null,
    lastLoginAt: new Date().toISOString(),
    lastLoginIp: ip ? String(ip).slice(0, 64) : null,
  };
  // Silently upgrade a hash made with older, weaker parameters.
  if (needsRehash) patch.passwordHash = await hashPassword(password);
  const updated = await updateUser(user.id, () => patch);

  log?.log?.(`[Scout Pro auth] sign-in for user ${user.id}`);
  return { ok: true, code: 'AUTH_SIGNED_IN', message: 'Signed in.', user: publicUser(updated), sessionVersion: updated.sessionVersion };
}

/** Begin a password reset. Always reports the same thing. */
export async function requestPasswordReset({ email }, { log = console, fetchImpl } = {}) {
  const user = await findByEmail(email);
  if (user && !user.disabled) {
    const existing = user.pendingCodes?.[CODE_PURPOSES.RESET_PASSWORD];
    if (!withinCooldown(existing)) await deliver(user, CODE_PURPOSES.RESET_PASSWORD, { log, fetchImpl });
  } else {
    // Spend comparable time so a missing account is not measurably faster.
    await fakeVerify();
  }
  return { ok: true, code: 'AUTH_RESET_SENT', message: NEUTRAL_SENT };
}

/**
 * Complete a reset. On success every existing session is revoked, so a thief
 * holding a stolen cookie is evicted by the real owner's reset.
 */
export async function resetPassword({ email, code, password }, { log = console, fetchImpl } = {}) {
  const user = await findByEmail(email);
  if (!user) return { ok: false, code: 'AUTH_CODE_INVALID', message: 'That code is not valid. Request a new one.' };

  const strength = validatePassword(password, { email: user.email });
  if (!strength.ok) return { ok: false, code: 'AUTH_PASSWORD_WEAK', message: strength.reason };

  const purpose = CODE_PURPOSES.RESET_PASSWORD;
  const outcome = verifyCode(user.pendingCodes?.[purpose], code, { userId: user.id, purpose, secret: codeSecret() });

  if (outcome.result !== CODE_RESULT.OK) {
    await updateUser(user.id, (current) => {
      const pending = { ...current.pendingCodes };
      if (outcome.record) pending[purpose] = outcome.record; else delete pending[purpose];
      return { pendingCodes: pending };
    });
    if (outcome.result === CODE_RESULT.EXPIRED) return { ok: false, code: 'AUTH_CODE_EXPIRED', message: 'That code expired. Request a new one.' };
    if (outcome.result === CODE_RESULT.EXHAUSTED) return { ok: false, code: 'AUTH_CODE_EXHAUSTED', message: 'Too many incorrect attempts. Request a new code.' };
    return { ok: false, code: 'AUTH_CODE_INVALID', message: 'That code is not correct.' };
  }

  const passwordHash = await hashPassword(password);
  await updateUser(user.id, (current) => {
    const pending = { ...current.pendingCodes };
    delete pending[purpose];
    return {
      passwordHash,
      pendingCodes: pending,
      failedAttempts: 0,
      lockedUntil: null,
      // A completed reset also proves control of the inbox.
      emailVerified: true,
      sessionVersion: Number(current.sessionVersion || 1) + 1,
    };
  });

  await mailer.send({ to: user.email, ...mailer.passwordChangedEmail() }, { log, fetchImpl });
  log?.log?.(`[Scout Pro auth] password reset for user ${user.id}; sessions revoked`);
  return { ok: true, code: 'AUTH_PASSWORD_RESET', message: 'Password updated. Sign in with your new password.' };
}

/** Change a password from inside a session. Requires the current one. */
export async function changePassword({ userId, currentPassword, newPassword }, { log = console, fetchImpl } = {}) {
  const user = await findById(userId);
  if (!user) return { ok: false, code: 'AUTH_REQUIRED', message: 'Sign in again.' };

  const { ok } = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) return { ok: false, code: 'AUTH_INVALID_CREDENTIALS', message: 'Your current password is not correct.' };

  const strength = validatePassword(newPassword, { email: user.email });
  if (!strength.ok) return { ok: false, code: 'AUTH_PASSWORD_WEAK', message: strength.reason };

  const passwordHash = await hashPassword(newPassword);
  const updated = await updateUser(user.id, (current) => ({
    passwordHash,
    sessionVersion: Number(current.sessionVersion || 1) + 1,
  }));

  await mailer.send({ to: user.email, ...mailer.passwordChangedEmail() }, { log, fetchImpl });
  log?.log?.(`[Scout Pro auth] password changed for user ${user.id}; sessions revoked`);
  // The caller re-issues a cookie for the new version so the actor stays in.
  return { ok: true, code: 'AUTH_PASSWORD_CHANGED', message: 'Password updated. Other devices were signed out.', user: publicUser(updated), sessionVersion: updated.sessionVersion };
}

/** Sign out everywhere by invalidating every issued session. */
export async function signOutEverywhere({ userId }) {
  const updated = await revokeSessions(userId);
  if (!updated) return { ok: false, code: 'AUTH_REQUIRED', message: 'Sign in again.' };
  return { ok: true, code: 'AUTH_SIGNED_OUT_ALL', message: 'Signed out on every device.', sessionVersion: updated.sessionVersion };
}

/**
 * Resolve the user behind a session, rejecting one whose version is stale.
 * This is what makes "sign out everywhere" and password changes take effect
 * immediately rather than at cookie expiry.
 */
export async function resolveSession({ userId, sessionVersion }) {
  const user = await findById(userId);
  if (!user || user.disabled) return null;
  if (Number(user.sessionVersion || 1) !== Number(sessionVersion)) return null;
  if (!user.emailVerified) return null;
  return user;
}

export { CODE_PURPOSES };
