import test from 'node:test';
import assert from 'node:assert/strict';

import { MESH_CAPABILITIES, meshPolicy, meshProviderConfiguration } from '../lib/autoscout/data-mesh-policy.mjs';
import { SPORTRADAR_TRIAL_PRODUCTS } from '../lib/data-sources/sportradar/trial-products.mjs';

test('mesh keeps current quotes on paid verified providers only', () => {
  const policy = meshPolicy({
    SPORTS_ODDS_API_KEY_HEADER: 'sgo',
    PROPLINE_API_KEY: 'pl',
    SPORTRADAR_API_KEY: 'sr',
    CLEARSPORTS_API_KEY: 'clear',
  });
  assert.equal(policy.quotePrimary, 'sportsgameodds');
  assert.deepEqual(policy.quoteFallbacks, ['propline']);
  assert.equal(policy.quoteOverwrite.propline, false);
  assert.equal(policy.publicFeedRole, 'off');
  assert.equal(policy.noFabrication, true);
  assert.deepEqual(MESH_CAPABILITIES.quotes, ['sportsgameodds','propline']);
});

test('SportsDataIO can only enter the mesh as explicitly research-only', () => {
  assert.equal(meshProviderConfiguration({ SPORTSDATAIO_API_KEY: 'trial' }).sportsdataioResearch, false);
  assert.equal(meshProviderConfiguration({
    SPORTSDATAIO_API_KEY: 'trial',
    AUTOSCOUT_SPORTSDATAIO_RESEARCH_ONLY: 'true',
  }).sportsdataioResearch, true);
  assert.ok(!MESH_CAPABILITIES.quotes.some((value) => value.includes('sportsdataio')));
});

test('Sportradar trial registry covers the account products without odds-player-props', () => {
  const ids = Object.keys(SPORTRADAR_TRIAL_PRODUCTS);
  for (const required of [
    'nba','wnba','nfl','mlb','nhl','ncaafb','ncaamh','soccer','soccerExtended',
    'tennis','tableTennis','globalIceHockey','australianRules','golf','darts','badminton',
    'synergyNbaBase','synergyNbaAdvanced','synergyWnbaBase','synergyWnbaAdvanced',
  ]) assert.ok(ids.includes(required), required);
  assert.ok(!ids.some((id) => id.includes('playerProps')));
});

// The mesh policy is published in the health payload beside `configured`, which
// is read from the environment and true. Every other field is a hand-written
// description, and five of them have no consumer anywhere in the tree —
// `quoteOverwrite: { sportsgameodds: true }` was read as an active merge rule
// and reasoned about as a risk to customer-facing lines before anyone checked.
// `advisory` says which half is which so the next reader does not repeat that.
test('the policy declares which of its fields nothing enforces', () => {
  const policy = meshPolicy({});
  assert.ok(Array.isArray(policy.advisory) && policy.advisory.length > 0);
  for (const field of policy.advisory) {
    assert.ok(field in policy, `advisory names "${field}", which the policy does not publish`);
  }
  // These are read, so claiming they are advisory would be its own false note.
  for (const enforced of ['configured', 'quotePrimary', 'quoteFallbacks', 'mode', 'advisory']) {
    assert.equal(policy.advisory.includes(enforced), false, `${enforced} is read and must not be listed as advisory`);
  }
  assert.equal(policy.advisory.includes('quoteOverwrite'), true);
  assert.equal(policy.advisory.includes('capabilities'), true);
});
