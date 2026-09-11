// Account authentication HTTP routes.
//
//   POST /api/account/register          email + password -> emails a code
//   POST /api/account/verify            email + code     -> activates account
//   POST /api/account/resend            email            -> re-sends a code
//   POST /api/account/login             email + password -> sets session cookie
//   POST /api/account/logout            clears this session
//   POST /api/account/logout-all        revokes every session for the user
//   POST /api/account/password/forgot   email            -> emails a reset code
//   POST /api/account/password/reset    email+code+password
//   POST /api/account/password/change   current + new (signed in)
//   GET  /api/account/me                current session, or anonymous
//
// Every response goes through the app's error allowlist. Rate limits are per
// IP and, where it matters, per account, so one address cannot be ground down
// from many IPs nor one IP grind many addresses.

import * as service from './service.mjs';
import { CODE_PURPOSES } from './codes.mjs';
import { publicUser } from './store.mjs';
import { isConfigured as mailConfigured, detectProvider } from './mailer.mjs';
import { betaOpenSignup } from './beta.mjs';
import { ACCOUNT_COOKIE, accountCookie, clearAccountCookie, csrfTokenFor, csrfValid } from './session.mjs';
import { startSession, touchSession, isSessionActive, revokeSession, revokeAllForUser, sessionsForUser } from './presence.mjs';
import { capabilitiesFor, navFor } from './permissions.mjs';
import { parseCookies, createRateLimiter, clientKey } from '../session.mjs';
import { internalDetail, GENERIC_MESSAGE } from '../safe-error.mjs';

const limiter = createRateLimiter();

// 30 days when the person asks to be remembered, against the 14-day default.
export const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Per-IP and per-account, because either alone is bypassable.
const LIMITS = Object.freeze({
  register: { max: 5, windowMs: 60 * 60_000 },
  login: { max: 10, windowMs: 15 * 60_000 },
  loginAccount: { max: 8, windowMs: 15 * 60_000 },
  verify: { max: 12, windowMs: 15 * 60_000 },
  resend: { max: 5, windowMs: 60 * 60_000 },
  forgot: { max: 5, windowMs: 60 * 60_000 },
  reset: { max: 10, windowMs: 60 * 60_000 },
  change: { max: 10, windowMs: 60 * 60_000 },
});

function allow(req, bucket, email = null) {
  const limit = LIMITS[bucket];
  if (!limit) return true;
  if (!limiter.allow(clientKey(req, bucket), limit.max, limit.windowMs)) return false;
  if (email) {
    const accountLimit = LIMITS[`${bucket}Account`] || limit;
    // Keyed on the address itself so it holds across IPs.
    if (!limiter.allow(`${bucket}:acct:${String(email).toLowerCase()}`, accountLimit.max, accountLimit.windowMs)) return false;
  }
  return true;
}

function clientIp(req) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req?.socket?.remoteAddress || null;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser client; CSRF is a browser problem
  try {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
    return new URL(origin).host === host;
  } catch { return false; }
}

async function readBody(req, limit = 8_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request body is too large.'), { code: 'REQUEST_INVALID' });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON request.'), { code: 'REQUEST_INVALID' }); }
}

/**
 * Resolve the current account session, checking the stored sessionVersion so a
 * revoked session is rejected immediately rather than at cookie expiry.
 */
export async function currentAccount(req, sessions) {
  const token = parseCookies(req)[ACCOUNT_COOKIE];
  if (!token) return { user: null, token: null, session: null };
  const session = sessions.read(token);
  if (!session.valid) return { user: null, token: null, session };

  const user = await service.resolveSession({ userId: session.userId, sessionVersion: session.sessionVersion });
  if (!user) return { user: null, token: null, session: { ...session, valid: false, reason: 'revoked' } };

  // A device signed out from the owner's panel stops working immediately,
  // without disturbing that person's other devices.
  if (session.sessionId && !(await isSessionActive(session.sessionId))) {
    return { user: null, token: null, session: { ...session, valid: false, reason: 'device-revoked' } };
  }
  // Heartbeat, throttled inside touchSession so this is cheap per request.
  if (session.sessionId) await touchSession(session.sessionId, { ip: clientIp(req) });

  return { user, token, session };
}

