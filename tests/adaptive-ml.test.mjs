import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {adaptivePrediction,ADAPTIVE_SPORTS,fitAdaptiveHistory} from '../lib/ml/adaptive.mjs';
import {createMLStore} from '../lib/ml/snapshot-store.mjs';
import {targetKey,ML_ENGINE,ML_SOURCE_COMMIT} from '../lib/ml/contract.mjs';

const NOW=Date.parse('2026-09-13T15:00:00Z');
function target(sport='NBA',line=22.5){return {sport,eventId:'evt-1',playerId:'player-1',playerName:'Verified Player',marketId:sport==='NFL'?'player_pass_attempts':'player_points',sportsbookKey:'prizepicks',gameStartTime:'2026-09-14T00:00:00Z',line,entityType:'player',live:false,isAlternate:false};}
// Synthetic fixtures exercise contracts, not forecasting accuracy.
function logs(n=22){return Array.from({length:n},(_,i)=>({gameId:'g'+i,date:new Date(Date.parse('2026-01-01T00:00:00Z')+i*7*86400000).toISOString(),opponent:i%4===0?'BOS':'NYK',value:18+(i%7)+Math.floor(i/8)}));}
function research(gameLog=logs()){return {available:true,gameLog,opponent:'BOS',matchup:{opponent:'BOS'}};}

test('adaptive history candidates cover every configured research sport without claiming calibrated probabilities',()=>{
 assert.deepEqual(ADAPTIVE_SPORTS,['NFL','NBA','WNBA','MLB','NHL','NCAAF','NCAAB','SOCCER','MLS','EPL','UCL','TENNIS']);
 for(const sport of ADAPTIVE_SPORTS){
  const out=adaptivePrediction({research:research(),target:target(sport),now:NOW});
  assert.equal(out.available,false,sport);assert.equal(out.code,'MODEL_WITHHELD');
  assert.equal(out.engine,'Auto Scout Adaptive');assert.equal(out.validation.method,'rolling-player-history');
  assert.ok(out.validation.observations>0);assert.equal(out.probabilityOver,null);assert.equal(out.projection,null);
 }
});

test('nine completed games can fit a projection candidate but cannot authorize a probability',()=>{
 for(const n of [7,8])assert.equal(adaptivePrediction({research:research(logs(n)),target:target(),now:NOW}).code,'MODEL_NOT_READY');
 const nine=adaptivePrediction({research:research(logs(9)),target:target(),now:NOW});
 assert.equal(nine.available,false);assert.equal(nine.code,'MODEL_WITHHELD');assert.equal(nine.validation.observations,0);
 const base=logs(12),future={gameId:'future',date:'2026-10-01T00:00:00Z',opponent:'BOS',value:99999};
 const a=fitAdaptiveHistory({research:research(base),target:target(),now:NOW});
 const b=fitAdaptiveHistory({research:research([...base,future]),target:target(),now:NOW});
 assert.equal(a.projection,b.projection);assert.equal(a.featureCutoff,b.featureCutoff);assert.ok(Date.parse(a.featureCutoff)<NOW);
});

test('snapshot store uses the shared fail-closed adaptive path only with explicit research injection',async()=>{
 const t=target(),calls=[];
 const store=createMLStore({file:'/tmp/definitely-missing-autoscout-model-feed.json',clock:()=>NOW,research:async p=>{calls.push(p);return research(logs(24));}});
 const out=await store.lookup(t);
 assert.equal(out.available,false);assert.equal(out.code,'MODEL_WITHHELD');assert.equal(out.engine,'Auto Scout Adaptive');
 assert.equal(targetKey(out),targetKey(t));assert.equal(calls.length,1);
 assert.equal(calls[0].providerMarketKey,t.marketId);assert.equal(calls[0].games,30);assert.equal(calls[0].eventId,t.eventId);
 assert.equal(calls[0].gameStartTime,new Date(t.gameStartTime).toISOString());
});

