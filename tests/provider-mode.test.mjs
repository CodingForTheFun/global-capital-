import test from 'node:test';
import assert from 'node:assert/strict';

import {
  proplineGet,
  proplineTrafficEnabled,
} from '../lib/data-sources/propline/client.mjs';
import { startProplineFreshnessMonitor } from '../lib/data-sources/propline/full.mjs';

test('provider switch words disable all PropLine traffic in RADAR and SGO modes', () => {
  assert.equal(proplineTrafficEnabled({ OBLIGE_PROP_PROVIDER_MODE: 'RADAR' }), false);
  assert.equal(proplineTrafficEnabled({ OBLIGE_PROP_PROVIDER_MODE: 'sportradar' }), false);
  assert.equal(proplineTrafficEnabled({ OBLIGE_PROP_PROVIDER_MODE: 'SGO' }), false);
  assert.equal(proplineTrafficEnabled({ OBLIGE_PROP_PROVIDER_MODE: 'sportsgameodds' }), false);
  assert.equal(proplineTrafficEnabled({ OBLIGE_PROP_PROVIDER_MODE: 'LINE' }), true);
  assert.equal(proplineTrafficEnabled({ OBLIGE_PROP_PROVIDER_MODE: 'propline' }), true);
  assert.equal(proplineTrafficEnabled({ OBLIGE_PROP_PROVIDER_MODE: 'AUTO' }), true);
});

test('RADAR mode refuses PropLine before configuration or network access', async () => {
  const previousMode = process.env.OBLIGE_PROP_PROVIDER_MODE;
  const previousKey = process.env.PROPLINE_API_KEY;
  try {
    process.env.OBLIGE_PROP_PROVIDER_MODE = 'sportradar';
    delete process.env.PROPLINE_API_KEY;
    await assert.rejects(
      proplineGet('/v1/sports', {}, { bypassCache: true }),
      (error) => error?.code === 'PROPLINE_DISABLED_BY_PROVIDER_MODE',
    );
    assert.equal(startProplineFreshnessMonitor(), null);
  } finally {
    if (previousMode === undefined) delete process.env.OBLIGE_PROP_PROVIDER_MODE;
    else process.env.OBLIGE_PROP_PROVIDER_MODE = previousMode;
    if (previousKey === undefined) delete process.env.PROPLINE_API_KEY;
    else process.env.PROPLINE_API_KEY = previousKey;
  }
});
