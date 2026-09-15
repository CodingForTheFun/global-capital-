import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { patchProplineRealtimeCore, patchProplineRealtimeFrontdoor, patchProplineRealtimeUi } from '../lib/autoscout/propline-realtime-runtime-patch.mjs';

test('runtime patches mount signed PropLine callbacks, customer moves API and UI', () => {
  const core = patchProplineRealtimeCore(readFileSync(new URL('../apex-v2/server-core.mjs', import.meta.url), 'utf8'));
  assert.match(core, /onEvent: handleProplineRealtimeEvent/);
  assert.match(core, /\/api\/propline\/live/);
  assert.match(core, /startProplineRealtime\(\)/);
  assert.match(core, /proplineRealtime: proplineRealtimeHealth\(\)/);

  const front = patchProplineRealtimeFrontdoor(readFileSync(new URL('../frontdoor-prod.mjs', import.meta.url), 'utf8'));
  assert.match(front, /\.server-core-propline-runtime\.mjs/);
  assert.match(front, /\/api\/apex\/live-moves/);
  assert.match(front, /url\.pathname === '\/api\/propline\/webhook'\) return false/);

  const ui = patchProplineRealtimeUi(readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8'));
  assert.match(ui, /Market Moves/);
  assert.match(ui, /asMovesMainTab/);
  assert.match(ui, /Live market signals/);
  new Function(ui);
});

test('realtime store ingests, filters and deduplicates single and batched events', async () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'propline-realtime-'));
  process.env.DATA_DIR = temp;
  process.env.AUTOPROP_MASTER_KEY = 'test-master-key-not-production';
  const href = pathToFileURL(new URL('../lib/data-sources/propline/realtime.mjs', import.meta.url).pathname).href + `?test=${Date.now()}`;
  const realtime = await import(href);
  realtime.__resetProplineRealtimeForTests();
  const now = new Date().toISOString();

  await realtime.handleProplineRealtimeEvent({
    type: 'line_movement', sequence: 7,
    payload: {
      sport_key: 'basketball_nba', player_name: 'Test Player', player_id: 'nba:1',
      market_key: 'player_points', bookmaker_key: 'fanduel', outcome_name: 'Over',
      previous: { price_american: -110, point: 20.5 }, current: { price_american: -125, point: 20.5 },
      price_change_pct: 13.6, timestamp: now,
    },
  });
  let snapshot = realtime.proplineRealtimeSnapshot({ sport: 'NBA', type: 'line_movement' });
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.events[0].playerName, 'Test Player');
  assert.equal(snapshot.events[0].current.price, -125);
  assert.equal(snapshot.summary.lineMovements, 1);

  const batch = {
    batch: true, event_type: 'steam', events: [{ delivery_id: 'steam-1', data: {
      sport_key: 'basketball_nba', player_name: 'Test Player', market_key: 'player_points', outcome_name: 'Over',
      consensus_direction: 'shorter', books_moved: 4, books_quoting: 7, steam_score: 82, timestamp: now,
    }}],
  };
  await realtime.handleProplineRealtimeEvent({ type: 'steam', sequence: 8, payload: batch });
  await realtime.handleProplineRealtimeEvent({ type: 'steam', sequence: 9, payload: batch });
  snapshot = realtime.proplineRealtimeSnapshot({ sport: 'NBA' });
  assert.equal(snapshot.events.filter((row) => row.type === 'steam').length, 1, 'delivery_id dedupes retried batched events');
  assert.equal(snapshot.summary.steam, 1);
  assert.equal(snapshot.trendingPlayers[0].playerName, 'Test Player');

  const disk = readFileSync(path.join(temp, 'propline-realtime.json'), 'utf8');
  assert.doesNotMatch(disk, /test-master-key-not-production/);
});
