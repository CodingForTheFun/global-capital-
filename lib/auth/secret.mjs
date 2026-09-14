// The signing secret for account sessions.
//
// Two processes need the same value: the frontdoor issues the cookie, and the
// legacy Scout server verifies it so a signed-in account reaches its own saved
// props. Deriving it in one place is what keeps them in agreement — if each
// invented its own, sign-in would appear to work and then silently fail on the
// first request the other process handled.
//
// Prefer a configured secret. Failing that, derive a stable value from the
// owner password so sessions survive a restart. Hosted production must never
// fall back to a public, deterministic "local-only" secret because anyone who
// can read the source could mint valid session signatures.

import crypto from 'node:crypto';

function hostedRuntime(env = process.env) {
  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
  return nodeEnv === 'production'
    || Boolean(String(env.RAILWAY_ENVIRONMENT_ID || env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_PROJECT_ID || '').trim());
}

export function accountSecret(env = process.env) {
  const configured = String(env.DASHBOARD_SESSION_SECRET || env.AUTOPROP_MASTER_KEY || '').trim();
  if (configured) return configured;
  const password = String(env.DASHBOARD_PASSWORD || '').trim();
  if (password) return crypto.createHash('sha256').update(`scout-pro:accounts:${password}`).digest('hex');
  if (hostedRuntime(env)) {
    throw Object.assign(new Error('A production session secret is required.'), { code: 'AUTH_SECRET_REQUIRED' });
  }
  return crypto.createHash('sha256').update('scout-pro:accounts:local-only').digest('hex');
}

/** True when the secret is configured rather than derived. */
export function accountSecretConfigured(env = process.env) {
  return Boolean(String(env.DASHBOARD_SESSION_SECRET || env.AUTOPROP_MASTER_KEY || '').trim());
}
