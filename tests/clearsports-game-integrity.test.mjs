import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchClearSportsResearch } from '../lib/data-sources/clearsports/research.mjs';
import { fetchClearSportsSeasonResearch } from '../lib/data-sources/clearsports/season-research.mjs';

test('game adapter rejects aggregates and active games; season adapter rejects individual games', async () => {
  const key = process.env.CLEARSPORTS_API_KEY, previousFetch = globalThis.fetch;
  process.env.CLEARSPORTS_API_KEY = 'unit-test-only';
  let calls = 0;
  const stats = [
    { player_id: 'p1', full_name: 'Game Player', game_id: 'finished', team_id: 'nfl_lar', passing_yards: 0 },
    { player_id: 'p1', full_name: 'Game Player', game_id: 'active', team_id: 'nfl_lar', passing_yards: 99 },
    { player_id: 'p2', full_name: 'Season Player', passing_yards_yds: 4000 },
    { player_id: 'p3', full_name: 'Single Player', game_id: 'finished', passing_yards: 12 },
  ];
  globalThis.fetch = async url => {
    calls++;
    const data = String(url).endsWith('/player-stats') ? stats : String(url).endsWith('/games') ? [
      { id: 'finished', date: '2025-01-01', status: 'Final', home_team: 'LAR', away_team: 'SEA' },
      { id: 'active', date: '2025-01-02', status: 'In Progress', home_team: 'LAR', away_team: 'SEA' },
    ] : [];
    return new Response(JSON.stringify(data), { status: 200 });
  };
  try {
    const game = await fetchClearSportsResearch({ sport: 'NFL', playerName: 'Game Player', team: 'LAR', market: 'Pass Yards' });
    assert.equal(game.available, true);
    assert.equal(game.gameLog.length, 1);
    assert.equal(game.gameLog[0].value, 0);
    assert.equal(game.gameLog[0].isHome, true);
    assert.equal(game.gameLog[0].opponent, 'SEA');
    const aggregate = await fetchClearSportsResearch({ sport: 'NFL', playerName: 'Season Player', market: 'Pass Yards' });
    assert.equal(aggregate.available, false);
    assert.equal(aggregate.gameLog, undefined);
    const season = await fetchClearSportsSeasonResearch({ sport: 'NFL', playerName: 'Season Player', market: 'Pass Yards' });
    assert.equal(season.context.seasonStat, 4000);
    const single = await fetchClearSportsSeasonResearch({ sport: 'NFL', playerName: 'Single Player', market: 'Pass Yards' });
    assert.equal(single.context?.seasonStat ?? null, null);
    assert.equal(calls, 3, 'both adapters share the same cached league responses');
  } finally {
    globalThis.fetch = previousFetch;
    if (key === undefined) delete process.env.CLEARSPORTS_API_KEY; else process.env.CLEARSPORTS_API_KEY = key;
  }
});
