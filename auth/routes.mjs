import {
  AuthError, registerAccount, resendCode, verifyEmail, login, logout,
  forgotPassword, resetPassword, changePassword, updateProfile,
  resolveSession, authStatus, isValidEmail, maskEmailAddress,
} from './identity.mjs';
import { supabaseConfig } from '../db/supabase.mjs';
import { mailerConfig } from './mailer.mjs';
import { passwordScore, checkPasswordPolicy, MIN_PASSWORD_LENGTH } from './passwords.mjs';

export const SESSION_COOKIE = 'aps_sid';
const LEGACY_COOKIE = 'aps_session';
const SESSION_MAX_AGE_DAYS = Number(process.env.AUTH_SESSION_DAYS || 30);
const MINUTE = 60 * 1000;

const rateBuckets = new Map();

export function json(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, max-age=0',
    'content-length': Buffer.byteLength(body),
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  });
  res.end(body);
}

export function parseCookies(req) {
  const cookies = {};
  for (const pair of String(req.headers.cookie || '').split(';')) {
    const index = pair.indexOf('=');
    if (index < 0) continue;
    cookies[pair.slice(0, index).trim()] = decodeURIComponent(pair.slice(index + 1).trim());
  }
  return cookies;
}

const isSecure = (req) => String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';

function setCookie(req, value, { remember = true } = {}) {
  const secure = isSecure(req) ? '; Secure' : '';
  const age = remember ? `; Max-Age=${SESSION_MAX_AGE_DAYS * 24 * 60 * 60}` : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax${age}${secure}`;
}
function clearCookie(req, name) {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecure(req) ? '; Secure' : ''}`;
}

export function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim() || null;
}
const clientAgent = (req) => String(req.headers['user-agent'] || '').slice(0, 250) || null;

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === String(req.headers['x-forwarded-host'] || req.headers.host || ''); }
  catch { return false; }
}

function allowRate(req, bucket, max, windowMs) {
  const key = `${bucket}:${clientIp(req) || 'unknown'}`;
  const now = Date.now();
  const rows = (rateBuckets.get(key) || []).filter((time) => now - time < windowMs);
  if (rows.length >= max) {
    rateBuckets.set(key, rows);
    return { ok: false, retryAfterSeconds: Math.ceil((windowMs - (now - rows[0])) / 1000) };
  }
  rows.push(now);
  rateBuckets.set(key, rows);
  return { ok: true };
}

async function readBody(req, limit = 16_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new AuthError('Request body is too large.', { status: 413, code: 'BODY_TOO_LARGE' });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AuthError('Invalid JSON request.', { status: 400, code: 'BAD_JSON' }); }
}

function fail(res, error) {
  if (error instanceof AuthError) {
    return json(res, error.status, {
      ok: false,
      code: error.code,
      message: error.message,
      details: error.details || undefined,
      retryAfterSeconds: error.retryAfterSeconds || undefined,
    }, error.retryAfterSeconds ? { 'retry-after': String(error.retryAfterSeconds) } : {});
  }
  console.error('[auth route error]', error?.stack || error?.message || error);
  return json(res, 500, { ok: false, code: 'SERVER_ERROR', message: 'Something went wrong. Try again.' });
}

function guard(req, res, bucket, max, windowMs) {
  if (!sameOrigin(req)) {
    json(res, 403, { ok: false, code: 'CROSS_ORIGIN', message: 'Cross-origin request rejected.' });
    return false;
  }
  const limit = allowRate(req, bucket, max, windowMs);
  if (!limit.ok) {
    json(res, 429, {
      ok: false, code: 'RATE_LIMITED',
      message: 'Too many attempts from this network. Try again shortly.',
      retryAfterSeconds: limit.retryAfterSeconds,
    }, { 'retry-after': String(limit.retryAfterSeconds) });
    return false;
  }
  return true;
}