test('deep verified fallback repairs short samples without relaxing the probability gate',async()=>{
 const calls=[],t=target();
 const store=createMLStore({file:'/tmp/definitely-missing-autoscout-deep-model-feed.json',clock:()=>NOW,research:async p=>{
  calls.push(p);return research(logs(p.historyYears===3?24:8));
 }});
 const out=await store.lookup(t);
 assert.equal(out.code,'MODEL_WITHHELD');assert.equal(calls.length,2);
 assert.equal(calls[0].historyYears,undefined);assert.equal(calls[1].historyYears,3);
 assert.equal(calls[1].games,30);assert.equal(calls[1].eventId,t.eventId);assert.equal(calls[1].gameStartTime,new Date(t.gameStartTime).toISOString());
});

test('null, duplicated and future records cannot incorrectly suppress deep-history recovery',async()=>{
 for(const broken of [logs(12).map(r=>({...r,value:null})),Array(12).fill(logs(1)[0]),
  logs(12).map(r=>({...r,date:'2026-10-01T00:00:00Z'}))]){
  const calls=[];const store=createMLStore({file:'/tmp/definitely-missing-invalid-history.json',clock:()=>NOW,research:async p=>{
   calls.push(p);return research(p.historyYears===3?logs(24):broken);
  }});
  assert.equal((await store.lookup(target())).code,'MODEL_WITHHELD');assert.equal(calls.length,2);
 }
});

test('snapshot-only callers preserve legacy missing-model semantics',async()=>{
 const store=createMLStore({file:'/tmp/definitely-missing-autoscout-snapshot.json',clock:()=>NOW});
 assert.equal((await store.lookup(target())).code,'MODEL_NOT_READY');
});

test('live, alternate and team targets remain unavailable before history loading',async()=>{
 let calls=0;const store=createMLStore({file:'/tmp/no-model-feed.json',clock:()=>NOW,research:async()=>{calls++;return research();}});
 assert.equal((await store.lookup({...target(),live:true})).code,'PREMATCH_ONLY');
 assert.equal((await store.lookup({...target(),isAlternate:true})).code,'MARKET_NOT_SUPPORTED');
 assert.equal((await store.lookup({...target(),entityType:'team'})).code,'MARKET_NOT_SUPPORTED');assert.equal(calls,0);
});

test('genuinely validated exact snapshot models retain priority and their probabilities',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'oblige-ml-v3-')),file=path.join(dir,'predictions.json');
 try{
  const model={id:'fixture-model',version:'fixture-v1',sport:'NBA',marketId:'player_points',artifactSha256:'a'.repeat(64),sourceCommit:ML_SOURCE_COMMIT,
   trainedThrough:'2026-07-01T00:00:00Z',validation:{method:'chronological-heldout-real-lines',passed:true,dataSha256:'b'.repeat(64),
    observations:300,events:60,brier:.20,bookBrier:.22,calibrationError:.02,brierDeltaUpper95:-.001,start:'2026-07-02T00:00:00Z',end:'2026-09-01T00:00:00Z'}};
  const row={...target(),modelId:model.id,sourceKind:'trained-model-output',sourceRecordSha256:'c'.repeat(64),projection:23,
   probabilityOver:.6,probabilityUnder:.4,probabilityPush:0,generatedAt:new Date(NOW-1000).toISOString(),expiresAt:new Date(NOW+60000).toISOString(),featureCutoff:new Date(NOW-2000).toISOString()};
  await writeFile(file,JSON.stringify({version:1,engine:ML_ENGINE,sourceCommit:ML_SOURCE_COMMIT,models:[model],predictions:[row]}));
  let calls=0;const store=createMLStore({file,clock:()=>NOW,research:async()=>{calls++;return research();}});
  const out=await store.lookup(target());assert.equal(out.available,true);assert.equal(out.engine,ML_ENGINE);assert.equal(out.probabilityOver,.6);assert.equal(calls,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
