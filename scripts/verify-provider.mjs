#!/usr/bin/env node
// Read-only SportsDataIO entitlement verifier.
// It prints feed names/statuses/row counts only — never keys, auth headers or
// response bodies. Safe to run in Railway where SPORTSDATAIO_API_KEY is set.

import { FEEDS, BASE, TIMEFRAME, leagueFor, formatDate, UNCOVERED_LEAGUES, MAPPABLE_LEAGUES } from '../lib/data-sources/sportsdataio/endpoints.mjs';
import { resolveKey } from '../lib/data-sources/sportsdataio/client.mjs';

const SPORTS = ['NBA', 'NFL', 'MLB', 'NHL', 'WNBA', 'NCAAB', 'NCAAF'];

function explain(status) {
  if (status === 401) return 'KEY_REJECTED';
  if (status === 403) return 'NOT_IN_PLAN';
  if (status === 404) return 'NOT_AVAILABLE';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'PROVIDER_ERROR';
  return `HTTP_${status}`;
}

async function probe(path, apiKey) {
  if (!path) return { ok: false, state: 'NOT_APPLICABLE', rows: null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${BASE}/${path}`, {
      headers: { 'Ocp-Apim-Subscription-Key': apiKey, accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, state: explain(response.status), rows: null, status: response.status };
    const body = await response.json();
    return { ok: true, state: 'OK', rows: Array.isArray(body) ? body.length : (body == null ? 0 : 1), data: body };
  } catch (error) {
    return { ok: false, state: error?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR', rows: null };
  } finally {
    clearTimeout(timer);
  }
}

function scalar(value) {
  if (value == null) return null;
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (typeof value === 'object') return value.ApiSeason ?? value.Season ?? value.Year ?? value.CurrentSeason ?? null;
  return null;
}

const anyKey = SPORTS.some((sport) => Boolean(resolveKey(sport)));
if (!anyKey) {
  console.error('No SportsDataIO key found. Set SPORTSDATAIO_API_KEY in the runtime environment.');
  process.exit(2);
}

const date = formatDate(new Date());
console.log(`SportsDataIO entitlement matrix — ${date}`);
console.log('Legend: OK | NOT_IN_PLAN(403) | NOT_AVAILABLE(404) | KEY_REJECTED(401) | RATE_LIMITED(429)\n');

let okCount = 0;
let rejectedKey = false;
const summary = {};

for (const sport of SPORTS) {
  const league = leagueFor(sport);
  const apiKey = resolveKey(sport);
  if (!league || !apiKey) {
    console.log(`${sport}: SKIPPED (${!league ? 'no adapter mapping' : 'no key'})`);
    continue;
  }

  const seasonProbe = await probe(TIMEFRAME.currentSeason(league), apiKey);
  if (seasonProbe.status === 401) rejectedKey = true;
  let season = seasonProbe.ok ? scalar(seasonProbe.data) : null;
  let week = null;
  if (league.by === 'week') {
    const weekProbe = await probe(TIMEFRAME.currentWeek(league), apiKey);
    if (weekProbe.status === 401) rejectedKey = true;
    week = weekProbe.ok ? scalar(weekProbe.data) : null;
  }
  // Only a fallback for date-addressed seasonal aggregate endpoints. Never
  // guess a football week.
  if (!season && league.by === 'date') season = new Date().getUTCFullYear();

  const params = { date, season, week };
  summary[sport] = {};
  console.log(`${sport}${season ? ` season=${season}` : ''}${week ? ` week=${week}` : ''}`);

  for (const [name, feed] of Object.entries(FEEDS)) {
    if (feed.requires === 'projections' && !league.projections) {
      summary[sport][name] = 'PRODUCT_NOT_OFFERED_FOR_LEAGUE';
      console.log(`  ${name.padEnd(18)} PRODUCT_NOT_OFFERED_FOR_LEAGUE`);
      continue;
    }
    if (Array.isArray(feed.leagues) && !feed.leagues.includes(sport)) {
      summary[sport][name] = 'NOT_APPLICABLE';
      console.log(`  ${name.padEnd(18)} NOT_APPLICABLE`);
      continue;
    }
    const path = feed.build(league, params);
    if (!path) {
      summary[sport][name] = 'TIMEFRAME_UNAVAILABLE';
      console.log(`  ${name.padEnd(18)} TIMEFRAME_UNAVAILABLE`);
      continue;
    }
    const result = await probe(path, apiKey);
    summary[sport][name] = result.state;
    if (result.ok) okCount++;
    if (result.status === 401) rejectedKey = true;
    const rows = result.ok ? ` rows=${result.rows}` : '';
    console.log(`  ${name.padEnd(18)} ${result.state}${rows}`);
  }
  console.log('');
}

console.log(`No mapped SportsDataIO feed: ${UNCOVERED_LEAGUES.join(', ')}`);
console.log(`Known projection-capable but not yet market-mapped: ${MAPPABLE_LEAGUES.join(', ')}`);
console.log('Line movement note: SportsDataIO exposes dedicated Betting Market/Line Changes products; this verifier does not invent an endpoint that is not yet in Scout Pro\'s catalog.');

if (rejectedKey && okCount === 0) {
  console.error('\nSportsDataIO rejected the configured key.');
  process.exit(1);
}
if (okCount === 0) {
  console.error('\nNo currently catalogued feed returned 200. Check subscription scopes above.');
  process.exit(1);
}
console.log(`\nVerification complete: ${okCount} catalogued feed checks returned 200.`);
