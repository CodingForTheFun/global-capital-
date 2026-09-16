// One route serves all ten PropLine insights. Ten routes would be ten things to
// authenticate, rate limit and keep consistent; one keeps the guards in a single
// place. These tests pin the guards, not the payloads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const frontdoor = readFileSync(new URL('../frontdoor-prod.mjs', import.meta.url), 'utf8');
const gate = readFileSync(new URL('../lib/auth/gate.mjs', import.meta.url), 'utf8');

test('the insights route requires an account', () => {
  // '/api/apex/props' does NOT prefix-match '/api/apex/propline', so without its
  // own entry a visitor could pull paid PropLine data and spend the daily quota
  // without ever creating an account.
  const prefixes = [...gate.matchAll(/'(\/api\/[a-z0-9/-]+)'/g)].map((m) => m[1]);
  assert.ok(prefixes.some((p) => '/api/apex/propline'.startsWith(p)), 'the route must be gated');
});

test('the near-miss that made gating necessary is real, not hypothetical', () => {
  assert.equal('/api/apex/propline'.startsWith('/api/apex/props'), false,
    'if this ever becomes true the separate gate entry can be reconsidered');
});

test('every implemented reader is reachable by kind', () => {
  for (const kind of ['movement', 'best-line', 'ev', 'history', 'closing', 'results', 'trends', 'games', 'context', 'projections']) {
    assert.match(frontdoor, new RegExp(`'?${kind}'?:\\s*\\(insights, q\\)`), `${kind} must be routable`);
  }
});

test('an unknown kind is refused rather than guessed at', () => {
  assert.match(frontdoor, /code: 'UNKNOWN_KIND'/);
});

test('it shares the research rate limit instead of opening an unmetered path', () => {
  const route = frontdoor.slice(frontdoor.indexOf('async function maybeServePropLineInsights'));
  assert.match(route.slice(0, 1500), /researchRateAllowed\(req\)/);
});

test('a missing answer is not an error the page has to handle', () => {
  const route = frontdoor.slice(frontdoor.indexOf('async function maybeServePropLineInsights'));
  assert.match(route.slice(0, 3000), /available: false, data: null/,
    'unconfigured, unsupported and simply-absent all read the same to a customer');
});

test('a thrown reader still answers 200 with available:false', () => {
  const route = frontdoor.slice(frontdoor.indexOf('async function maybeServePropLineInsights'));
  const catchBlock = route.slice(route.indexOf('} catch (error) {'), route.indexOf('} catch (error) {') + 260);
  assert.match(catchBlock, /directJson\(res, 200/, 'enrichment must never break the board that asked for it');
});

test('the route is dispatched', () => {
  assert.match(frontdoor, /if \(await maybeServePropLineInsights\(req, res\)\) return;/);
});

test('a sport is required, since every reader needs one to build a path', () => {
  assert.match(frontdoor, /code: 'SPORT_REQUIRED'/);
});
