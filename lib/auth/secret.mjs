// The signing secret for account sessions.
//
// Two processes need the same value: the frontdoor issues the cookie, and the
// legacy Scout server verifies it so a signed-in account reaches its own saved
// props. Deriving it in one place is what keeps them in agreement — if each
// invented its own, sign-in would appear to work and then silently fail on the
// first request the other process handled.
//
// Prefer a configured secret. Failing that, derive a stable value from the
// owner password so sessions survive a restart; a random per-process fallback
// would sign everyone out on every deploy.

import crypto from 'node:crypto';

export function accountSecret(env = process.env) {
  const configured = String(env.DASHBOARD_SESSION_SECRET || env.AUTOPROP_MASTER_KEY || '').trim();
  if (configured) return configured;
  const password = String(env.DASHBOARD_PASSWORD || '').trim();
  return crypto.createHash('sha256').update(`scout-pro:accounts:${password || 'local-only'}`).digest('hex');
}

/** True when the secret is configured rather than derived. */
export function accountSecretConfigured(env = process.env) {
  return Boolean(String(env.DASHBOARD_SESSION_SECRET || env.AUTOPROP_MASTER_KEY || '').trim());
}
