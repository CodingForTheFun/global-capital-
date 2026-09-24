import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchSportsDataverseCfbResearch } from '../lib/data-sources/sportsdataverse/cfb-game-research.mjs';

const playerCsv = `game_id,season,week,team_id,category,athlete_id,athlete_name,passing_yards
401000005,2026,5,59,passing,999001,Fixture Quarterback,305
401000004,2026,4,59,passing,999001,Fixture Quarterback,287
401000003,2026,3,59,passing,999001,Fixture Quarterback,263
401000002,2026,2,59,passing,999001,Fixture Quarterback,278
401000001,2026,1,59,passing,999001,Fixture Quarterback,241`;

const scheduleCsv = `game_id,season,season_type,game_date,home_id,home_team,home_abbreviation,home_score,away_id,away_team,away_abbreviation,away_score,status_type_completed
401000005,2026,2,2026-09-18T19:30:00Z,59,Georgia Tech Yellow Jackets,GT,31,228,Clemson Tigers,CLEM,20,true
401000004,2026,2,2026-09-15T19:30:00Z,228,Clemson Tigers,CLEM,21,59,Georgia Tech Yellow Jackets,GT,27,true
401000003,2026,2,2026-09-10T19:30:00Z,59,Georgia Tech Yellow Jackets,GT,28,153,North Carolina Tar Heels,UNC,17,true
401000002,2026,2,2026-09-07T19:30:00Z,153,North Carolina Tar Heels,UNC,14,59,Georgia Tech Yellow Jackets,GT,24,true
401000001,2026,2,2026-09-01T19:30:00Z,59,Georgia Tech Yellow Jackets,GT,35,52,Florida State Seminoles,FSU,21,true`;

test('NCAAF release downloads use GitHub-compatible binary Accept semantics', async () => {
  const seen = [];
  const fetcher = async (url, options = {}) => {
    const accept = options?.headers?.accept;
    seen.push(accept);
    if (accept !== 'application/octet-stream') return new Response('', { status: 406 });
    const target = String(url);
    if (target.endsWith('.csv.gz')) return new Response('', { status: 404 });
    if (target.endsWith('player_box_2026.csv')) return new Response(playerCsv, { status: 200 });
    if (target.endsWith('cfb_schedule_2026.csv')) return new Response(scheduleCsv, { status: 200 });
    return new Response('', { status: 404 });
  };

  const result = await fetchSportsDataverseCfbResearch({
    sport: 'NCAAF',
    team: 'GT',
    playerName: 'Fixture Quarterback',
    market: 'Passing Yards',
    providerMarketKey: 'player_pass_yds',
    period: 'game',
    games: 5,
    gameStartTime: '2026-09-21T20:00:00Z',
  }, {
    fetcher,
    now: () => Date.parse('2026-09-21T18:00:00Z'),
    cacheEnabled: false,
  });

  assert.equal(result.available, true);
  assert.deepEqual(result.gameLog.map((game) => game.value), [305, 287, 263, 278, 241]);
  assert.ok(seen.length >= 4);
  assert.ok(seen.every((value) => value === 'application/octet-stream'));
});
