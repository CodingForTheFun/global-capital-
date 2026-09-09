#!/usr/bin/env node
// Production-safe SportsDataIO verification.
// Prints only feed classifications/counts/latency and aggregate operator counts.
// It never prints credentials, request headers, endpoint URLs or raw payloads.

import { createSportsDataIoAdapter } from '../lib/data-sources/sportsdataio/index.mjs';
import { sportsDataIoPropBoard } from '../lib/data-sources/sportsdataio/prop-board.mjs';

const strict = String(process.env.VERIFY_PROVIDER_STRICT || '') === '1';
const adapter = createSportsDataIoAdapter({ log: { log: () => {}, error: () => {} } });

if (!adapter.isConfigured()) {
  console.error('[provider-check] SportsDataIO: NOT_CONFIGURED');
  process.exit(strict ? 2 : 0);
}

console.log('[provider-check] SportsDataIO runtime verification');
console.log('SPORT | FEED | STATUS | RECORDS | LATENCY | ERROR');

const matrix = await adapter.entitlements({ force: true });
const rows = Array.isArray(matrix?.capabilities) ? matrix.capabilities : [];
for (const row of rows) {
  const status = row.status ?? 0;
  const count = row.recordCount ?? 0;
  const latency = row.latencyMs ?? 0;
  console.log(`${row.sport} | ${row.feed} | ${status} | ${count} | ${latency}ms | ${row.errorType || 'UNKNOWN'}`);
}

console.log(`[provider-check] configured=${Boolean(matrix?.configured)} keyRejected=${Boolean(matrix?.keyRejected)} discoveredAt=${matrix?.discoveredAt || 'unknown'}`);

try {
  const board = await sportsDataIoPropBoard.fetchBoard({ force: true });
  console.log(`[provider-check] player-prop board totalOffers=${Number(board.offers?.length || 0)} latency=${Number(board.latencyMs || 0)}ms`);
  for (const row of board.coverage || []) {
    console.log(`[provider-check] prop-board ${row.sport}: status=${row.status || 0} games=${row.gamesChecked || 0} offers=${row.offerCount || 0} error=${row.errorType || 'OK'}`);
  }
} catch {
  console.log('[provider-check] player-prop board unavailable');
}

try {
  const coverage = await adapter.operatorCoverage({ sportsbook: 'PrizePicks' });
  for (const row of coverage.rows || []) {
    console.log(`[provider-check] PrizePicks ${row.sport}: feed=${Boolean(row.feedAvailable)} games=${Number(row.gamesChecked || 0)} seen=${Boolean(row.targetSeen)} offers=${Number(row.targetOffers || 0)} totalCore=${Number(row.totalCoreOffers || 0)}`);
  }
  console.log(`[provider-check] PrizePicks leagues=${(coverage.leaguesWithTarget || []).join(',') || 'none'}`);
} catch {
  console.log('[provider-check] PrizePicks coverage unavailable');
}

const stats = adapter.stats?.() || {};
console.log(`[provider-check] requests=${Number(stats.requests || 0)} cacheHits=${Number(stats.hits || 0)} errors=${Number(stats.errors || 0)} deniedFeeds=${Number(stats.deniedFeeds || 0)} rateLimited=${Boolean(stats.rateLimited)}`);

if (strict && (matrix?.keyRejected || !matrix?.configured)) process.exit(1);
console.log('[provider-check] complete');
