// Account session tokens.
//
// A stateless signed token that nonetheless supports instant revocation: it
// carries the user's `sessionVersion`, and the server checks that against the
// stored value on every request. Bumping the stored version invalidates every
// token ever issued for that user — which is what makes "sign out everywhere",
// password changes, and password resets take effect immediately instead of at
// cookie expiry.
//
// Distinct from lib/session.mjs, which handles the legacy single-owner password
// and access-code sessions. Both cookies can coexist during migration.

import crypto from 'node:crypto';

export const ACCOUNT_COOKIE = 'sp_account';
export const DEFAULT_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
// Re-issue when less than this remains, so an active user is never logged out
// mid-session but an abandoned token still ages out.
export const REFRESH_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;

const ANONYMOUS = Object.freeze({ valid: false, userId: null, sessionVersion: null, reason: 'no-session' });

function denied(reason) {
  return { valid: false, userId: null, sessionVersion: null, reason };
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function createAccountSessions({ secret, ttlMs = DEFAULT_TTL_MS, now = Date.now } = {}) {
  if (!secret) throw new Error('createAccountSessions requires a secret.');
  const sign = (payload) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');

  /** userId.version.expiry.signature — the signature covers all three. */
  function issue(userId, sessionVersion) {
    const id = String(userId).replace(/[^a-zA-Z0-9-]/g, '');
    if (!id) throw new Error('issue() requires a user id.');
    const expires = now() + ttlMs;
    const payload = `${id}.${Number(sessionVersion) || 1}.${expires}`;
    return `${payload}.${sign(payload)}`;
  }

  function read(token) {
    if (!token) return ANONYMOUS;
    const parts = String(token).split('.');
    if (parts.length !== 4) return denied('malformed');
    const [userId, version, expiresRaw, signature] = parts;
    const expires = Number(expiresRaw);
    const sessionVersion = Number(version);
    if (!Number.isFinite(expires) || !Number.isFinite(sessionVersion) || !userId) return denied('malformed');
    // Verify the signature before trusting any field in the token.
    if (!safeEqual(signature, sign(`${userId}.${version}.${expiresRaw}`))) return denied('bad-signature');
    if (expires < now()) return denied('expired');
    return {
      valid: true,
      userId,
      sessionVersion,
      expiresAt: expires,
      // The caller re-issues when this is true, sliding the window forward.
      shouldRefresh: expires - now() < REFRESH_THRESHOLD_MS,
      reason: null,
    };
  }

  return { issue, read, ttlMs };
}

/**
 * Cookie flags: HttpOnly so script cannot read it, SameSite=Lax so a normal
 * top-level navigation back from an email client keeps the session while
 * cross-site POSTs still cannot ride it, Secure whenever TLS terminated ahead
 * of us.
 */
export function accountCookie(req, token, { ttlMs = DEFAULT_TTL_MS } = {}) {
  const secure = String(req?.headers?.['x-forwarded-proto'] || '').toLowerCase() === 'https';
  return `${ACCOUNT_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ttlMs / 1000)}${secure ? '; Secure' : ''}`;
}

export function clearAccountCookie(req) {
  const secure = String(req?.headers?.['x-forwarded-proto'] || '').toLowerCase() === 'https';
  return `${ACCOUNT_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

/**
 * Double-submit CSRF token, derived from the session so it needs no storage.
 * State-changing requests must echo it in a header; a cross-site attacker can
 * send the cookie but cannot read it to construct the header.
 */
export function csrfTokenFor(sessionToken, secret) {
  return crypto.createHmac('sha256', String(secret)).update(`csrf:${sessionToken}`).digest('base64url');
}

export function csrfValid(sessionToken, submitted, secret) {
  if (!sessionToken || !submitted) return false;
  return safeEqual(submitted, csrfTokenFor(sessionToken, secret));
}
