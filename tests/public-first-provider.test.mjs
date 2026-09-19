import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'autoscout-public-first-'));
const keys = ['DATA_DIR','AUTOSCOUT_SUPABASE_URL','AUTOSCOUT_SUPABASE_PUBLISHABLE_KEY','AUTOSCOUT_SUPABASE_INGEST_TOKEN','AUTOSCOUT_PUBLIC_FIRST','THE_ODDS_API_KEY','THE_ODDS_API_PAUSED','SPORTSDATAIO_API_KEY'];
const saved = new Map(keys.map((key) => [key, process.env[key]]));
process.env.DATA_DIR = temp;
process.env.AUTOSCOUT_SUPABASE_URL = 'https://autoscout-fixture.supabase.co';
process.env.AUTOSCOUT_SUPABASE_PUBLISHABLE_KEY = 'fixture-publishable';
process.env.AUTOSCOUT_SUPABASE_INGEST_TOKEN = 'fixture-ingest-token';
process.env.AUTOSCOUT_PUBLIC_FIRST = 'true';
process.env.THE_ODDS_API_KEY = '';
process.env.THE_ODDS_API_PAUSED = 'true';
process.env.SPORTSDATAIO_API_KEY = '';

const originalFetch = globalThis.fetch;
const calls = [];
const fixtureRow = {
  id: 'fixture-db-line', source: 'PrizePicks', provider: 'prizepicks', sport: 'NBA',
  eventId: 'fixture-event', playerId: 'fixture-player', playerName: 'Fixture Player', team: 'BOS',
  marketId: 'player_points', market: 'Points', side: 'OVER', line: 24.5, price: null,
  sportsbook: 'PrizePicks', sportsbookKey: 'prizepicks',
  gameStartTime: new Date(Date.now() + 24 * 3600_000).toISOString(), homeTeam: 'BOS', awayTeam: 'NYK',
  isAlternate: false, ingestedAt: new Date().toISOString(),
};
let rows = [fixtureRow];

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  calls.push(url.href);
  if (url.hostname !== 'autoscout-fixture.supabase.co') throw new Error(`Unexpected network request: ${url.hostname}`);
  const body = JSON.parse(String(init.body || '{}'));
  assert.equal(body.p_action, 'read_props');
  return new Response(JSON.stringify({ rows }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const { fetchUnifiedBoard } = await import('../apex-v2/provider.mjs');

test('public-first page request serves persisted rows without a metered provider request', async () => {
  const board = await fetchUnifiedBoard('NBA');
  assert.equal(board.meta.publicFirst, true);
  assert.equal(board.meta.databasePublicProps, 1);
  assert.equal(board.props.length, 1);
  assert.equal(board.props[0].sportsbookKey, 'prizepicks');
  assert.ok(calls.length >= 1);
  assert.ok(calls.every((url) => new URL(url).hostname === 'autoscout-fixture.supabase.co'));
});

test('empty public database still returns a cache-first empty board instead of refreshing a paid provider', async () => {
  calls.length = 0;
  rows = [];
  const board = await fetchUnifiedBoard('NBA');
  assert.equal(board.meta.publicFirst, true);
  assert.equal(board.props.length, 0);
  assert.ok(calls.every((url) => new URL(url).hostname === 'autoscout-fixture.supabase.co'));
});

test('customer board removes persisted props older than the hard freshness ceiling', async () => {
  calls.length = 0;
  rows = [{ ...fixtureRow, ingestedAt: new Date(Date.now() - 11 * 60_000).toISOString() }];
  const board = await fetchUnifiedBoard('NBA');
  assert.equal(board.props.length, 0);
  assert.equal(board.meta.customerFreshness?.dropped?.stale, 1);
});

test('customer board never promotes the canonical last-good database fallback', async () => {
  calls.length = 0;
  rows = [{ ...fixtureRow, ingestedAt: new Date().toISOString(), cacheFallback: true }];
  const board = await fetchUnifiedBoard('NBA');
  assert.equal(board.props.length, 0);
  assert.equal(board.meta.customerFreshness?.dropped?.last_good_fallback, 1);
});

after(async () => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of saved) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  await fs.rm(temp, { recursive: true, force: true });
});
