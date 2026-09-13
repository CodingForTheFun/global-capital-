import test from 'node:test';
import assert from 'node:assert/strict';
import {teammatesFor} from '../lib/data-sources/sportsdataio/injury-feed.mjs';
let clock=Date.now();
function feed(sport,depth,{denied=false,injuries=[],teams=[{TeamID:1,Key:'BOS',City:'Boston',Name:'Celtics'},{TeamID:2,Key:'NY',City:'New York',Name:'Knicks'}]}={}){
 clock+=2*86400000;const at=clock,calls=[];
 return {calls,now:()=>at,fetchImpl:async(url,options)=>{
  calls.push(new URL(url).pathname);
  assert.equal(options.headers['Ocp-Apim-Subscription-Key'],'fixture-roster-key');
  const path=new URL(url).pathname;
  const payload=path.endsWith('/Teams')?teams:path.endsWith('/DepthCharts')?depth:injuries;
  return new Response(JSON.stringify(payload),{status:denied&&path.endsWith('/DepthCharts')?403:200});
 }};
}
test('scenario roster uses native team/player IDs, grouped depth charts and proper tiers',async t=>{
 const oldFlag=process.env.AUTOSCOUT_INJURY_FEED,oldKey=process.env.SPORTSDATAIO_API_KEY;
 process.env.AUTOSCOUT_INJURY_FEED='true';process.env.SPORTSDATAIO_API_KEY='fixture-roster-key';
 try{
  await t.test('NBA groups resolve TeamID, exclude self and deduplicate positions; injuries join exact ID',async()=>{
   const f=feed('NBA',[{TeamID:1,DepthCharts:[{PlayerID:10,Name:'Self Player',Position:'PG',DepthOrder:1},{PlayerID:11,Name:'Same Name',Position:'SF',DepthOrder:1},{PlayerID:11,Name:'Same Name',Position:'PF',DepthOrder:2},{PlayerID:12,Name:'Bench Player',Position:'C',DepthOrder:null},{PlayerID:13,Name:'Released Player',Active:false}]},{TeamID:2,DepthCharts:[{PlayerID:22,Name:'Same Name',Position:'SF'}]}],{injuries:[{PlayerID:22,TeamID:2,Name:'Same Name',InjuryStatus:'Out'},{PlayerID:11,TeamID:1,Name:'Same Name',InjuryStatus:'Questionable'}]});
   const result=await teammatesFor({sport:'NBA',team:'nba_BOS',playerName:'Self Player'},f);
   assert.equal(result.available,true);assert.equal(result.teammates.length,2);assert.equal(result.teammates[0].playerId,'11');assert.equal(result.teammates[0].injuryStatus,'Questionable');assert.equal(result.teammates[1].depthOrder,null);
   const n=f.calls.length;await teammatesFor({sport:'NBA',team:'BOS',playerName:'Self Player'},f);assert.equal(f.calls.length,n,'shared roster cache prevents repeat reads');
  });
  await t.test('NFL includes special teams and filters to the requested team ID',async()=>{
   const f=feed('NFL',[{TeamID:1,Offense:[{PlayerID:1,Name:'Self Player'}],Defense:[{PlayerID:2,Name:'Defender'}],SpecialTeams:[{PlayerID:3,Name:'Kicker'}]},{TeamID:2,Offense:[{PlayerID:4,Name:'Other Team'}]}]);
   const r=await teammatesFor({sport:'NFL',team:'BOS',playerName:'Self Player'},f);assert.deepEqual(new Set(r.teammates.map(x=>x.playerName)),new Set(['Defender','Kicker']));assert.ok(f.calls.includes('/v3/nfl/scores/json/DepthCharts'));
  });
  await t.test('MLB depth charts use the documented projections tier',async()=>{
   const f=feed('MLB',[{TeamID:1,DepthCharts:[{PlayerID:31,Name:'Active Pitcher',Position:'SP'}]}],{teams:[{TeamID:1,Key:'BAL',City:'Baltimore',Name:'Orioles'}]});
   const r=await teammatesFor({sport:'MLB',team:'BAL',playerName:'Different Player'},f);assert.equal(r.teammates[0].playerName,'Active Pitcher');assert.ok(f.calls.includes('/v3/mlb/projections/json/DepthCharts'));assert.ok(!f.calls.includes('/v3/mlb/scores/json/DepthCharts'));
  });
  await t.test('denied roster is unavailable and missing team mappings never claim an empty active roster',async()=>{
   let f=feed('NBA',[],{denied:true});let r=await teammatesFor({sport:'NBA',team:'BOS'},f);assert.equal(r.available,false);assert.equal(r.reason,'ROSTER_ACCESS_DENIED');assert.equal(f.calls.length,2);
   f=feed('NBA',[{TeamID:1,DepthCharts:[{Name:'Wrong Team'}]}]);r=await teammatesFor({sport:'NBA',team:'UNKNOWN'},f);assert.equal(r.available,false);assert.equal(r.reason,'TEAM_UNKNOWN');assert.deepEqual(r.teammates,[]);
  });
 }finally{if(oldFlag===undefined)delete process.env.AUTOSCOUT_INJURY_FEED;else process.env.AUTOSCOUT_INJURY_FEED=oldFlag;if(oldKey===undefined)delete process.env.SPORTSDATAIO_API_KEY;else process.env.SPORTSDATAIO_API_KEY=oldKey;}
});
