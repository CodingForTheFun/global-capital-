import test from 'node:test';
import assert from 'node:assert/strict';

import {
  proplineGet,
  proplineTrafficEnabled,
} from '../lib/data-sources/propline/client.mjs';
import { providerRouting } from '../lib/autoscout/provider-mode.mjs';
import { publicWorkerConfigured } from '../lib/ingestion/public-worker.mjs';
import { appendPublicFeeds, publicFeeds } from '../lib/ingestion/public-feeds.mjs';
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


test('SGO mode disables public feeds and public ingestion globally', async () => {
  const previousMode = process.env.OBLIGE_PROP_PROVIDER_MODE;
  try {
    process.env.OBLIGE_PROP_PROVIDER_MODE = 'SGO';
    assert.deepEqual(providerRouting(), {
      mode: 'sportsgameodds',
      primary: 'sportsgameodds',
      enabled: ['sportsgameodds'],
      fallback: [],
    });
    assert.equal(publicWorkerConfigured(), false);
    await publicFeeds.refresh();

    const board = {
      props: [{ id: 'keep-me', provider: 'sportsgameodds' }],
      data: { events: [], players: [], props: [], lines: [] },
      meta: { provider: 'SportsGameOdds' },
    };
    const result = await appendPublicFeeds(board, 'NFL');
    assert.equal(result.props.length, 1);
    assert.equal(result.props[0].id, 'keep-me');
    assert.equal(result.meta.publicFeedsActive, false);
  } finally {
    if (previousMode === undefined) delete process.env.OBLIGE_PROP_PROVIDER_MODE;
    else process.env.OBLIGE_PROP_PROVIDER_MODE = previousMode;
  }
});
