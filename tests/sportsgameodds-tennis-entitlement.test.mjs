import test from 'node:test';
import assert from 'node:assert/strict';

import {
  __resetSportsGameOddsProvider,
  fetchSportsGameOddsBoard,
} from '../lib/autoscout/providers/sportsgameodds.mjs';
import { __resetSportsGameOddsClient } from '../lib/data-sources/sportsgameodds/client.mjs';

test('tennis fails closed when configured leagues are absent from the live entitlement catalog', async () => {
  const previousKey = process.env.SPORTS_ODDS_API_KEY_HEADER;
  const previousMode = process.env.OBLIGE_PROP_PROVIDER_MODE;
  const previousFetch = globalThis.fetch;
  const urls = [];

  try {
    process.env.SPORTS_ODDS_API_KEY_HEADER = 'test-key';
    process.env.OBLIGE_PROP_PROVIDER_MODE = 'sportsgameodds';
    __resetSportsGameOddsClient();
    __resetSportsGameOddsProvider();

    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      urls.push(url);

      if (url.pathname.endsWith('/account/usage')) {
        return new Response(JSON.stringify({
          success: true,
          data: { tier: 'test', rateLimits: { 'per-month': { 'max-entities': 100000, 'current-entities': 0 } } },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url.pathname.endsWith('/sports')) {
        return new Response(JSON.stringify({
          success: true,
          data: [{ sportID: 'TENNIS', name: 'Tennis' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url.pathname.endsWith('/leagues')) {
        return new Response(JSON.stringify({
          success: true,
          data: [{ leagueID: 'NFL', sportID: 'FOOTBALL', name: 'NFL' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url.pathname.endsWith('/events')) {
        throw new Error('Tennis /events must not be called without an entitled league');
      }

      throw new Error('Unexpected URL ' + url.href);
    };

    const board = await fetchSportsGameOddsBoard('TENNIS', { force: true, eventLimit: 8 });

    assert.equal(board.meta.supported, false);
    assert.equal(board.meta.entitlementMissing, true);
    assert.deepEqual(board.meta.requestedLeagueIDs, ['ATP', 'WTA', 'ITF']);
    assert.deepEqual(board.meta.availableLeagueIDs, ['NFL']);
    assert.equal(urls.some((url) => url.pathname.endsWith('/events')), false);
  } finally {
    globalThis.fetch = previousFetch;
    __resetSportsGameOddsClient();
    __resetSportsGameOddsProvider();
    if (previousKey === undefined) delete process.env.SPORTS_ODDS_API_KEY_HEADER;
    else process.env.SPORTS_ODDS_API_KEY_HEADER = previousKey;
    if (previousMode === undefined) delete process.env.OBLIGE_PROP_PROVIDER_MODE;
    else process.env.OBLIGE_PROP_PROVIDER_MODE = previousMode;
  }
});

test('tennis requests only the configured leagues entitled by the live catalog', async () => {
  const previousKey = process.env.SPORTS_ODDS_API_KEY_HEADER;
  const previousMode = process.env.OBLIGE_PROP_PROVIDER_MODE;
  const previousFetch = globalThis.fetch;
  const urls = [];

  try {
    process.env.SPORTS_ODDS_API_KEY_HEADER = 'test-key';
    process.env.OBLIGE_PROP_PROVIDER_MODE = 'sportsgameodds';
    __resetSportsGameOddsClient();
    __resetSportsGameOddsProvider();

    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      urls.push(url);

      if (url.pathname.endsWith('/account/usage')) {
        return new Response(JSON.stringify({
          success: true,
          data: { tier: 'test', rateLimits: { 'per-month': { 'max-entities': 100000, 'current-entities': 0 } } },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url.pathname.endsWith('/sports')) {
        return new Response(JSON.stringify({
          success: true,
          data: [{ sportID: 'TENNIS', name: 'Tennis' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url.pathname.endsWith('/leagues')) {
        return new Response(JSON.stringify({
          success: true,
          data: [{ leagueID: 'ATP', sportID: 'TENNIS', name: 'ATP' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url.pathname.endsWith('/events')) {
        return new Response(JSON.stringify({
          success: true,
          data: [],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      throw new Error('Unexpected URL ' + url.href);
    };

    const board = await fetchSportsGameOddsBoard('TENNIS', { force: true, eventLimit: 8 });
    const eventsUrl = urls.find((url) => url.pathname.endsWith('/events'));

    assert.ok(eventsUrl, 'Tennis /events should be called when one configured league is entitled');
    assert.equal(eventsUrl.searchParams.get('leagueID'), 'ATP');
    assert.equal(board.meta.supported, true);
    assert.deepEqual(board.meta.leaguesRequested, ['ATP']);
  } finally {
    globalThis.fetch = previousFetch;
    __resetSportsGameOddsClient();
    __resetSportsGameOddsProvider();
    if (previousKey === undefined) delete process.env.SPORTS_ODDS_API_KEY_HEADER;
    else process.env.SPORTS_ODDS_API_KEY_HEADER = previousKey;
    if (previousMode === undefined) delete process.env.OBLIGE_PROP_PROVIDER_MODE;
    else process.env.OBLIGE_PROP_PROVIDER_MODE = previousMode;
  }
});
