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

test('ClearSports maps NFL and NCAAF football season markets', async () => {
  const previousKey = process.env.CLEARSPORTS_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.CLEARSPORTS_API_KEY = 'test-key';
  const calls = [];

  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const isCollege = String(url).includes('/ncaaf/');
    return new Response(JSON.stringify({
      football_player_stats: [{
        id: isCollege ? 'college-qb' : 'stafford',
        team_id: isCollege ? 'ncaaf_texas' : 'nfl_lar',
        full_name: isCollege ? 'Arch Manning' : 'Matthew Stafford',
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
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const mod = await import(`../lib/data-sources/clearsports/season-research.mjs?football=${Date.now()}`);
    const nfl = await mod.fetchClearSportsSeasonResearch({ sport: 'NFL', playerName: 'Matthew Stafford', market: 'Passing + Rushing Yards' });
    const ncaaf = await mod.fetchClearSportsSeasonResearch({ sport: 'NCAAF', playerName: 'Arch Manning', market: 'Pass Completions' });
    assert.equal(nfl.context.seasonStat, 715);
    assert.equal(ncaaf.context.seasonStat, 60);
    assert.equal(calls.length, 2, 'one cached feed request per league');
    assert.equal('gameLog' in nfl, false);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv('CLEARSPORTS_API_KEY', previousKey);
  }
});

test('ClearSports maps NBA and NCAAB basketball season markets', async () => {
  const previousKey = process.env.CLEARSPORTS_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.CLEARSPORTS_API_KEY = 'test-key';
  const calls = [];

  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const college = String(url).includes('/ncaab/');
    return new Response(JSON.stringify({
      basketball_player_stats: [{
        id: college ? 'college-guard' : 'nba-star',
        team_id: college ? 'ncaab_duke' : 'nba_lal',
        full_name: college ? 'Cooper Flagg' : 'Luka Doncic',
        points: 420,
        rebounds: 130,
        assists: 115,
        steals: 28,
        blocks: 12,
        turnovers: 44,
        three_pointers_made: 61,
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const mod = await import(`../lib/data-sources/clearsports/season-research.mjs?basketball=${Date.now()}`);
    const nba = await mod.fetchClearSportsSeasonResearch({ sport: 'NBA', playerName: 'Luka Doncic', market: 'Points + Rebounds + Assists' });
    const ncaab = await mod.fetchClearSportsSeasonResearch({ sport: 'NCAAB', playerName: 'Cooper Flagg', market: 'Points + Assists' });
    assert.equal(nba.context.seasonStat, 665);
    assert.equal(ncaab.context.seasonStat, 535);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv('CLEARSPORTS_API_KEY', previousKey);
  }
});

test('ClearSports maps NHL season markets', async () => {
  const previousKey = process.env.CLEARSPORTS_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.CLEARSPORTS_API_KEY = 'test-key';

  globalThis.fetch = async () => new Response(JSON.stringify({
    hockey_player_stats: [{
      id: 'nhl-star',
      team_id: 'nhl_edm',
      full_name: 'Connor McDavid',
      goals: 40,
      assists: 75,
      shots_on_goal: 265,
      hits: 36,
      blocked_shots: 21,
      power_play_points: 44,
    }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    const mod = await import(`../lib/data-sources/clearsports/season-research.mjs?hockey=${Date.now()}`);
    const points = await mod.fetchClearSportsSeasonResearch({ sport: 'NHL', playerName: 'Connor McDavid', market: 'Points' });
    const shots = await mod.fetchClearSportsSeasonResearch({ sport: 'NHL', playerName: 'Connor McDavid', market: 'Shots on Goal' });
    assert.equal(points.context.seasonStat, 115);
    assert.equal(shots.context.seasonStat, 265);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv('CLEARSPORTS_API_KEY', previousKey);
  }
});

test('MLB and WNBA stay live on The Odds API with research fallback instead of fake ClearSports player stats', async () => {
  const previousKey = process.env.CLEARSPORTS_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.CLEARSPORTS_API_KEY = 'test-key';
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('should not call ClearSports'); };

  try {
    const mod = await import(`../lib/data-sources/clearsports/season-research.mjs?fallback=${Date.now()}`);
    const mlb = await mod.fetchClearSportsSeasonResearch({ sport: 'MLB', playerName: 'Shohei Ohtani', market: 'Hits' });
    const wnba = await mod.fetchClearSportsSeasonResearch({ sport: 'WNBA', playerName: 'Aja Wilson', market: 'Points' });
    assert.equal(mlb.code, 'CLEARSPORTS_PLAYER_STATS_UNAVAILABLE');
    assert.equal(wnba.code, 'CLEARSPORTS_PLAYER_STATS_UNAVAILABLE');
    assert.equal(mlb.context.providerCoverage, 'fallback-only');
    assert.equal(wnba.context.providerCoverage, 'fallback-only');
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv('CLEARSPORTS_API_KEY', previousKey);
  }
});
