#!/usr/bin/env node
// Runtime SportsDataIO verification for Scout Pro.
//
// Designed for Railway where SPORTSDATAIO_API_KEY actually exists. It prints
// only feed classifications, row/operator counts and timestamps — never the key,
// auth headers, endpoint URLs, response bodies or individual betting outcomes.
//
// By default this is diagnostic/non-blocking so a missing optional feed cannot
// prevent Scout Pro from deploying with its PickFinder fallback. Set
// VERIFY_PROVIDER_STRICT=1 when you want a non-zero exit for a missing/rejected
// provider configuration.

import { createSportsDataIoAdapter } from '../lib/data-sources/sportsdataio/index.mjs';

const strict = String(process.env.VERIFY_PROVIDER_STRICT || '') === '1';
const adapter = createSportsDataIoAdapter({ log: { log: () => {}, error: () => {} } });

if (!adapter.isConfigured()) {
  console.error('[provider-check] SportsDataIO: not configured');
  process.exit(strict ? 2 : 0);
}

console.log('[provider-check] SportsDataIO runtime verification starting');

const matrix = await adapter.entitlements({ force: true });
const canonical = ['NBA', 'NFL', 'MLB', 'NHL', 'WNBA', 'NCAAB', 'NCAAF'];
const feeds = [
  'projections', 'injuries', 'games', 'playerGameStats',
  'playerSeasonStats', 'teamSeasonStats', 'depthCharts', 'startingLineups',
  'playerProps', 'gameOdds',
];

for (const sport of canonical) {
  const row = matrix?.leagues?.[sport];
  if (!row) {
    console.log(`[provider-check] ${sport}: no entitlement row`);
    continue;
  }
  const parts = feeds.map((feed) => `${feed}=${row.feeds?.[feed] || 'unknown'}`);
  console.log(`[provider-check] ${sport}: ${parts.join(' ')}`);
}

console.log(`[provider-check] configured=${Boolean(matrix?.configured)} keyRejected=${Boolean(matrix?.keyRejected)} discoveredAt=${matrix?.discoveredAt || 'unknown'}`);

// The entitlement pass above caches successful playerProps payloads. This
// operator check therefore normally adds no second provider request for a feed
// that already succeeded.
let coverage = null;
try {
  coverage = await adapter.operatorCoverage({ sportsbook: 'PrizePicks', sports: canonical });
  for (const row of coverage.rows || []) {
    console.log(`[provider-check] PrizePicks ${row.sport}: feedAvailable=${Boolean(row.feedAvailable)} targetSeen=${Boolean(row.targetSeen)} targetOffers=${Number(row.targetOffers || 0)} coreOffers=${Number(row.totalCoreOffers || 0)}`);
  }
  console.log(`[provider-check] PrizePicks leagues=${(coverage.leaguesWithTarget || []).join(',') || 'none'}`);
} catch {
  console.log('[provider-check] PrizePicks operator coverage: unavailable');
}

const stats = adapter.stats?.() || {};
console.log(`[provider-check] requests=${Number(stats.requests || 0)} cacheHits=${Number(stats.hits || 0)} errors=${Number(stats.errors || 0)} deniedFeeds=${Number(stats.deniedFeeds || 0)} rateLimited=${Boolean(stats.rateLimited)}`);

if (strict && (matrix?.keyRejected || !matrix?.configured)) process.exit(1);
console.log('[provider-check] complete');
