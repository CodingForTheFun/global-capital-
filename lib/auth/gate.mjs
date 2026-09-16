// The account gate.
//
// Props are behind an account. During beta the account is free; when billing is
// enabled later, plan/entitlement checks are applied separately. The security
// rule here is simpler: if account state cannot be proven, the app stays closed.
// A broken signup provider may hurt conversion, but it must never expose the
// private dashboard or prop-data APIs to anonymous visitors.

import { googleConfigured } from './google.mjs';
import { isConfigured as mailConfigured } from './mailer.mjs';
import { betaOpenSignup } from './beta.mjs';

// App pages that require a completed, verified account session.
const GATED_PATHS = new Set([
  '/', '/props', '/props/', '/research', '/research/', '/apex', '/apex/',
  '/apex-next', '/apex-next/', '/app', '/app/',
]);

// The data behind those pages. Gating only the HTML would be cosmetic: anyone
// could call these endpoints directly and rebuild the board without an account.
const GATED_API_PREFIXES = [
  '/api/apex/props',
  '/api/apex/active-props',
  '/api/apex/game-markets',
  '/api/apex/taco-offers',
  '/api/apex/propline',
  '/api/apex/research',
  '/api/apex/line-history',
  '/api/apex-next/props',
  '/api/props/',
];

let warned = null;

/** Every way a visitor could create an account right now. */
export function signupPaths(env = process.env) {
  return {
    beta: betaOpenSignup(env),
    google: googleConfigured(),
    email: mailConfigured(env),
  };
}

export function signupPossible(env = process.env) {
  return Object.values(signupPaths(env)).some(Boolean);
}

function productionLike(env = process.env) {
  const node = String(env.NODE_ENV || '').trim().toLowerCase();
  const railway = String(env.RAILWAY_ENVIRONMENT_NAME || '').trim().toLowerCase();
  return node === 'production' || railway === 'production';
}

function warnOnce(key, message) {
  if (warned === key) return;
  warned = key;
  console.error(message);
}

/**
 * Is the account gate on?
 *
 * Fail closed by default. A signup outage is not permission to expose the app.
 * REQUIRE_ACCOUNT=false is accepted only outside production for local/QA work;
 * production ignores it so a stray deployment variable cannot open the board.
 */
export function gateActive(env = process.env) {
  const explicitlyOff = String(env.REQUIRE_ACCOUNT || '').trim() === 'false';
  if (explicitlyOff && !productionLike(env)) {
    warned = null;
    return false;
  }
  if (explicitlyOff) {
    warnOnce('production-opt-out', '[gate] Ignoring REQUIRE_ACCOUNT=false in production. Oblige Props remains account-gated.');
    return true;
  }
  if (!signupPossible(env)) {
    warnOnce('signup-unavailable', '[gate] No usable signup path is configured. Failing closed: anonymous visitors remain on the account surface until signup is restored.');
    return true;
  }
  warned = null;
  return true;
}

/** Does this page need an account? */
export function gatedPath(pathname) {
  const path = String(pathname || '');
  if (GATED_PATHS.has(path)) return true;
  // The board's own sub-paths. Diagnostics remains an operator/readiness route.
  if (path.startsWith('/apex/') && !path.startsWith('/apex/diagnostics')) return true;
  if (path.startsWith('/apex-next/')) return true;
  return false;
}

/**
 * Does this API path need an account?
 *
 * Deliberately a prefix list rather than "everything under /api". Account
 * routes must answer while signed out, and public health/accuracy claims stay
 * available to the marketing surface.
 */
export function gatedApi(pathname) {
  const path = String(pathname || '');
  if (path.startsWith('/api/account')) return false;
  if (path === '/api/props/accuracy') return false;
  return GATED_API_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** Readiness for the landing page, so it shows only signup buttons that work. */
export function gateHealth(env = process.env) {
  const paths = signupPaths(env);
  return {
    active: gateActive(env),
    // Whether a password form can complete: beta mode needs no mail, and
    // outside beta mode it needs a provider to deliver the code.
    passwordSignup: paths.beta || paths.email,
    googleSignup: paths.google,
    beta: paths.beta,
  };
}

export function resetGateWarning() { warned = null; }
