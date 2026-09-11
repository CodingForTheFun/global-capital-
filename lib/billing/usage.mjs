// Daily usage counters for the paid endpoints.
//
// An entitlement that nothing checks is decoration, so this is what makes the
// plan limits real. Counting happens in process memory: these are spend caps
// on a model call, not a billing ledger, and a restart resetting them costs at
// most a handful of extra calls. Persisting a write per prediction would buy
// accuracy nobody can see and add a failure mode to the request path.
//
// Buckets are UTC days so "per day" means the same thing for every user and
// the reset time is predictable rather than per-account drift.

const counters = new Map();
const MAX_KEYS = 20_000;

export function dayKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function prune(day) {
  if (counters.size <= MAX_KEYS) return;
  for (const key of counters.keys()) if (!key.endsWith(`|${day}`)) counters.delete(key);
  // Still full after dropping old days: the current day alone is oversized, so
  // drop the oldest insertions rather than letting the map grow without bound.
  if (counters.size > MAX_KEYS) {
    let excess = counters.size - MAX_KEYS;
    for (const key of counters.keys()) { counters.delete(key); if (--excess <= 0) break; }
  }
}

/**
 * Record one use and report whether it was allowed.
 *
 * The count is only incremented when the call is allowed, so a user who hits
 * the wall is not pushed further from the reset by retrying.
 */
export function consume({ subject, action, limit, now = Date.now() } = {}) {
  const max = Number(limit);
  if (!Number.isFinite(max) || max <= 0) {
    return { allowed: false, used: 0, limit: Number.isFinite(max) ? max : 0, remaining: 0 };
  }
  const day = dayKey(now);
  const key = `${action}:${subject || 'anonymous'}|${day}`;
  const used = counters.get(key) || 0;
  if (used >= max) return { allowed: false, used, limit: max, remaining: 0 };
  counters.set(key, used + 1);
  prune(day);
  return { allowed: true, used: used + 1, limit: max, remaining: max - used - 1 };
}

/** Read a count without spending one. */
export function peek({ subject, action, limit, now = Date.now() } = {}) {
  const max = Number(limit) || 0;
  const used = counters.get(`${action}:${subject || 'anonymous'}|${dayKey(now)}`) || 0;
  return { used, limit: max, remaining: Math.max(0, max - used) };
}

/** Test seam. */
export function resetUsage() { counters.clear(); }
