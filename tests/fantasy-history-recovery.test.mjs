import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchFantasyResearch } from '../lib/data-sources/espn/fantasy-research.mjs';
import { fantasySpec } from '../lib/props/fantasy-scoring.mjs';

const params = { sport:'NBA', playerName:'Fixture Player', market:'Fantasy Score', providerMarketKey:'prizepicks:player_fantasy_score' };
const names = ['points','totalRebounds','assists','blocks','steals','turnovers'];
const complete = ['20','10','5','2','1','4'];
let athlete = 990000;
async function historyFor(stats) {
  const gameLog = stats.map((_,i)=>({gameId:`nba:${i+1}`,date:`2026-09-${19-i}T00:00:00Z`,season:2026,seasonType:2,value:20}));
  return fetchFantasyResearch(params, {
    fetchHistory: async proxy => {
      assert.equal(proxy.providerMarketKey,'player_points');
      return {ok:true,available:true,player:{providerPlayerId:`history:NBA:${++athlete}`},season:2026,coverage:{seasonComplete:true},gameLog};
    },
    fetchImpl:async()=>({ok:true,json:async()=>({names,seasonTypes:[{categories:[{type:'event',events:stats.map((values,i)=>({eventId:String(i+1),stats:values}))}]}]})}),
  });
}
test('one incomplete game does not erase independently complete fantasy games',async()=>{
  const result=await historyFor([complete,[...complete.slice(0,5),null],['0','0','0','0','0','0']]);
  assert.equal(result.available,true);
  assert.deepEqual(result.gameLog.map(row=>row.value),[44.5,0]);
  assert.equal(result.coverage.fantasyGamesScored,2);
  assert.equal(result.coverage.fantasyGamesExcluded,1);
  assert.equal(result.coverage.seasonComplete,false);
  assert.equal(result.coverage.partial,true);
});
test('complete fantasy histories retain complete coverage',async()=>{
  const result=await historyFor([complete,complete]);
  assert.equal(result.coverage.seasonComplete,true);
  assert.equal(result.coverage.fantasyGamesExcluded,0);
});
test('no complete component rows stays unavailable without manufactured scores',async()=>{
  const result=await historyFor([[...complete.slice(0,5),null]]);
  assert.equal(result.available,false);
  assert.equal(result.code,'FANTASY_COMPONENTS_INCOMPLETE');
  assert.deepEqual(result.gameLog,[]);
});
test('full-game formulas reject periods and multi-player selections',()=>{
  for(const extra of [{period:'h1'},{period:'q1'},{playerName:'Player One + Player Two'},{market:'Fantasy Score (Combo)'}]) assert.equal(fantasySpec({...params,...extra}),null);
  assert.ok(fantasySpec({...params,period:'full_game'}));
});
