import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptivePrediction,ADAPTIVE_SPORTS} from '../lib/ml/adaptive.mjs';
import {createMLStore} from '../lib/ml/snapshot-store.mjs';
import {targetKey} from '../lib/ml/contract.mjs';

const NOW=Date.parse('2026-09-13T15:00:00Z');
function target(sport='NBA',line=22.5){return {sport,eventId:'evt-1',playerId:'player-1',playerName:'Verified Player',marketId:sport==='NFL'?'player_pass_attempts':'player_points',sportsbookKey:'prizepicks',gameStartTime:'2026-09-14T00:00:00Z',line,entityType:'player',live:false,isAlternate:false};}
function logs(n=22,{integer=true,volatile=false}={}){return Array.from({length:n},(_,i)=>({gameId:'g'+i,date:new Date(Date.parse('2026-01-01T00:00:00Z')+i*7*86400000).toISOString(),opponent:i%4===0?'BOS':'NYK',value:volatile?(i%2?40:3):integer?18+(i%7)+Math.floor(i/8):18.2+(i%7)*.7+i*.08}));}
function research(gameLog=logs()){return {available:true,gameLog,opponent:'BOS',matchup:{opponent:'BOS'}};}

test('adaptive model is configured for every current Auto Scout research sport',()=>{
 assert.deepEqual(ADAPTIVE_SPORTS,['NFL','NBA','WNBA','MLB','NHL','NCAAF','NCAAB','MLS','EPL','UCL']);
 for(const sport of ADAPTIVE_SPORTS){const out=adaptivePrediction({research:research(),target:target(sport),now:NOW});assert.equal(out.available,true,sport);assert.equal(out.engine,'Auto Scout Adaptive');assert.equal(out.validation.method,'rolling-player-history');assert.ok(out.validation.observations>0);assert.ok(['trained-adjustment','recent-mean-fallback'].includes(out.validation.selectedStrategy));assert.ok(Number.isFinite(out.projection));assert.ok(Math.abs(out.probabilityOver+out.probabilityUnder+out.probabilityPush-1)<1e-9);}
});

test('model requires nine verified completed games and rejects future rows',()=>{
 for(const n of [7,8]){const short=adaptivePrediction({research:research(logs(n)),target:target(),now:NOW});assert.equal(short.available,false);assert.equal(short.code,'MODEL_NOT_READY');}
 const nine=adaptivePrediction({research:research(logs(9)),target:target(),now:NOW});assert.equal(nine.available,true);
 const base=logs(12),future={gameId:'future',date:'2026-10-01T00:00:00Z',opponent:'BOS',value:99999};
 const a=adaptivePrediction({research:research(base),target:target(),now:NOW});
 const b=adaptivePrediction({research:research([...base,future]),target:target(),now:NOW});
 assert.equal(a.available,true);assert.equal(b.available,true);assert.equal(a.projection,b.projection);assert.equal(a.featureCutoff,b.featureCutoff);assert.ok(Date.parse(a.featureCutoff)<=NOW);
});

test('higher line never raises model over probability and integer line exposes push mass',()=>{
 const r=research(logs(25));
 const low=adaptivePrediction({research:r,target:target('NBA',19.5),now:NOW});
 const high=adaptivePrediction({research:r,target:target('NBA',27.5),now:NOW});
 const integer=adaptivePrediction({research:r,target:target('NBA',23),now:NOW});
 assert.ok(low.probabilityOver>high.probabilityOver);assert.equal(low.probabilityPush,0);assert.ok(integer.probabilityPush>0);
});

test('trained adjustment cannot outrank a worse rolling model over recent-mean baseline',()=>{
 const out=adaptivePrediction({research:research(logs(30,{volatile:true})),target:target('NBA',22.5),now:NOW});
 assert.equal(out.available,true);
 if(out.validation.rmse>=out.validation.baselineRmse)assert.equal(out.validation.selectedStrategy,'recent-mean-fallback');
});

test('snapshot store uses adaptive model when no validated snapshot exists and research is explicitly injected',async()=>{
 const t=target('NBA',22.5),calls=[];
 const store=createMLStore({file:'/tmp/definitely-missing-autoscout-model-feed.json',clock:()=>NOW,research:async p=>{calls.push(p);return research(logs(24));}});
 const out=await store.lookup(t);
 assert.equal(out.available,true);assert.equal(out.engine,'Auto Scout Adaptive');assert.equal(targetKey(out),targetKey(t));assert.equal(calls.length,1);assert.equal(calls[0].providerMarketKey,t.marketId);
});

test('snapshot-only callers preserve legacy missing-model semantics',async()=>{
 const store=createMLStore({file:'/tmp/definitely-missing-autoscout-snapshot.json',clock:()=>NOW});
 assert.equal((await store.lookup(target('NBA',22.5))).code,'MODEL_NOT_READY');
});

test('live, alternate and team targets remain unavailable before any history training',async()=>{
 let calls=0;const store=createMLStore({file:'/tmp/no-model-feed.json',clock:()=>NOW,research:async()=>{calls++;return research();}});
 assert.equal((await store.lookup({...target(),live:true})).code,'PREMATCH_ONLY');
 assert.equal((await store.lookup({...target(),isAlternate:true})).code,'MARKET_NOT_SUPPORTED');
 assert.equal((await store.lookup({...target(),entityType:'team'})).code,'MARKET_NOT_SUPPORTED');
 assert.equal(calls,0);
});
