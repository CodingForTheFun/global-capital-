// Which model answers a projection request.
//
// The product does not depend on a particular vendor: the model supplies
// judgement, and every number a customer sees is derived in code from that
// judgement plus real prices and the player's own game log. So the provider is
// a configuration choice, and having two means the feature runs on whichever
// key the operator actually holds.
//
// Selection is explicit if PROJECTION_PROVIDER names one, and otherwise falls
// to whichever key is present. Anthropic wins a tie only because the prompt and
// the calibration thresholds were tuned against it; that is a starting default,
// not a claim about the other one.

import * as anthropic from './anthropic.mjs';
import * as gemini from './gemini.mjs';

export const PROVIDERS = Object.freeze({ anthropic, gemini });
const ORDER = ['anthropic', 'gemini'];

/** The provider to use, or null when no key is configured for any of them. */
export function activeProvider(env = process.env) {
  const requested = String(env.PROJECTION_PROVIDER || '').trim().toLowerCase();
  if (requested) {
    const chosen = PROVIDERS[requested];
    // An explicit choice that cannot run is a misconfiguration worth saying
    // out loud, not something to paper over by silently using the other one.
    if (!chosen) {
      console.error(`[projections] unknown PROJECTION_PROVIDER "${requested.slice(0, 20)}"`);
      return null;
    }
    return chosen.configured(env) ? chosen : null;
  }
  for (const id of ORDER) {
    if (PROVIDERS[id].configured(env)) return PROVIDERS[id];
  }
  return null;
}

export function providerName(env = process.env) {
  return activeProvider(env)?.name ?? null;
}

export function configured(env = process.env) {
  return activeProvider(env) !== null;
}

/** Readiness for owner diagnostics. Never includes a key. */
export function providerHealth(env = process.env) {
  const active = activeProvider(env);
  return {
    provider: active?.name ?? null,
    model: active?.model?.(env) ?? null,
    available: Object.fromEntries(ORDER.map((id) => [id, PROVIDERS[id].configured(env)])),
  };
}
