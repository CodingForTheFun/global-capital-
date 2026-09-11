// The account gate.
//
// Props are behind a free account. The one rule that matters here: THE GATE
// NEVER ENGAGES UNLESS SOMEONE CAN ACTUALLY GET THROUGH IT. A gate in front of
// a sign-up that cannot complete is not a conversion funnel, it is an outage —
// every visitor would hit a wall with no way past, and the site would look
// dead rather than exclusive.
//
// So `gateActive()` checks for a working way in before it turns anything on,
// and says loudly in the logs when it stands down. Turning the gate off is a
// deliberate REQUIRE_ACCOUNT=false; standing down because sign-up is broken is
// a bug report.

import { googleConfigured } from './google.mjs';
import { isConfigured as mailConfigured } from './mailer.mjs';
import { betaOpenSignup } from './beta.mjs';

// Paths that require an account. Everything else — the API the page calls, the
// assets it loads, the account routes themselves — stays open, or the gate
// would block the very requests the landing page makes to get someone in.
const GATED_PATHS = new Set(['/', '/props', '/props/', '/research', '/research/', '/apex', '/apex/']);

let warned = false;

/** Every way a visitor could create an account right now. */
export function signupPaths(env = process.env) {
  return {
    beta: betaOpenSignup(env),
    google: googleConfigured(),
    email: mailConfigured(),
  };
}

export function signupPossible(env = process.env) {
  return Object.values(signupPaths(env)).some(Boolean);
}

/**
 * Is the gate on?
 *
 * Off when REQUIRE_ACCOUNT is explicitly "false". Otherwise on, but only if
 * sign-up works — and if it does not, that is said once rather than silently
 * leaving the door open or silently locking it.
 */
export function gateActive(env = process.env) {
  if (String(env.REQUIRE_ACCOUNT || '').trim() === 'false') return false;
  if (!signupPossible(env)) {
    if (!warned) {
      warned = true;
      console.error('[gate] REQUIRE_ACCOUNT is on but no sign-up path works (no mail provider, no Google credentials, ACCOUNT_BETA_OPEN not set). Serving props unauthenticated rather than locking everyone out.');
    }
    return false;
  }
  warned = false;
  return true;
}

/** Does this path need an account? */
export function gatedPath(pathname) {
  const path = String(pathname || '');
  if (GATED_PATHS.has(path)) return true;
  // The board's own sub-paths, but never its API or assets.
  return path.startsWith('/apex/') && !path.startsWith('/apex/diagnostics');
}

/** Readiness for the landing page, so it shows only the buttons that work. */
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

export function resetGateWarning() { warned = false; }
