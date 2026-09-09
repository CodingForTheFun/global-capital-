#!/usr/bin/env node
// Verify a SportsDataIO subscription without exposing the key.
//
//   SPORTSDATAIO_API_KEY=... npm run verify:provider
//
// Reports, per league, whether the projections feed answers and how many rows
// it returned today. Prints no key material, and no response bodies.
//
// Run this locally or in a Railway shell. It makes read-only GET requests.

import { createSportsDataIoAdapter, PROJECTION_LEAGUES, UNCOVERED_LEAGUES, formatDate } from '../lib/data-sources/sportsdataio/index.mjs';
import { createClient, resolveKey } from '../lib/data-sources/sportsdataio/client.mjs';
import { BASE, TIMEFRAME, leagueFor } from '../lib/data-sources/sportsdataio/endpoints.mjs';

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
for (const sport of PROJECTION_LEAGUES) {
  const apiKey = resolveKey(sport);
  if (!apiKey) { console.log(`  ${sport.padEnd(5)} skipped — no key configured for this league`); continue; }

  let url;
  if (sport === 'NFL') {
    const league = leagueFor(sport);
    const client = createClient();
    const [season, week] = await Promise.all([
      client.get(`${BASE}/${TIMEFRAME.currentSeason(league)}`, 'season', { sport }),
      client.get(`${BASE}/${TIMEFRAME.currentWeek(league)}`, 'week', { sport }),
    ]);
    if (!season.ok || !week.ok) { console.log(`  ${sport.padEnd(5)} FAIL    could not read CurrentSeason/CurrentWeek (${season.reason || week.reason})`); continue; }
    const timeframe = { season: season.data, week: week.data };
    url = `${BASE}/${league.path}/projections/json/PlayerGameProjectionStatsByWeek/${timeframe.season}/${timeframe.week}`;
    console.log(`  ${sport.padEnd(5)} season ${timeframe.season}, week ${timeframe.week}`);
  } else {
    url = `${BASE}/${leagueFor(sport).path}/projections/json/PlayerGameProjectionStatsByDate/${date}`;
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

console.log(`\n  No SportsDataIO feed at all: ${UNCOVERED_LEAGUES.join(', ')}`);
console.log('  Props in those leagues will always show un-enriched.\n');

if (!anyOk) {
  console.error('No projections feed responded. Scout Pro will run un-enriched until this is resolved.');
  process.exit(1);
}
console.log('At least one projections feed is live. Set the same key in Railway to enable enrichment.');
