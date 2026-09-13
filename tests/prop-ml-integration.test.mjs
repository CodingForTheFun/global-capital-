/** Synthetic fixtures below test plumbing/math only. Never installed in runtime data. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {ML_ENGINE,ML_SOURCE_COMMIT,predictionTarget,targetKey,validatedModel,validatePrediction,validProbabilities} from '../lib/ml/contract.mjs';
import {createMLStore} from '../lib/ml/snapshot-store.mjs';
import {createMLHandler} from '../lib/ml/routes.mjs';
import {evaluateHeldout} from '../lib/ml/evaluate.mjs';
import {buildSportstradamusSnapshot} from '../lib/ml/sportstradamus.mjs';
import {createMLClient,predictionHtml} from '../lib/ui/ml-prediction.mjs';
import {gatedApi} from '../lib/auth/gate.mjs';
const NOW=Date.parse('2026-09-12T19:00:00Z');
const target={sport:'NBA',eventId:'test-game',playerId:'test-athlete',playerName:'Test Athlete',marketId:'player_points',sportsbookKey:'prizepicks',gameStartTime:'2026-09-12T21:00:00Z',line:22.5,entityType:'player',live:false,isAlternate:false};
const model={id:'test-model',version:'test-v1',sport:'NBA',marketId:'player_points',sourceCommit:ML_SOURCE_COMMIT,artifactSha256:'a'.repeat(64),trainedThrough:'2025-01-01T00:00:00Z',validation:{method:'chronological-heldout-real-lines',passed:true,dataSha256:'b'.repeat(64),observations:400,events:100,brier:.20,bookBrier:.25,brierDeltaUpper95:-.02,calibrationError:.02,start:'2025-03-01T00:00:00Z',end:'2025-06-30T00:00:00Z'}};
const prediction={...target,modelId:model.id,sourceKind:'trained-model-output',sourceRecordSha256:'c'.repeat(64),generatedAt:'2026-09-12T18:59:00Z',expiresAt:'2026-09-12T19:14:00Z',featureCutoff:'2026-09-12T18:00:00Z',projection:25.2,probabilityOver:.65,probabilityUnder:.35,probabilityPush:0};
const snapshot={version:1,engine:ML_ENGINE,sourceCommit:ML_SOURCE_COMMIT,models:[model],predictions:[prediction]};
async function withStore(fn,p=snapshot){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'prop-ml-test-')),file=path.join(dir,'predictions.json');if(p)await fs.writeFile(file,JSON.stringify(p));const store=createMLStore({file,clock:()=>NOW,pollMs:0});try{await fn(store,file);}finally{await fs.rm(dir,{recursive:true,force:true});}}

test('ML target separates event, athlete, exact line, sport and book, without splitting sides',()=>{
 for(const [key,value] of Object.entries({eventId:'other',playerId:'other',marketId:'player_rebounds',sportsbookKey:'underdog',sport:'WNBA',line:23.5,playerName:'Namesake',gameStartTime:'2026-09-13T21:00:00Z'}))assert.notEqual(targetKey(target),targetKey({...target,[key]:value}));
 assert.equal(targetKey({...target,side:'UNDER'}),targetKey({...target,side:'OVER'}));
 for(const line of [null,'22.5',NaN,Infinity,false])assert.equal(predictionTarget({...target,line}),null);
 assert.equal(predictionTarget({...target,gameStartTime:'2026-09-12'}),null);
});
test('no model file is honest MODEL_NOT_READY, not invented scores',async()=>withStore(async s=>{
 const p=await s.lookup(target);assert.equal(p.available,false);assert.equal(p.code,'MODEL_NOT_READY');assert.equal(p.probabilityOver,undefined);
 assert.equal((await s.lookup({...target,sport:'MLS'})).code,'SPORT_NOT_SUPPORTED');
 assert.equal((await s.lookup({...target,entityType:'team'})).code,'MARKET_NOT_SUPPORTED');
},null));
test('real model contract returns separate projection and three-way probabilities',async()=>withStore(async s=>{
 const p=await s.lookup(target);assert.equal(p.available,true);assert.equal(p.projection,25.2);assert.equal(p.probabilityOver,.65);assert.equal(p.modelled,true);assert.equal(p.validation.observations,400);assert.equal(p.gameLog,undefined);
 assert.equal((await s.lookup({...target,line:23.5})).code,'NO_EXACT_PREDICTION');
 assert.equal((await s.lookup({...target,eventId:'another'})).available,false);
 assert.equal((await s.lookup({...target,live:true})).code,'PREMATCH_ONLY');
}));
test('expired result, invalid file and disappearing file never reuse old scores',async()=>withStore(async(s,file)=>{
 await fs.writeFile(file,JSON.stringify({...snapshot,predictions:[{...prediction,expiresAt:'2026-09-12T18:59:30Z'}]}));assert.equal((await s.lookup(target)).code,'PREDICTION_EXPIRED');
 await fs.writeFile(file,'broken');assert.equal((await s.lookup(target)).code,'MODEL_FEED_UNAVAILABLE');
 await fs.rm(file);assert.equal((await s.lookup(target)).code,'MODEL_NOT_READY');
}));
test('unvalidated models, false probability mass and future features are withheld',()=>{
 assert.ok(validatedModel(model));
 for(const validation of [{...model.validation,observations:4},{...model.validation,passed:false},{...model.validation,calibrationError:.4},{...model.validation,brierDeltaUpper95:.02}])assert.equal(validatedModel({...model,validation}),false);
 assert.equal(validatedModel({...model,version:'book_fallback'}),false);
 for(const row of [{...prediction,featureCutoff:'2026-09-13T00:00:00Z'},{...prediction,probabilityOver:NaN},{...prediction,probabilityPush:.2},{...prediction,projection:null}])assert.equal(validatePrediction(row,model,NOW),null);
 assert.ok(validProbabilities({probabilityOver:.5,probabilityUnder:.4,probabilityPush:.1}));
});
test('conflicting duplicate forecasts fail closed and file symlinks are rejected',async()=>{
 await withStore(async s=>assert.equal((await s.lookup(target)).available,false),{...snapshot,predictions:[prediction,{...prediction,projection:33}]});
 await withStore(async(s,file)=>{const copy=file+'.copy';await fs.rename(file,copy);await fs.symlink(copy,file);assert.equal((await s.lookup(target)).code,'MODEL_FEED_UNAVAILABLE');});
});
const scored={League:'NBA',Player:'Test Athlete',Market:'PTS',Platform:'PrizePicks',Commence:target.gameStartTime,Line:22.5,Bet:'Over','Win Prob':.65,'Push Prob':0,Projection:25.2,'Model Version':'test-v1'};
const metadata={generated_at:prediction.generatedAt,feature_cutoff:prediction.featureCutoff,source_commit:ML_SOURCE_COMMIT};
const build=(s=[scored],board={props:[{...target,side:'OVER'},{...target,side:'UNDER'}]})=>buildSportstradamusSnapshot({scoredOffers:s,metadata,board,models:[model],now:NOW});
test('upstream adapter reads Projection, not EV; exact canonical identity retained',()=>{
 const p=build([{...scored,'Model EV':99}]);assert.equal(p.predictions.length,1);assert.equal(p.predictions[0].projection,25.2);assert.equal(p.predictions[0].playerId,target.playerId);assert.equal(p.predictions[0].probabilityUnder,.35);
 const under=build([{...scored,Bet:'Under'}]).predictions[0];assert.equal(under.probabilityUnder,.65);
});
test('upstream ambiguous, stale, clamped, promoted and wrong-book rows cannot be called ML',()=>{
 for(const r of [{...scored,'Win Prob':.9},{...scored,'Push Prob':.1},{...scored,Line:22},{...scored,'Model Version':'book_fallback'},{...scored,Market:'PTS_Q1'},{...scored,Platform:'Underdog'},{...scored,Commence:'2026-09-12'}])assert.equal(build([r]).predictions.length,0);
 assert.equal(build([scored],{props:[target,{...target,playerId:'namesake'}]}).predictions.length,0);
 assert.equal(build([scored],{props:[{...target,isPromotional:true}]}).predictions.length,0);
});
function evidence(){const records=[];for(let i=0;i<400;i++){
 const day=Math.floor(i/4),kick=Date.parse('2025-03-02T20:00:00Z')+day*86400000,over=i%10<7;
 records.push({eventId:'fixture-game-'+day,playerId:'fixture-athlete-'+i%4,gameStartTime:new Date(kick).toISOString(),forecastAt:new Date(kick-3600000).toISOString(),settledAt:new Date(kick+4*3600000).toISOString(),oddsObservedAt:new Date(kick-7200000).toISOString(),sourceOddsRecordId:'test-odds-'+i,sourceStatsRecordId:'test-stats-'+i,line:22.5,actualValue:over?30:20,projection:27,probabilityOver:.7,probabilityUnder:.3,probabilityPush:0,overPrice:-110,underPrice:-110});
 }return {model:{...model,validation:undefined},records};}
test('held-out gate computes metrics and forbids train/test leakage, later odds and duplicate evidence',()=>{
 const input=evidence(),r=evaluateHeldout(input,{now:NOW});assert.equal(r.validation.observations,400);assert.equal(r.validation.events,100);assert.ok(Math.abs(r.validation.brier-.21)<1e-8);assert.ok(r.validation.passed);
 for(const altered of [{...input,records:input.records.slice(0,20)}])assert.equal(evaluateHeldout(altered,{now:NOW}).validation.passed,false);
 assert.throws(()=>evaluateHeldout({...input,records:[...input.records,input.records[0]]},{now:NOW}));
 assert.throws(()=>evaluateHeldout({...input,model:{...input.model,trainedThrough:'2026-01-01T00:00:00Z'}},{now:NOW}));
 assert.throws(()=>evaluateHeldout({...input,records:[{...input.records[0],oddsObservedAt:input.records[0].settledAt}]},{now:NOW}));
});
test('client batches requests, deduplicates simultaneous subscribers, and never invokes LLM endpoint',async()=>{
 const requests=[];const client=createMLClient({clock:()=>NOW,fetcher:async(url,options)=>{
  requests.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({ok:true,results:Object.fromEntries(JSON.parse(options.body).props.map(p=>[p.key,{available:false,code:'MODEL_NOT_READY',message:'No trained model'}]))})};
 }});
 const same=client.lookup(target);assert.equal(same,client.lookup({...target,side:'UNDER'}));
 await Promise.all([same,...Array.from({length:51},(_,i)=>client.lookup({...target,playerId:'fixture-'+i}))]);
 assert.equal(requests.length,3);assert.ok(requests.every(r=>r.url==='/api/props/ml'&&r.body.props.length<=24));
 await client.lookup(target);assert.equal(requests.length,3);
});
test('client rejects responses for other props; escaped UI never replaces absence with 50/50',async()=>{
 const client=createMLClient({clock:()=>NOW,fetcher:async()=>({ok:true,json:async()=>({ok:true,results:{'0':{...prediction,available:true,line:999}}})})});
 assert.equal((await client.lookup(target)).code,'TARGET_UNVERIFIED');
 assert.ok(predictionHtml({available:false,code:'MODEL_NOT_READY',message:'<script>bad()</script>'}).includes('&lt;script&gt;'));
 assert.ok(!predictionHtml({available:false,code:'MODEL_NOT_READY',message:'Not ready'}).includes('50%'));
});
test('ML route is gated, bounded, read-only, and handles per-prop results',async()=>{
 assert.ok(gatedApi('/api/props/ml'));
 const source=readFileSync(new URL('../frontdoor-prod.mjs',import.meta.url),'utf8');assert.ok(source.indexOf('if (await maybeServeGate(req, res))')<source.indexOf('if (await maybeServeML(req, res))'));
 assert.ok(source.includes("'lib/ml/contract.mjs'"));assert.ok(source.includes("'lib/ui/ml-prediction.mjs'"));
 const handler=createMLHandler({store:{lookup:async()=>({available:false,code:'MODEL_NOT_READY'})}});
 const server=http.createServer(async(req,res)=>{if(!await handler(req,res)){res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port+'/api/props/ml';
 try{
  assert.equal((await fetch(base)).status,405);
  const post=props=>fetch(base,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({props})});
  assert.equal((await post(Array.from({length:25},(_,i)=>({...target,key:String(i)})))).status,400);
  assert.equal((await post([{...target,key:'__proto__'}])).status,400);
  const r=await (await post([{...target,key:'0'}])).json();assert.equal(r.results['0'].code,'MODEL_NOT_READY');
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
