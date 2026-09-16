#!/usr/bin/env node
// Production-safe PropLine verification for Oblige Props.
//
// This probe intentionally makes ZERO provider network requests. The production
// Oblige Props process already performs the authenticated PropLine readiness
// check at startup and all live PropLine calls share quota/reserve protection.
// Repeating that request in a standalone Railway probe would spend daily quota
// without improving customer safety.
//
// Instead this verifies the exact production provider-selection contract:
// PropLine must be configured and explicitly promoted to primary. It reports
// only provider/capability metadata and never prints credentials, headers,
// endpoint payloads, player data, betting odds, or customer information.

import { primaryOddsProvider } from '../lib/autoscout/providers/index.mjs';
import { proplineProvider, PROPLINE_SPORTS } from '../lib/autoscout/providers/propline.mjs';

const primary = primaryOddsProvider();
const configured = proplineProvider.isConfigured();
const promoted = primary?.id === 'propline';

if (!configured) {
  console.error('[provider-check] PropLine: NOT_CONFIGURED');
  process.exit(2);
}

if (!promoted) {
  console.error(`[provider-check] PropLine: NOT_PRIMARY current=${String(primary?.id || 'none')}`);
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  provider: 'propline',
  configured: true,
  primary: true,
  mode: 'configuration-only',
  providerNetworkRequests: 0,
  supportedSports: [...PROPLINE_SPORTS],
  capabilities: [...(proplineProvider.capabilities || [])],
}));
