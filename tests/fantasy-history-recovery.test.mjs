import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchFantasyResearch } from '../lib/data-sources/espn/fantasy-research.mjs';
import { fantasySpec } from '../lib/props/fantasy-scoring.mjs';

const params = { sport:'NBA', playerName:'Fixture Player', market:'Fantasy Score', providerMarketKey:'prizepicks:player_fantasy_score' };
const names = ['points','totalRebounds','assists','blocks','steals','turnovers'];
const complete = ['20','10','5','2','1','4'];
let athlete = 990000;
async function historyFor(stats, fetchImpl = async()=>({ok:true,json:async()=>({names,seasonTypes:[{categories:[{type:'event',events:stats.map((values,i)=>({eventId:String(i+1),stats:values}))}]}]})})) {
  const gameLog = stats.map((_,i)=>({gameId:`nba:${i+1}`,date:`2026-09-${19-i}T00:00:00Z`,season:2026,seasonType:2,value:20}));
  return fetchFantasyResearch(params, {
    fetchHistory: async proxy => {
      assert.equal(proxy.providerMarketKey,'player_points');
      return {ok:true,available:true,player:{providerPlayerId:`history:NBA:${++athlete}`},season:2026,coverage:{seasonComplete:true},gameLog};
    },
    fetchImpl,
  });
}
test('one incomplete game keeps the full fantasy history line-only',async()=>{
  const result=await historyFor([complete,[...complete.slice(0,5),null],['0','0','0','0','0','0']]);
  assert.equal(result.available,false);
  assert.equal(result.lineOnly,true);
  assert.equal(result.retryable,false);
  assert.equal(result.code,'FANTASY_COMPONENTS_INCOMPLETE');
  assert.deepEqual(result.gameLog,[]);
});
test('complete fantasy histories retain complete coverage',async()=>{
  const result=await historyFor([complete,complete]);
  assert.equal(result.available,true);
  assert.deepEqual(result.gameLog.map(row=>row.value),[44.5,44.5]);
  assert.equal(result.coverage.seasonComplete,true);
  assert.equal(result.coverage.fantasyGamesScored,2);
  assert.equal(result.coverage.fantasyGamesExcluded,0);
});
test('completed zero-stat fantasy games are retained as verified zeroes',async()=>{
  const result=await historyFor([complete,['0','0','0','0','0','0']]);
  assert.equal(result.available,true);
  assert.deepEqual(result.gameLog.map(row=>row.value),[44.5,0]);
  assert.equal(result.coverage.fantasyGamesExcluded,0);
});
test('component transport failures stay retryable instead of becoming line-only',async()=>{
  const result=await historyFor([complete],async()=>({ok:false,status:503}));
  assert.equal(result.available,false);
  assert.notEqual(result.lineOnly,true);
  assert.equal(result.retryable,true);
  assert.equal(result.code,'RESEARCH_PROVIDER_ERROR');
  assert.deepEqual(result.gameLog,[]);
});
test('no complete component rows stays unavailable without manufactured scores',async()=>{
  const result=await historyFor([[...complete.slice(0,5),null]]);
  assert.equal(result.available,false);
  assert.equal(result.retryable,false);
  assert.equal(result.code,'FANTASY_COMPONENTS_INCOMPLETE');
  assert.deepEqual(result.gameLog,[]);
});
test('full-game formulas reject periods and multi-player selections',()=>{
  for(const extra of [{period:'h1'},{period:'q1'},{playerName:'Player One + Player Two'},{market:'Fantasy Score (Combo)'}]) assert.equal(fantasySpec({...params,...extra}),null);
  assert.ok(fantasySpec({...params,period:'full_game'}));
});


test('PrizePicks NFL offensive fantasy scoring uses the full verified PPR formula', async () => {
  const nflParams = {
    sport: 'NFL',
    playerName: 'Fixture Quarterback',
    position: 'QB',
    market: 'Fantasy Score',
    providerMarketKey: 'prizepicks:player_fantasy_score',
  };
  const spec = fantasySpec(nflParams);
  assert.ok(spec);
  assert.equal(spec.id, 'nfl_offense');
  assert.equal(spec.proxyMarketKey, 'player_pass_yds');

  const names = [
    'passingYards','passingTouchdowns','interceptions',
    'rushingYards','rushingTouchdowns','receptions',
    'receivingYards','receivingTouchdowns','fumblesLost',
    'twoPointConversions','offensiveFumbleRecoveryTouchdowns',
    'kickPuntFieldGoalReturnTouchdowns',
  ];
  const stats = [['250','2','1','30','1','0','0','0','1','1','0','0']];
  const result = await fetchFantasyResearch(nflParams, {
    fetchHistory: async proxy => {
      assert.equal(proxy.providerMarketKey, 'player_pass_yds');
      return {
        ok: true,
        available: true,
        player: { providerPlayerId: 'history:NFL:3918298' },
        season: 2026,
        coverage: { seasonComplete: true },
        gameLog: [{ gameId:'nfl:1', date:'2026-09-20T00:00:00Z', season:2026, seasonType:2, value:250 }],
      };
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        names,
        seasonTypes: [{ categories: [{ type:'event', events:[{ eventId:'1', stats:stats[0] }] }] }],
      }),
    }),
  });
  // 250 pass yds=10, 2 pass TD=8, INT=-1, 30 rush yds=3,
  // rush TD=6, fumble=-1, 2PT=2 => 27.
  assert.equal(result.available, true);
  assert.equal(result.gameLog[0].value, 27);
});

test('PrizePicks NFL fantasy history fails closed when a scoring component is missing', async () => {
  const nflParams = {
    sport: 'NFL',
    playerName: 'Fixture Receiver',
    position: 'WR',
    market: 'Fantasy Points',
    providerMarketKey: 'prizepicks:player_fantasy_points',
  };
  const result = await fetchFantasyResearch(nflParams, {
    fetchHistory: async proxy => ({
      ok:true,
      available:true,
      player:{providerPlayerId:'history:NFL:4426354'},
      season:2026,
      coverage:{seasonComplete:true},
      gameLog:[{gameId:'nfl:2',date:'2026-09-20T00:00:00Z',season:2026,seasonType:2,value:80}],
    }),
    fetchImpl: async () => ({
      ok:true,
      json:async()=>({
        names:['passingYards','passingTouchdowns','interceptions','rushingYards','rushingTouchdowns','receptions','receivingYards','receivingTouchdowns','fumblesLost','twoPointConversions','offensiveFumbleRecoveryTouchdowns'],
        seasonTypes:[{categories:[{type:'event',events:[{eventId:'2',stats:['0','0','0','0','0','6','80','1','0','0','0']}]}]}],
      }),
    }),
  });
  assert.equal(result.available, false);
  assert.equal(result.lineOnly, true);
  assert.equal(result.code, 'FANTASY_COMPONENTS_INCOMPLETE');
});
