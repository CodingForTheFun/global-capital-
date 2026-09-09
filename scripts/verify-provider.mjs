#!/usr/bin/env node
// Verify a SportsDataIO subscription without exposing the key.
//
//   SPORTSDATAIO_API_KEY=... npm run verify:provider
//
// Reports, per league, whether the projections feed answers and how many rows
// it returned today. Prints no key material, and no response bodies.
//
// Run this locally or in a Railway shell. It makes read-only GET requests.

import { createSportsDataIoAdapter, SUPPORTED_LEAGUES, UNSUPPORTED_LEAGUES, formatDate, resolveNflTimeframe } from '../lib/data-sources/sportsdataio.mjs';

const BASE = 'https://azure-api.sportsdata.io/v3';
const PATHS = { NBA: 'nba', MLB: 'mlb', NHL: 'nhl', NFL: 'nfl' };

function keyFor(sport) {
  return process.env[`SPORTSDATAIO_KEY_${sport}`] || process.env.SPORTSDATAIO_API_KEY || '';
}

function explain(status) {
  if (status === 401) return 'key rejected — check the value';
  if (status === 403) return 'key valid, but this feed is not in your plan';
  if (status === 404) return 'endpoint not found for this date/season';
  if (status === 429) return 'rate limited — try again shortly';
  return `HTTP ${status}`;
}

async function probe(url, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      headers: { 'Ocp-Apim-Subscription-Key': apiKey, accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, detail: explain(response.status) };
    const body = await response.json();
    return { ok: true, rows: Array.isArray(body) ? body.length : 1 };
  } catch (error) {
    return { ok: false, detail: error?.name === 'AbortError' ? 'timed out' : 'network error' };
  } finally {
    clearTimeout(timer);
  }
}

const adapter = createSportsDataIoAdapter();
if (!adapter.isConfigured()) {
  console.error('No SportsDataIO key found.');
  console.error('Set SPORTSDATAIO_API_KEY (or SPORTSDATAIO_KEY_NBA etc.) and run again.');
  process.exit(2);
}

const date = formatDate(new Date());
console.log(`SportsDataIO check — projections for ${date}\n`);

let anyOk = false;
for (const sport of SUPPORTED_LEAGUES) {
  const apiKey = keyFor(sport);
  if (!apiKey) { console.log(`  ${sport.padEnd(5)} skipped — no key configured for this league`); continue; }

  let url;
  if (sport === 'NFL') {
    const timeframe = await resolveNflTimeframe(apiKey);
    if (!timeframe) { console.log(`  ${sport.padEnd(5)} FAIL    could not read CurrentSeason/CurrentWeek (scores feed missing from plan?)`); continue; }
    url = `${BASE}/${PATHS[sport]}/projections/json/PlayerGameProjectionStatsByWeek/${timeframe.season}/${timeframe.week}`;
    console.log(`  ${sport.padEnd(5)} season ${timeframe.season}, week ${timeframe.week}`);
  } else {
    url = `${BASE}/${PATHS[sport]}/projections/json/PlayerGameProjectionStatsByDate/${date}`;
  }

  const result = await probe(url, apiKey);
  if (result.ok) {
    anyOk = true;
    const note = result.rows === 0 ? ' (no games scheduled today)' : '';
    console.log(`  ${sport.padEnd(5)} OK      ${result.rows} projection rows${note}`);
  } else {
    console.log(`  ${sport.padEnd(5)} FAIL    ${result.detail}`);
  }
}

console.log(`\n  Not covered by SportsDataIO at all: ${UNSUPPORTED_LEAGUES.join(', ')}`);
console.log('  Props in those leagues will always show un-enriched.\n');

if (!anyOk) {
  console.error('No projections feed responded. Scout Pro will run un-enriched until this is resolved.');
  process.exit(1);
}
console.log('At least one projections feed is live. Set the same key in Railway to enable enrichment.');
