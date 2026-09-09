// Single source of truth for what an end user is allowed to see.
//
// Rule: the dashboard NEVER receives an error string that AutoProp did not
// explicitly author. Browser-automation internals (Playwright call logs,
// locator syntax, selectors, third-party CSS class names), stack traces, file
// paths and Node error codes stay server-side for diagnostics only.
//
// The gate is an allowlist, not a blocklist: an error is shown to the user only
// when it carries an explicit `publicMessage` or a known `code`. Anything else
// collapses to a generic message. That fails closed — a new failure mode we
// have not classified yet leaks nothing.

export const GENERIC_MESSAGE = 'AutoProp could not complete that request. Please try again.';

export const PICKFINDER_SIGN_IN_FAILED = "PickFinder sign-in couldn't be completed. Please reconnect your account and try again.";

// Canonical user-facing copy per error code.
export const PUBLIC_MESSAGES = Object.freeze({
  PICKFINDER_AUTH_UI_CHANGED: PICKFINDER_SIGN_IN_FAILED,
  PICKFINDER_AUTH_BLOCKED: PICKFINDER_SIGN_IN_FAILED,
  PICKFINDER_SIGNIN_FAILED: PICKFINDER_SIGN_IN_FAILED,
  PICKFINDER_RECONNECT: 'PickFinder is not connected. Open Manage PickFinder and reconnect the account.',
  PICKFINDER_LOCKED: 'PickFinder is not fully unlocked. Open Manage PickFinder and reconnect the account.',
  PICKFINDER_INTERACTIVE_AUTH: 'PickFinder needs a verification step completed on its own site. Finish that on PickFinder, then reconnect AutoProp.',
  PICKFINDER_CREDENTIALS_REQUIRED: 'Enter your PickFinder email and password.',
  PICKFINDER_SESSION_UNREADABLE: 'Saved PickFinder connection data could not be read. Reconnect PickFinder and run the scan again.',
  SCAN_OUTPUT_INVALID: 'The scan was blocked by AutoProp data-quality protection. No unverified cards were published.',
  SCAN_ALREADY_RUNNING: 'A scan is already running.',
  REQUEST_INVALID: 'That request could not be processed.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  OWNER_REQUIRED: 'Owner access is required for this action.',
  AUTH_REQUIRED: 'Dashboard authentication required.',
});

// Defence in depth. Anything matching these patterns is treated as internal even
// if a caller mistakenly marks it public, so a bad `publicMessage` still cannot
// leak automation internals.
const INTERNAL_PATTERNS = [
  /locator[.(]/i,
  /getby(role|text|label|placeholder|testid)\s*\(/i,
  /page\.\w+\(|frame\.\w+\(|elementhandle/i,
  /call log:/i,
  /waiting for (locator|selector|element|navigation)/i,
  /intercepts pointer events/i,
  /timeout\s*\d+\s*ms(\s+exceeded)?/i,
  /\bplaywright\b|\bchromium\b|\bpuppeteer\b/i,
  /\bat\s+[\w$.<>]+\s*\(.*:\d+:\d+\)/,          // stack frame
  /\b[\w./-]+\.(mjs|cjs|js|ts):\d+(:\d+)?/,      // file:line
  /\bnode_modules\b|\/app\/|file:\/\//i,
  /\b(err|enoent|eacces|econnrefused|etimedout|epipe)[a-z]*\b(?=\s*[:;]|$)/i,
  /<\s*\w+[^>]*class\s*=/i,                       // raw HTML/class dumps
  /\.cl-[\w-]+|\bcl-[\w-]*modal|\bcss=|\bxpath=|\[data-[\w-]+=/i,
  /\bselector\b|\bsubtree intercepts\b|\bstrict mode violation\b/i,
];

/** True when `text` looks like an internal/automation detail rather than product copy. */
export function looksInternal(text) {
  const value = String(text ?? '');
  if (!value) return false;
  if (value.includes('\n')) return true; // multi-line == call log / stack
  return INTERNAL_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Build an Error that is safe to surface, carrying both the public copy and the
 * underlying cause for server-side diagnostics.
 */
export function safeError(code, publicMessage, { cause = null, ...extra } = {}) {
  const message = publicMessage || PUBLIC_MESSAGES[code] || GENERIC_MESSAGE;
  const error = new Error(message);
  error.code = code;
  error.publicMessage = message;
  if (cause) error.cause = cause;
  return Object.assign(error, extra);
}

/**
 * The only function allowed to produce text for an API response.
 * Returns { message, code } where message is always AutoProp-authored copy.
 */
export function publicError(error, fallback = GENERIC_MESSAGE) {
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(error.code) ? error.code : null;

  const declared = error?.publicMessage;
  if (typeof declared === 'string' && declared.trim() && !looksInternal(declared)) {
    return { message: declared.trim(), code };
  }

  if (code && Object.hasOwn(PUBLIC_MESSAGES, code)) return { message: PUBLIC_MESSAGES[code], code };

  return { message: fallback || GENERIC_MESSAGE, code: null };
}

/** Convenience: just the user-facing string. */
export function publicMessageFor(error, fallback = GENERIC_MESSAGE) {
  return publicError(error, fallback).message;
}

/** Full detail for server logs / DATA_DIR diagnostics. Never sent to a browser. */
export function internalDetail(error, context = {}) {
  return {
    at: new Date().toISOString(),
    ...context,
    name: error?.name || null,
    code: error?.code || null,
    rawMessage: error?.message ? String(error.message).slice(0, 4000) : String(error ?? ''),
    stack: error?.stack ? String(error.stack).slice(0, 8000) : null,
    causeMessage: error?.cause?.message ? String(error.cause.message).slice(0, 4000) : null,
    causeStack: error?.cause?.stack ? String(error.cause.stack).slice(0, 8000) : null,
  };
}

/**
 * Sanitise a stored diagnostic record (last-error.json) for the status API.
 * Reads the persisted record's code/message, never its rawMessage or stack.
 */
export function publicErrorFromRecord(record, fallback = GENERIC_MESSAGE) {
  if (!record) return { message: null, code: null };
  return publicError({ code: record.code, publicMessage: record.publicMessage }, fallback);
}
