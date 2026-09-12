import test from 'node:test';
import assert from 'node:assert/strict';
import { marketContract, normalizeStatColumns } from '../lib/data-sources/espn/stat-contract.mjs';
import { analyzeResearch } from '../lib/analytics/research.mjs';

test('concurrent release market aliases retain exact public stat semantics',()=>{
  for(const [sport,market,field] of [['NFL','Tackles + Assists','TotalTackles'],['MLB','Hits allowed','HitsAllowed'],['MLB','Walks allowed','WalksAllowed']]){
    const c=marketContract({sport,market});assert.deepEqual(c.fields,[field]);
    if(sport==='MLB')assert.equal(c.category,'pitching');
  }
  assert.deepEqual(marketContract({sport:'MLB',providerMarketKey:'pitcher_outs_recorded'}).fields,['PitchingOuts']);
  assert.deepEqual(marketContract({sport:'NHL',providerMarketKey:'player_saves'}).fields,['Saves']);
});
test('combined completion-attempt and sack-loss columns retain quarterback semantics',()=>{
  const c=normalizeStatColumns({'completions-passingAttempts':'21-32','sacks-sackYardsLost':'3-24'},{sport:'NFL'});
  assert.equal(c.PassingCompletions,21);assert.equal(c.PassingAttempts,32);
  assert.equal(c.SacksTaken,3);assert.equal(c.Sacks,3);assert.equal(c.sackKind,'sacks_taken');
  const noContext=normalizeStatColumns({'sacks-sackYardsLost':'3-24'},{sport:'NFL'});
  assert.equal(noContext.Sacks,null);
});
test('concurrent partial-season coverage metadata stays grounded and excludes postseason',()=>{
  const r=analyzeResearch({season:2026,coverage:{seasonComplete:false},gameLog:[
    {gameId:'1',season:2026,seasonType:2,value:20},
    {gameId:'2',season:2026,seasonType:3,value:99},
    {gameId:'3',season:2025,seasonType:2,value:30},
    {gameId:'4',value:40},
  ]},19.5,'OVER');
  assert.equal(r.coverage.seasonPartial,true);assert.equal(r.coverage.seasonGames,1);
  assert.equal(r.windows.season.average,20);assert.equal(r.windows.l5.games,4);
});
