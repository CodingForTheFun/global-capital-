// Dashboard identity, roles and rate limiting.
//
// Two roles exist:
//   owner  — unlocked with DASHBOARD_PASSWORD. Full permissions: PickFinder
//            credentials, scanner rules, and access-code administration.
//   member — unlocked with an owner-generated access code. Read/operate the
//            dashboard only. A member token can never name itself `owner`,
//            because the role is derived from the HMAC-signed identity, and the
//            signature covers that identity.
//
// Extracted from the server so the permission model can be unit-tested without
// binding a port or touching Playwright.

import crypto from 'node:crypto';

export const OWNER = 'owner';
export const MEMBER = 'member';
export const SESSION_COOKIE = 'aps_session';
export const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const MEMBER_PREFIX = 'member_';
const ANONYMOUS = Object.freeze({ authenticated: false, role: null, subject: null, reason: 'no-session' });

function denied(reason) {
  return { authenticated: false, role: null, subject: null, reason };
}

export function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
}

/** Normalise an access-code id into something safe for a cookie payload. */
export function encodeSubject(subject) {
  return String(subject ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'invite';
}

export function createSessionCodec({ secret, ttlMs = DEFAULT_TTL_MS, now = Date.now } = {}) {
  if (!secret) throw new Error('createSessionCodec requires a secret.');

  const sign = (payload) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');

  function makeToken(role = OWNER, subject = OWNER) {
    const identity = role === OWNER ? OWNER : `${MEMBER_PREFIX}${encodeSubject(subject)}`;
    const expires = now() + ttlMs;
    const payload = `${identity}.${expires}`;
    return `${payload}.${sign(payload)}`;
  }

  function readToken(token) {
    if (!token) return ANONYMOUS;
    const parts = String(token).split('.');
    if (parts.length !== 3) return denied('malformed');
    const [identity, expiresRaw, signature] = parts;
    const expires = Number(expiresRaw);
    if (!Number.isFinite(expires)) return denied('malformed');
    // Verify the signature before trusting anything else in the token.
    if (!safeEqual(signature, sign(`${identity}.${expiresRaw}`))) return denied('bad-signature');
    if (expires < now()) return denied('expired');
    if (identity === OWNER) return { authenticated: true, role: OWNER, subject: OWNER, reason: null };
    if (identity.startsWith(MEMBER_PREFIX)) {
      const subject = identity.slice(MEMBER_PREFIX.length);
      if (!subject) return denied('malformed');
      return { authenticated: true, role: MEMBER, subject, reason: null };
    }
    return denied('unknown-identity');
  }

  return { makeToken, readToken };
}

export function parseCookies(req) {
  const cookies = {};
  for (const pair of String(req?.headers?.cookie || '').split(';')) {
    const index = pair.indexOf('=');
    if (index < 0) continue;
    const key = pair.slice(0, index).trim();
    if (!key) continue;
    try { cookies[key] = decodeURIComponent(pair.slice(index + 1).trim()); }
    catch { cookies[key] = pair.slice(index + 1).trim(); }
  }
  return cookies;
}

export function cookieHeader(req, token, { ttlMs = DEFAULT_TTL_MS } = {}) {
  const secure = String(req?.headers?.['x-forwarded-proto'] || '').toLowerCase() === 'https';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(ttlMs / 1000)}${secure ? '; Secure' : ''}`;
}

export function clearCookieHeader(req) {
  const secure = String(req?.headers?.['x-forwarded-proto'] || '').toLowerCase() === 'https';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}

/** Capability matrix. Owner-only actions are listed once, here. */
export function permissionsFor(role) {
  const owner = role === OWNER;
  return {
    role: role || null,
    canViewDashboard: Boolean(role),
    canRunScan: Boolean(role),
    canGenerateAccessCodes: owner,
    canRevokeAccessCodes: owner,
    canListAccessCodes: owner,
    canManageConnection: owner,
    canChangeRules: owner,
    canAdministerOwner: owner,
  };
}

/** Fixed-window rate limiter, keyed per client + bucket. */
export function createRateLimiter({ now = Date.now, maxKeys = 5000 } = {}) {
  const buckets = new Map();

  function allow(key, max, windowMs) {
    const time = now();
    const hits = (buckets.get(key) || []).filter((stamp) => time - stamp < windowMs);
    if (hits.length >= max) {
      buckets.set(key, hits);
      return false;
    }
    hits.push(time);
    buckets.set(key, hits);
    if (buckets.size > maxKeys) {
      for (const [existing, stamps] of buckets) {
        if (!stamps.length || time - stamps[stamps.length - 1] > windowMs) buckets.delete(existing);
        if (buckets.size <= maxKeys) break;
      }
    }
    return true;
  }

  return { allow, reset: () => buckets.clear(), size: () => buckets.size };
}

export function clientKey(req, bucket) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const address = forwarded || req?.socket?.remoteAddress || 'unknown';
  return `${bucket}:${address}`;
}
