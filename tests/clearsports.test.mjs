import test from 'node:test';
import assert from 'node:assert/strict';
import { createClearSportsClient } from '../lib/data-sources/clearsports/client.mjs';

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('ClearSports client coalesces identical in-flight requests', async () => {
  const previousKey = process.env.CLEARSPORTS_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.CLEARSPORTS_API_KEY = 'test-key';
  let calls = 0;

  globalThis.fetch = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 15));
    return new Response(JSON.stringify({ football_player_stats: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const client = createClearSportsClient({ timeoutMs: 1000 });
    const requests = Array.from({ length: 3 }, () => client.get('/nfl/player-stats', { ttlMs: 60_000 }));
    const results = await Promise.all(requests);
    assert.equal(calls, 1);
    assert.equal(client.stats().coalesced, 2);
    assert.ok(results.every((result) => result.ok));
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv('CLEARSPORTS_API_KEY', previousKey);
  }
});

test('ClearSports NFL season stats map verified fields without inventing game logs', async () => {
  const previousKey = process.env.CLEARSPORTS_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.CLEARSPORTS_API_KEY = 'test-key';
  let calls = 0;

  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({
      football_player_stats: [{
        id: 'stafford',
        team_id: 'nfl_lar',
        full_name: 'Matthew Stafford',
        player_image: 'https://example.invalid/stafford.png',
        position_display: 'QB',
        passing_yards_att: 85,
        passing_yards_cmp: 60,
        passing_yards_yds: 700,
        passing_yards_td: 5,
        rushing_yards_att: 6,
        rushing_yards_yds: 15,
        rushing_yards_td: 1,
        receiving_yards_tgt: 0,
        receiving_yards_rec: 0,
        receiving_yards_yds: 0,
        receiving_yards_td: 0,
        data_source: 'ClearSports',
        updated_date: '1785971742',
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const mod = await import(`../lib/data-sources/clearsports/season-research.mjs?test=${Date.now()}`);
    const passing = await mod.fetchClearSportsSeasonResearch({
      sport: 'NFL', playerName: 'Matthew Stafford', market: 'Passing Yards',
    });
    const completions = await mod.fetchClearSportsSeasonResearch({
      sport: 'NFL', playerName: 'Matthew Stafford', market: 'Pass Completions',
    });
    const combo = await mod.fetchClearSportsSeasonResearch({
      sport: 'NFL', playerName: 'Matthew Stafford', market: 'Passing + Rushing Yards',
    });

    assert.equal(calls, 1, 'league player-stat response should be reused from cache');
    assert.equal(passing.available, false);
    assert.equal(passing.code, 'CLEARSPORTS_SEASON_ONLY');
    assert.equal(passing.context.seasonStat, 700);
    assert.equal(completions.context.seasonStat, 60);
    assert.equal(combo.context.seasonStat, 715);
    assert.equal(passing.player.team, 'nfl_lar');
    assert.match(passing.message, /Game-level history is not provided/i);
    assert.equal('gameLog' in passing, false);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv('CLEARSPORTS_API_KEY', previousKey);
  }
});