// Resolves the caller. Callers must pass `auth.cookie` back through
// `refreshHeaders` so a silently rotated Supabase token reaches the browser.
export async function authenticate(req) {
  const raw = parseCookies(req)[SESSION_COOKIE];
  if (!raw) return null;
  return resolveSession(raw);
}

export function refreshHeaders(req, auth) {
  return auth?.cookie ? { 'set-cookie': setCookie(req, auth.cookie) } : {};
}

export async function requireUser(req, res) {
  const auth = await authenticate(req);
  if (!auth) {
    json(res, 401, { ok: false, code: 'UNAUTHENTICATED', message: 'Sign in to continue.', authRequired: true });
    return null;
  }
  return auth;
}

export async function requireAdmin(req, res) {
  const auth = await requireUser(req, res);
  if (!auth) return null;
  if (!auth.user?.isAdmin) {
    json(res, 403, { ok: false, code: 'FORBIDDEN', message: 'This action is limited to admins.' }, refreshHeaders(req, auth));
    return null;
  }
  return auth;
}

export async function handleAuthRequest(req, res, url) {
  if (!url.pathname.startsWith('/api/auth/')) return false;
  const route = url.pathname;
  const method = req.method;

  try {
    if (route === '/api/auth/config' && method === 'GET') {
      const supabase = supabaseConfig();
      const mailer = mailerConfig();
      json(res, 200, {
        ok: true,
        provider: 'supabase',
        configured: supabase.configured,
        signupEnabled: String(process.env.AUTH_ALLOW_SIGNUP || 'true').toLowerCase() !== 'false',
        minPasswordLength: MIN_PASSWORD_LENGTH,
        codeLength: 6,
        alertEmailProvider: mailer.provider,
        alertEmailConfigured: mailer.configured,
      });
      return true;
    }

    if (route === '/api/auth/session' && method === 'GET') {
      const auth = await authenticate(req);
      json(res, 200, {
        ok: true,
        authenticated: Boolean(auth),
        user: auth?.user || null,
      }, refreshHeaders(req, auth));
      return true;
    }

    // Legacy shape so a stale cached bundle still redirects instead of hanging.
    if (route === '/api/auth/status' && method === 'GET') {
      const auth = await authenticate(req);
      json(res, 200, {
        required: true,
        authenticated: Boolean(auth),
        accounts: true,
        user: auth?.user || null,
      }, refreshHeaders(req, auth));
      return true;
    }

    if (route === '/api/auth/password-strength' && method === 'POST') {
      if (!guard(req, res, 'auth-strength', 60, 5 * MINUTE)) return true;
      const body = await readBody(req, 4_000);
      const policy = checkPasswordPolicy(body.password, { email: body.email, displayName: body.displayName });
      json(res, 200, { ok: true, score: passwordScore(body.password), acceptable: policy.ok, issues: policy.issues });
      return true;
    }

    if (route === '/api/auth/register' && method === 'POST') {
      if (!guard(req, res, 'auth-register', 6, 15 * MINUTE)) return true;
      if (String(process.env.AUTH_ALLOW_SIGNUP || 'true').toLowerCase() === 'false') {
        throw new AuthError('New sign-ups are closed on this deployment.', { status: 403, code: 'SIGNUP_DISABLED' });
      }
      const body = await readBody(req);
      const result = await registerAccount({
        email: body.email, password: body.password, displayName: body.displayName,
      });
      json(res, 201, {
        ok: true,
        status: result.status,
        email: result.email,
        maskedEmail: result.maskedEmail || maskEmailAddress(result.email),
        autoConfirmed: Boolean(result.autoConfirmed),
      });
      return true;
    }

    if (route === '/api/auth/resend-code' && method === 'POST') {
      if (!guard(req, res, 'auth-resend', 6, 15 * MINUTE)) return true;
      const body = await readBody(req, 4_000);
      json(res, 200, await resendCode({ email: body.email, type: body.type === 'recovery' ? 'recovery' : 'signup' }));
      return true;
    }

    if (route === '/api/auth/verify-email' && method === 'POST') {
      if (!guard(req, res, 'auth-verify', 15, 15 * MINUTE)) return true;
      const body = await readBody(req, 4_000);
      const result = await verifyEmail({
        email: body.email, code: body.code, ip: clientIp(req), userAgent: clientAgent(req),
      });
      json(res, 200, { ok: true, user: result.user }, {
        'set-cookie': setCookie(req, result.cookie, { remember: body.remember !== false }),
      });
      return true;
    }

    if (route === '/api/auth/login' && method === 'POST') {
      if (!guard(req, res, 'auth-login', 12, 15 * MINUTE)) return true;
      const body = await readBody(req, 4_000);
      const result = await login({
        email: body.email, password: body.password, ip: clientIp(req), userAgent: clientAgent(req),
      });
      json(res, 200, { ok: true, user: result.user }, {
        'set-cookie': [
          setCookie(req, result.cookie, { remember: body.remember !== false }),
          clearCookie(req, LEGACY_COOKIE),
        ],
      });
      return true;
    }

    if (route === '/api/auth/logout' && method === 'POST') {
      if (!sameOrigin(req)) { json(res, 403, { ok: false, message: 'Cross-origin request rejected.' }); return true; }
      const auth = await authenticate(req);
      if (auth) await logout(auth.envelope);
      json(res, 200, { ok: true }, {
        'set-cookie': [clearCookie(req, SESSION_COOKIE), clearCookie(req, LEGACY_COOKIE)],
      });
      return true;
    }

    if (route === '/api/auth/forgot-password' && method === 'POST') {
      if (!guard(req, res, 'auth-forgot', 6, 15 * MINUTE)) return true;
      const body = await readBody(req, 4_000);
      json(res, 200, await forgotPassword({ email: body.email }));
      return true;
    }

    if (route === '/api/auth/reset-password' && method === 'POST') {
      if (!guard(req, res, 'auth-reset', 12, 15 * MINUTE)) return true;
      const body = await readBody(req, 4_000);
      const result = await resetPassword({
        email: body.email, code: body.code, password: body.password,
        ip: clientIp(req), userAgent: clientAgent(req),
      });
      json(res, 200, { ok: true, user: result.user }, { 'set-cookie': setCookie(req, result.cookie) });
      return true;
    }

    // --- authenticated -----------------------------------------------------
    const auth = await requireUser(req, res);
    if (!auth) return true;
    const headers = refreshHeaders(req, auth);

    if (route === '/api/auth/change-password' && method === 'POST') {
      if (!guard(req, res, 'auth-change', 10, 15 * MINUTE)) return true;
      const body = await readBody(req, 4_000);
      await changePassword({
        envelope: auth.envelope,
        email: auth.user.email,
        currentPassword: body.currentPassword,
        password: body.password,
      });
      json(res, 200, { ok: true, message: 'Password updated.' }, headers);
      return true;
    }

    if (route === '/api/auth/profile' && (method === 'PUT' || method === 'POST')) {
      if (!guard(req, res, 'auth-profile', 20, 15 * MINUTE)) return true;
      const body = await readBody(req, 4_000);
      const result = await updateProfile({
        envelope: auth.envelope, userId: auth.user.id, displayName: body.displayName,
      });
      json(res, 200, { ok: true, displayName: result.displayName }, headers);
      return true;
    }

    if (route === '/api/auth/diagnostics' && method === 'GET') {
      if (!auth.user.isAdmin) {
        json(res, 403, { ok: false, code: 'FORBIDDEN', message: 'This action is limited to admins.' }, headers);
        return true;
      }
      json(res, 200, { ok: true, auth: authStatus() }, headers);
      return true;
    }

    json(res, 404, { ok: false, code: 'NOT_FOUND', message: 'Unknown auth endpoint.' }, headers);
    return true;
  } catch (error) {
    fail(res, error);
    return true;
  }
}

export { isValidEmail, readBody, sameOrigin, guard, fail };
