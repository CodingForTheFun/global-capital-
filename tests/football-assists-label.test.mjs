import test from 'node:test';
import assert from 'node:assert/strict';
import {marketContract,statValue} from '../lib/data-sources/espn/stat-contract.mjs';
test('football assists means assisted tackles while basketball assists remains separate',()=>{
 for(const sport of ['NFL','NCAAF']){
  const byLabel=marketContract({sport,market:'Assists'});
  const byKey=marketContract({sport,market:'Assists',providerMarketKey:'player_assists'});
  assert.deepEqual(byLabel.fields,['AssistedTackles']);
  assert.deepEqual(byLabel.fields,byKey.fields);
  assert.equal(statValue({totalTackles:'7',soloTackles:'4',assistTackles:'3'},byLabel),3);
  assert.equal(statValue({assists:'8'},byLabel),null);
 }
 assert.deepEqual(marketContract({sport:'NBA',market:'Assists'}).fields,['Assists']);
});