/**
 * @param {object} deps { sessions, json, secret, log }
 * @returns {Promise<boolean>} true when handled
 */
export async function handleAccountRoutes(req, res, url, { sessions, json, secret, log = console }) {
  const path = url.pathname;
  if (!path.startsWith('/api/account')) return false;

  // "Remember me" is the longer of the two windows. Both are HttpOnly and
  // signed; the only difference is how long the cookie survives, so a shared
  // machine is not silently kept signed in for a month.
  const setSession = (user, sessionVersion, sessionId = '', { remember = false } = {}) => {
    const ttlMs = remember ? REMEMBER_TTL_MS : sessions.ttlMs;
    const token = sessions.issue(user.id, sessionVersion ?? user.sessionVersion, sessionId);
    return { token, cookie: accountCookie(req, token, { ttlMs }), csrf: csrfTokenFor(token, secret) };
  };

  try {
    // --- read-only ---------------------------------------------------------
    if (path === '/api/account/me' && req.method === 'GET') {
      const { user, token, session } = await currentAccount(req, sessions);
      if (!user) {
        json(res, 200, { authenticated: false, user: null, mailConfigured: mailConfigured() });
        return true;
      }
      const payload = {
        authenticated: true,
        user: publicUser(user),
        // The client renders its tabs from these, so a tab can never appear
        // without the backend permission that backs it.
        capabilities: capabilitiesFor(user.role),
        nav: navFor(user.role),
        devices: await sessionsForUser(user.id),
        mailConfigured: mailConfigured(),
      };
      // Slide the window forward for an active user, keeping the same device id.
      if (session?.shouldRefresh) {
        const next = setSession(user, user.sessionVersion, session.sessionId || '');
        json(res, 200, { ...payload, csrfToken: next.csrf }, { 'set-cookie': next.cookie });
        return true;
      }
      json(res, 200, { ...payload, csrfToken: csrfTokenFor(token, secret) });
      return true;
    }

    if (req.method !== 'POST') return false;
    if (!sameOrigin(req)) {
      json(res, 403, { ok: false, message: 'Cross-origin request rejected.' });
      return true;
    }

    const body = await readBody(req);
    const email = typeof body.email === 'string' ? body.email : '';

    // --- registration and verification ------------------------------------
    if (path === '/api/account/register') {
      if (!allow(req, 'register', email)) return tooMany(res, json);
      const result = await service.register({ email, password: body.password }, { log });
      if (result.ok && result.signedIn && betaOpenSignup()) {
        // Beta mode created a usable account, so put them straight into the
        // product rather than parking them on a screen waiting for an email
        // that is never going to arrive.
        const sessionId = await startSession({
          userId: result.user.id,
          ip: clientIp(req),
          userAgent: req.headers['user-agent'],
        });
        const next = setSession(result.user, result.sessionVersion, sessionId, { remember: body.rememberMe === true });
        json(res, 200, {
          ok: true,
          code: result.code,
          message: result.message,
          user: result.user,
          authenticated: true,
          capabilities: capabilitiesFor(result.user.role),
          csrfToken: next.csrf,
        }, { 'set-cookie': next.cookie });
        return true;
      }
      json(res, result.ok ? 200 : 400, strip(result));
      return true;
    }

    if (path === '/api/account/verify') {
      if (!allow(req, 'verify', email)) return tooMany(res, json);
      const result = await service.verifyEmail({ email, code: body.code }, { log });
      json(res, result.ok ? 200 : 400, strip(result));
      return true;
    }

    if (path === '/api/account/resend') {
      if (!allow(req, 'resend', email)) return tooMany(res, json);
      const purpose = body.purpose === CODE_PURPOSES.RESET_PASSWORD ? CODE_PURPOSES.RESET_PASSWORD : CODE_PURPOSES.VERIFY_EMAIL;
      const result = await service.resendCode({ email, purpose }, { log });
      json(res, result.ok ? 200 : 429, strip(result));
      return true;
    }

    // --- sign in / out -----------------------------------------------------
    if (path === '/api/account/login') {
      if (!allow(req, 'login', email)) return tooMany(res, json);
      const result = await service.login({ email, password: body.password, ip: clientIp(req) }, { log });
      if (!result.ok) {
        json(res, result.code === 'AUTH_LOCKED' ? 429 : 401, strip(result));
        return true;
      }
      const sessionId = await startSession({
        userId: result.user.id,
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
      const next = setSession(result.user, result.sessionVersion, sessionId, { remember: body.rememberMe === true });
      json(res, 200, {
        ok: true,
        user: result.user,
        capabilities: capabilitiesFor(result.user.role),
        nav: navFor(result.user.role),
        csrfToken: next.csrf,
        message: result.message,
      }, { 'set-cookie': next.cookie });
      return true;
    }

    if (path === '/api/account/logout') {
      // End this device's record too, so it leaves the owner's presence panel.
      const { session } = await currentAccount(req, sessions);
      if (session?.sessionId) await revokeSession(session.sessionId);
      json(res, 200, { ok: true, message: 'Signed out.' }, { 'set-cookie': clearAccountCookie(req) });
      return true;
    }

    if (path === '/api/account/logout-all') {
      const { user, token } = await currentAccount(req, sessions);
      if (!user) return unauthenticated(res, json);
      if (!csrfValid(token, req.headers['x-csrf-token'], secret)) return badCsrf(res, json);
      const result = await service.signOutEverywhere({ userId: user.id });
      await revokeAllForUser(user.id);
      json(res, 200, strip(result), { 'set-cookie': clearAccountCookie(req) });
      return true;
    }

    // --- password ----------------------------------------------------------
    if (path === '/api/account/password/forgot') {
      if (!allow(req, 'forgot', email)) return tooMany(res, json);
      const result = await service.requestPasswordReset({ email }, { log });
      json(res, 200, strip(result));
      return true;
    }

    if (path === '/api/account/password/reset') {
      if (!allow(req, 'reset', email)) return tooMany(res, json);
      const result = await service.resetPassword({ email, code: body.code, password: body.password }, { log });
      json(res, result.ok ? 200 : 400, strip(result));
      return true;
    }

    if (path === '/api/account/password/change') {
      const { user, token } = await currentAccount(req, sessions);
      if (!user) return unauthenticated(res, json);
      if (!csrfValid(token, req.headers['x-csrf-token'], secret)) return badCsrf(res, json);
      if (!allow(req, 'change', user.email)) return tooMany(res, json);
      const result = await service.changePassword({
        userId: user.id,
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
      }, { log });
      if (!result.ok) {
        json(res, 400, strip(result));
        return true;
      }
      // Re-issue for the bumped version so the actor stays signed in here while
      // every other device is evicted.
      const { session } = await currentAccount(req, sessions);
      const next = setSession(result.user, result.sessionVersion, session?.sessionId || '');
      json(res, 200, { ...strip(result), csrfToken: next.csrf }, { 'set-cookie': next.cookie });
      return true;
    }

    return false;
  } catch (error) {
    log?.error?.('[Scout Pro auth] request failed', JSON.stringify(internalDetail(error, { stage: 'account-route', path })));
    json(res, error?.code === 'REQUEST_INVALID' ? 400 : 500, {
      ok: false,
      message: error?.code === 'REQUEST_INVALID' ? 'That request could not be processed.' : GENERIC_MESSAGE,
    });
    return true;
  }
}

/** Only ever return fields that are safe for a browser. */
function strip(result) {
  return {
    ok: result.ok === true,
    code: result.code ?? null,
    message: result.message ?? null,
    ...(result.user ? { user: result.user } : {}),
    ...(result.requiresVerification ? { requiresVerification: true } : {}),
    ...(result.email ? { email: result.email } : {}),
    ...(Number.isFinite(result.retryAfterSeconds) ? { retryAfterSeconds: result.retryAfterSeconds } : {}),
  };
}

function tooMany(res, json) {
  json(res, 429, { ok: false, code: 'RATE_LIMITED', message: 'Too many attempts. Please wait and try again.' });
  return true;
}

function unauthenticated(res, json) {
  json(res, 401, { ok: false, code: 'AUTH_REQUIRED', message: 'Sign in to continue.' });
  return true;
}

function badCsrf(res, json) {
  json(res, 403, { ok: false, code: 'CSRF_INVALID', message: 'Your session expired. Reload and try again.' });
  return true;
}

/** Diagnostics for the owner. Never includes keys or addresses. */
export function mailStatus() {
  return { configured: mailConfigured(), provider: detectProvider() };
}
