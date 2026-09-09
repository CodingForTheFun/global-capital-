// Provider registry and honest status reporting.
//
// The dashboard shows exactly what is and is not connected. A provider that is
// unconfigured, failing or stale is reported as such — Scout Pro never presents
// enriched-looking data it did not actually receive.
//
// Status is derived, never hand-written, so it cannot drift from reality.

import { validateAdapter } from './contract.mjs';

export const PROVIDER_STATUS = Object.freeze({
  ACTIVE: 'active',                 // configured and last call succeeded
  NOT_CONFIGURED: 'not-configured', // no credentials present
  UNAVAILABLE: 'unavailable',       // configured but the last call failed
  INVALID: 'invalid',               // adapter does not satisfy the contract
});

const adapters = new Map();
const health = new Map();

export function registerProvider(adapter) {
  const problems = validateAdapter(adapter);
  if (problems.length) {
    throw new Error(`Provider "${adapter?.id || 'unknown'}" does not satisfy the adapter contract: ${problems.join('; ')}`);
  }
  adapters.set(adapter.id, adapter);
  if (!health.has(adapter.id)) health.set(adapter.id, { lastOkAt: null, lastFailAt: null, lastDurationMs: null, consecutiveFailures: 0 });
  return adapter;
}

export function unregisterProvider(id) {
  adapters.delete(id);
  health.delete(id);
}

export function listProviders() {
  return [...adapters.values()];
}

export function getProvider(id) {
  return adapters.get(id) || null;
}

export function recordSuccess(id, durationMs) {
  const row = health.get(id) || {};
  health.set(id, { ...row, lastOkAt: new Date().toISOString(), lastDurationMs: durationMs ?? null, consecutiveFailures: 0 });
}

export function recordFailure(id) {
  const row = health.get(id) || {};
  health.set(id, { ...row, lastFailAt: new Date().toISOString(), consecutiveFailures: Number(row.consecutiveFailures || 0) + 1 });
}

function statusFor(adapter) {
  const row = health.get(adapter.id) || {};
  if (validateAdapter(adapter).length) return PROVIDER_STATUS.INVALID;
  let configured = false;
  try { configured = adapter.isConfigured() === true; } catch { configured = false; }
  if (!configured) return PROVIDER_STATUS.NOT_CONFIGURED;
  if (Number(row.consecutiveFailures || 0) > 0) return PROVIDER_STATUS.UNAVAILABLE;
  return PROVIDER_STATUS.ACTIVE;
}

/**
 * Provider status for the dashboard and diagnostics.
 * Deliberately contains no credentials, endpoints, keys or header values.
 */
export function providerStatus() {
  return listProviders().map((adapter) => {
    const row = health.get(adapter.id) || {};
    const status = statusFor(adapter);
    return {
      id: adapter.id,
      name: adapter.name,
      status,
      capabilities: [...(adapter.capabilities || [])],
      lastOkAt: row.lastOkAt || null,
      lastFailAt: row.lastFailAt || null,
      lastDurationMs: row.lastDurationMs ?? null,
      consecutiveFailures: Number(row.consecutiveFailures || 0),
      // What the user should understand, without implementation detail.
      message: {
        [PROVIDER_STATUS.ACTIVE]: 'Connected.',
        [PROVIDER_STATUS.NOT_CONFIGURED]: 'Not connected. Add this provider’s credentials to enable its data.',
        [PROVIDER_STATUS.UNAVAILABLE]: 'Connected but not responding. Showing data without it.',
        [PROVIDER_STATUS.INVALID]: 'This provider is misconfigured and has been disabled.',
      }[status],
    };
  });
}

/** Which enrichment fields are genuinely obtainable right now. */
export function activeCapabilities() {
  const fields = new Set();
  for (const row of providerStatus()) {
    if (row.status !== PROVIDER_STATUS.ACTIVE) continue;
    for (const capability of row.capabilities) fields.add(capability);
  }
  return [...fields];
}

/** Test seam. */
export function resetProviders() {
  adapters.clear();
  health.clear();
}
