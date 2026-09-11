// Google sign-in (OAuth 2.0 authorization code flow).
//
// Dormant until GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and a redirect URI are
// configured — there is nothing to fake here, and a half-configured OAuth flow
// that silently signs people in would be worse than one that plainly says it
// is off.
//
// Three things this does that a naive implementation skips, all of them the
// difference between "works" and "safe":
//
//   • state is signed and carries an expiry, so the callback can prove the
//     request began here. Without it, anyone can hand a user a crafted callback
//     URL and log them into an account of the attacker's choosing.
//   • The code is exchanged server-side with the client secret. The secret
//     never reaches the browser.
//   • Only a verified Google email is accepted. An unverified one can be any
//     address the account holder typed, so trusting it would let someone claim
//     an address they do not own — and this app links accounts by email.

import crypto from 'node:crypto';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
const STATE_TTL_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

const text = (value) => String(value ?? '').trim();

export function googleConfig() {
  const clientId = text(process.env.GOOGLE_CLIENT_ID);
  const clientSecret = text(process.env.GOOGLE_CLIENT_SECRET);
  const redirectUri = text(process.env.GOOGLE_REDIRECT_URI);
  return {
    enabled: Boolean(clientId && clientSecret && redirectUri),
    clientId: clientId || null,
    clientSecret: clientSecret || null,
    redirectUri: redirectUri || null,
  };
}

export const googleConfigured = () => googleConfig().enabled;

/** Public readiness only — never leaks the client id or the secret. */
export function googleHealth() {
  const config = googleConfig();
  return {
    available: config.enabled,
    missing: config.enabled ? [] : [
      !config.clientId && 'GOOGLE_CLIENT_ID',
      !config.clientSecret && 'GOOGLE_CLIENT_SECRET',
      !config.redirectUri && 'GOOGLE_REDIRECT_URI',
    ].filter(Boolean),
  };
}

/**
 * A signed, expiring state token.
 *
 * `nonce.expiry.signature` — the signature covers both, so neither can be
 * edited, and an old state cannot be replayed once it expires.
 */
export function issueState(secret, { now = Date.now(), ttlMs = STATE_TTL_MS } = {}) {
  if (!secret) throw new Error('issueState requires a secret.');
  const payload = `${crypto.randomBytes(16).toString('base64url')}.${now + ttlMs}`;
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyState(state, secret, { now = Date.now() } = {}) {
  const parts = text(state).split('.');
  if (parts.length !== 3 || !secret) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const given = Buffer.from(parts[2]);
  const want = Buffer.from(expected);
  // Constant-time compare: a fast-fail comparison leaks where it diverged.
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return false;
  const expiry = Number(parts[1]);
  return Number.isFinite(expiry) && expiry > now;
}

/** Where to send the browser to begin sign-in. */
export function authorizeUrl(state) {
  const config = googleConfig();
  if (!config.enabled) return null;
  const query = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    // Ask for an account chooser rather than silently reusing a session: on a
    // shared machine the silent path signs in whoever used it last.
    prompt: 'select_account',
  });
  return `${AUTH_ENDPOINT}?${query}`;
}

/**
 * Exchange the callback code for the signed-in user's verified identity.
 *
 * Returns `{ ok: false, code }` rather than throwing, so the route can render a
 * generic failure without a provider error reaching the browser.
 */
export async function exchangeCode(code, { fetchImpl = (...args) => fetch(...args) } = {}) {
  const config = googleConfig();
  if (!config.enabled) return { ok: false, code: 'GOOGLE_NOT_CONFIGURED' };
  if (!text(code)) return { ok: false, code: 'GOOGLE_NO_CODE' };

  let tokenResponse;
  try {
    tokenResponse = await fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        code: text(code),
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, code: 'GOOGLE_UNREACHABLE' };
  }
  if (!tokenResponse.ok) return { ok: false, code: 'GOOGLE_EXCHANGE_FAILED' };

  const tokens = await tokenResponse.json().catch(() => null);
  const accessToken = text(tokens?.access_token);
  if (!accessToken) return { ok: false, code: 'GOOGLE_NO_TOKEN' };

  let profileResponse;
  try {
    profileResponse = await fetchImpl(USERINFO_ENDPOINT, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, code: 'GOOGLE_UNREACHABLE' };
  }
  if (!profileResponse.ok) return { ok: false, code: 'GOOGLE_PROFILE_FAILED' };

  const profile = await profileResponse.json().catch(() => null);
  const email = text(profile?.email).toLowerCase();
  // Google returns email_verified as a boolean or the string "true" depending
  // on the endpoint; accept either, and nothing else.
  const verified = profile?.email_verified === true || profile?.email_verified === 'true';
  if (!email) return { ok: false, code: 'GOOGLE_NO_EMAIL' };
  if (!verified) return { ok: false, code: 'GOOGLE_EMAIL_UNVERIFIED' };

  return {
    ok: true,
    email,
    name: text(profile?.name).slice(0, 80) || null,
    subject: text(profile?.sub) || null,
  };
}
