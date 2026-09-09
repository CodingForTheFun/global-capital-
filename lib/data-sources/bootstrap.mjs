// Registers Scout Pro's data providers. Imported once by each server at start.
//
// Registration is idempotent and never throws: a provider that cannot be
// constructed is skipped and logged, because a provider problem must never stop
// the server from booting.

import { registerProvider, listProviders, providerStatus } from './registry.mjs';
import { createSportsDataIoAdapter, isConfigured } from './sportsdataio/index.mjs';

let started = false;

export function bootstrapProviders({ log = console } = {}) {
  if (started) return providerStatus();
  started = true;
  try {
    if (!listProviders().some((adapter) => adapter.id === 'sportsdataio')) {
      registerProvider(createSportsDataIoAdapter({ log }));
      log?.log?.(`[AutoProp providers] SportsDataIO registered (${isConfigured() ? 'configured' : 'no key set — props will run un-enriched'})`);
    }
  } catch (error) {
    log?.error?.('[AutoProp providers] SportsDataIO could not be registered', String(error?.message || error).slice(0, 200));
  }
  return providerStatus();
}

export { providerStatus };
