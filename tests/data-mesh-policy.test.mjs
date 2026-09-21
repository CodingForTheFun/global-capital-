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
