import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'odds-resilience-'));
process.env.DATA_DIR=dir;process.env.THE_ODDS_API_KEY='mock-not-live';
process.env.THE_ODDS_API_REQUEST_SPACING_MS='100';
const nativeFetch=globalThis.fetch,nativeNow=Date.now;
let time=nativeNow(),calls=[],mode='good',release,hold;
Date.now=()=>time;
const {fetchBoard,theOddsApiProvider}=await import('../lib/autoscout/providers/the-odds-api.mjs');
const {writeCachedBoard,readCachedBoard}=await import('../lib/autoscout/runtime-store.mjs');

const event={id:'fixture',commence_time:'2099-01-01T00:00:00Z',home_team:'Home',away_team:'Away'};
globalThis.fetch=async url=>{
 const u=new URL(url);calls.push(u.pathname);
 if(hold)await hold;
 if(mode==='429')return new Response('{}',{status:429,headers:{'retry-after':'60'}});
 if(mode==='failure')throw new TypeError('mock network failure');
 if(u.pathname.endsWith('/events'))return Response.json([event]);
 if(u.pathname.endsWith('/markets'))return Response.json({bookmakers:mode==='empty'?[]:[{key:'draftkings',markets:[{key:'player_points'}]}]});
 return Response.json({...event,bookmakers:[{key:'draftkings',title:'DraftKings',markets:[{key:'player_points',last_update:'2026-09-13T12:00:00Z',outcomes:[{name:'Over',description:'Fixture Player',point:5.5,price:-110},{name:'Under',description:'Fixture Player',point:5.5,price:-105}]}]}]});
};
async function settle(){while(theOddsApiProvider.health().refreshesInFlight)await new Promise(r=>setTimeout(r,10));}
async function waitForCalls(min=1){
 for(let attempt=0;attempt<200&&calls.length<min;attempt+=1)await new Promise(r=>setTimeout(r,5));
}
test('board cache and provider-failure regressions with mocked upstream only',async t=>{
 try{
  await t.test('ten cold requests including forced refresh share one refresh sequence',async()=>{
   hold=new Promise(r=>release=r);const pending=Array.from({length:10},(_,i)=>fetchBoard('NBA',{force:i%2===0}));
   await waitForCalls(1);assert.equal(calls.length,1);hold=null;release();
   const boards=await Promise.all(pending);assert.equal(calls.length,3);assert.ok(boards.every(b=>b.props.length===2));
   assert.equal(boards[0].props[0].price,-110);assert.equal(boards[0].props[1].price,-105);
  });
  await t.test('stale reads return before refresh and trigger only one shared background sequence',async()=>{
   const good=await readCachedBoard('NBA');await writeCachedBoard('NBA',good,30);time+=31000;calls=[];
   hold=new Promise(r=>release=r);
   const reads=await Promise.all(Array.from({length:10},()=>fetchBoard('NBA')));
   await waitForCalls(1);const observed=calls.length;hold=null;release();await settle();
   assert.ok(reads.every(b=>b.meta.stale&&b.meta.revalidating&&b.props.length===2),JSON.stringify(reads.map(b=>b.meta)));
   assert.equal(observed,1);
   assert.equal(calls.filter(p=>p.endsWith('/markets')).length,0,'discovery survives price expiry');
   assert.equal(calls.length,2);
  });
  await t.test('no useful markets are temporarily cached even for forced refreshes',async()=>{
   mode='empty';calls=[];const board=await fetchBoard('NHL',{force:true});assert.equal(board.props.length,0);
   const count=calls.length;await fetchBoard('NHL',{force:true});assert.equal(calls.length,count);
   time+=301000;mode='good';const revived=await fetchBoard('NHL',{force:true});assert.equal(revived.props.length,2);
  });
  await t.test('cached board survives network failure and retains exact timestamps',async()=>{
   const good=await readCachedBoard('NBA');mode='failure';time+=31000;
   const stale=await fetchBoard('NBA',{force:true});assert.deepEqual(stale.props,good.props);assert.equal(stale.meta.fetchedAt,good.meta.fetchedAt);assert.equal(stale.meta.stale,true);
  });
  await t.test('429 cooldown survives other league callers and never erases a cached board',async()=>{
   time+=31000;mode='429';calls=[];const stale=await fetchBoard('NBA',{force:true});assert.equal(stale.props.length,2);
   const count=calls.length;await fetchBoard('NHL',{force:true});assert.equal(calls.length,count);
   await assert.rejects(fetchBoard('MLB',{force:true}),{code:'PROVIDER_COOLDOWN'});assert.equal(calls.length,count);
   assert.equal(theOddsApiProvider.health().requestControl.blockedUntil,time+60000);
   const diagnostics=JSON.parse(await fs.readFile(path.join(dir,'autoscout/diagnostics.json'),'utf8'));
   // State persistence is asynchronous; the gate itself is immediate.
   assert.ok(diagnostics.quota);
   time+=60001;mode='good';const recovered=await fetchBoard('NBA',{force:true});assert.equal(recovered.props.length,2);assert.equal(theOddsApiProvider.health().requestControl.circuit,'CLOSED');
  });
 }finally{globalThis.fetch=nativeFetch;Date.now=nativeNow;await new Promise(r=>setTimeout(r,100));await fs.rm(dir,{recursive:true,force:true});}
});
