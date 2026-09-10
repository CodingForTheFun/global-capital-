// The account shape both storage backends produce, plus the pure helpers that
// must behave identically whichever backend is active.
//
// Keeping these here means the file backend and the Supabase backend cannot
// drift on what an account looks like, or on how an email is normalised.

import crypto from 'node:crypto';

/** Normalise an email for identity purposes. */
export function normalizeEmail(email) {
  const value = String(email ?? '').trim().toLowerCase();
  if (!value) return null;
  // Deliberately conservative: lowercase and trim only. Stripping dots or
  // +tags would merge addresses their owners consider distinct.
  return value;
}

/** Structural email check. Real validation is "a code reached the inbox". */
export function looksLikeEmail(email) {
  const value = normalizeEmail(email);
  if (!value || value.length > 254) return false;
  return /^[^\s@,;:<>()[\]\\]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value);
}

/**
 * The shape stored by a backend. `passwordHash` and code hashes never leave
 * the server; publicUser() below is the only thing an API may return.
 */
export function newUser({ email, passwordHash, role = 'member', emailVerified = false, id, createdAt }) {
  const now = new Date().toISOString();
  return {
    id: id || crypto.randomUUID(),
    email,
    passwordHash,
    role,
    emailVerified,
    createdAt: createdAt || now,
    updatedAt: now,
    // Bumped to revoke every existing session for this user at once.
    sessionVersion: 1,
    lastLoginAt: null,
    lastLoginIp: null,
    failedAttempts: 0,
    lockedUntil: null,
    disabled: false,
    // Hashed, single-use codes for email verification and password reset.
    pendingCodes: {},
  };
}

/** Everything an API response may contain. Never includes a hash. */
export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    emailVerified: user.emailVerified === true,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt ?? null,
    disabled: user.disabled === true,
  };
}

// The database models four roles; the product has two capability levels.
// permissions.mjs only understands 'owner' and 'member', so the mapping lives
// here rather than leaking database vocabulary into the rest of the app.
export const DB_ROLES = Object.freeze({ USER: 'USER', PREMIUM: 'PREMIUM', ADMIN: 'ADMIN', OWNER: 'OWNER' });

export function roleFromDatabase(dbRole) {
  return dbRole === DB_ROLES.OWNER || dbRole === DB_ROLES.ADMIN ? 'owner' : 'member';
}

export function roleToDatabase(role, { premium = false } = {}) {
  if (role === 'owner') return DB_ROLES.OWNER;
  return premium ? DB_ROLES.PREMIUM : DB_ROLES.USER;
}
