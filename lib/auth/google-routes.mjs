// Google sign-in HTTP routes.
//
//   GET /api/account/google/start     -> 302 to Google's consent screen
//   GET /api/account/google/callback  -> exchanges the code, signs the user in
//
// Both are GET because a browser redirect is a navigation, not a form post.
// That makes CSRF the central risk, so the flow is bound two ways at once:
// the state is HMAC-signed with an expiry (nobody else can mint one), AND a
// copy is stored in a short-lived cookie that the callback must match (nobody
// else can replay the one we minted for a different browser). Either check
// alone leaves a hole; together they close it.
//
// A Google account links to an existing local account by verified email. That
// is only safe because exchangeCode() refuses an unverified Google address —
// otherwise anyone could type someone else's email at Google and inherit
// their account here.

import crypto from 'node:crypto';
import { authorizeUrl, exchangeCode, googleConfig, issueState, verifyState } from './google.mjs';
import { createUser, findByEmail, updateUser, countUsers, publicUser, normalizeEmail } from './store.mjs';
import { hashPassword } from './passwords.mjs';
import { roleForNewAccount } from './service.mjs';
import { accountCookie } from './session.mjs';
import { startSession } from './presence.mjs';
import { parseCookies } from '../session.mjs';

export const STATE_COOKIE = 'sp_oauth';
const STATE_TTL_SECONDS = 600;

function secureCookie(req) {
  return String(req?.headers?.['x-forwarded-proto'] || '').toLowerCase() === 'https';
}

function stateCookie(req, value) {
  const secure = secureCookie(req) ? '; Secure' : '';
  // SameSite=Lax survives the top-level redirect back from Google; None would
  // also be sent on a cross-site POST, which is exactly what we are guarding.
  return value
    ? `${STATE_COOKIE}=${encodeURIComponent(value)}; Path=/api/account/google; HttpOnly; SameSite=Lax; Max-Age=${STATE_TTL_SECONDS}${secure}`
    : `${STATE_COOKIE}=; Path=/api/account/google; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function redirect(res, location, headers = {}) {
  res.writeHead(302, { location, 'cache-control': 'no-store', ...headers });
  res.end();
}

function clientIp(req) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req?.socket?.remoteAddress || null;
}

/**
 * Find or create the local account behind a verified Google address.
 *
 * An existing unverified local account is marked verified: Google has proven
 * ownership of the address, which is the same thing our emailed code proves.
 * A new account gets a random password hash rather than none, so the password
 * login path stays uniform and there is no hash-shaped hole to probe; the
 * holder reaches it through "forgot password" if they ever want one.
 */
export async function linkGoogleAccount({ email, log = console } = {}) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const existing = await findByEmail(normalized);
  if (existing) {
    if (existing.disabled) return { disabled: true, user: existing };
    const patch = { lastLoginAt: new Date().toISOString(), failedAttempts: 0, lockedUntil: null, googleLinked: true };
    if (!existing.emailVerified) patch.emailVerified = true;
    const updated = await updateUser(existing.id, () => patch);
    return { disabled: false, user: updated ?? existing };
  }

  const role = roleForNewAccount(normalized, await countUsers());
  const passwordHash = await hashPassword(crypto.randomBytes(32).toString('base64url'));
  const { user } = await createUser({ email: normalized, passwordHash, role, emailVerified: true });
  const updated = await updateUser(user.id, () => ({ googleLinked: true, lastLoginAt: new Date().toISOString() }));
  log?.log?.(`[Scout Pro auth] Google sign-up created user ${user.id}`);
  return { disabled: false, user: updated ?? user };
}

/**
 * @param {object} deps { sessions, json, secret, log }
 * @returns {Promise<boolean>} true when handled
 */
export async function handleGoogleRoutes(req, res, url, { sessions, json, secret, log = console }) {
  const path = url.pathname;
  if (!path.startsWith('/api/account/google')) return false;

  if (path === '/api/account/google/status' && req.method === 'GET') {
    // Readiness only, so the sign-in panel can show or hide the button without
    // the client ever learning the client id.
    json(res, 200, { ok: true, available: googleConfig().enabled });
    return true;
  }

  if (req.method !== 'GET') {
    json(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' }, { allow: 'GET' });
    return true;
  }

  if (!googleConfig().enabled) {
    json(res, 503, { ok: false, code: 'GOOGLE_NOT_CONFIGURED', message: 'Google sign-in is not available yet.' });
    return true;
  }

  if (path === '/api/account/google/start') {
    const state = issueState(secret);
    redirect(res, authorizeUrl(state), { 'set-cookie': stateCookie(req, state) });
    return true;
  }

  if (path === '/api/account/google/callback') {
    const state = url.searchParams.get('state') || '';
    const cookieState = parseCookies(req)[STATE_COOKIE] || '';
    const clear = stateCookie(req, null);

    // The signature proves we minted it; the cookie proves it was minted for
    // this browser, in this attempt.
    if (!state || state !== cookieState || !verifyState(state, secret)) {
      redirect(res, '/?signin=expired', { 'set-cookie': clear });
      return true;
    }
    if (url.searchParams.get('error')) {
      // The person declined at Google's screen. Not an error worth a page.
      redirect(res, '/?signin=cancelled', { 'set-cookie': clear });
      return true;
    }

    const identity = await exchangeCode(url.searchParams.get('code'));
    if (!identity.ok) {
      log?.warn?.(`[Scout Pro auth] Google sign-in failed: ${identity.code}`);
      redirect(res, '/?signin=failed', { 'set-cookie': clear });
      return true;
    }

    const linked = await linkGoogleAccount({ email: identity.email, log });
    if (!linked || linked.disabled) {
      redirect(res, '/?signin=failed', { 'set-cookie': clear });
      return true;
    }

    const sessionId = await startSession({
      userId: linked.user.id,
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
    });
    const token = sessions.issue(linked.user.id, linked.user.sessionVersion, sessionId);
    redirect(res, '/?signin=ok', {
      'set-cookie': [clear, accountCookie(req, token, { ttlMs: sessions.ttlMs })],
    });
    return true;
  }

  return false;
}

/** Exposed for tests and owner diagnostics. */
export { publicUser };
