import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildResearchFeatures,scoreResearchModel,residualCdf} from '../lib/ml/research-projection.mjs';
import {createMLStore} from '../lib/ml/snapshot-store.mjs';
import {currentPrediction} from '../lib/ui/ml-prediction.mjs';

const pack=JSON.parse(await readFile(new URL('../data/ml/research/nfl-ridge-v1.json',import.meta.url),'utf8'));
const attempts=pack.models.find(m=>m.marketId==='player_pass_attempts');

test('NFL research model uses only verified prior logs and stable rolling features',()=>{
  const logs=Array.from({length:10},(_,i)=>({date:new Date(Date.UTC(2026,8,10-i*7)).toISOString(),passingAttempts:30+i}));
  const target={gameStartTime:'2026-09-17T17:00:00Z'};
  const f=buildResearchFeatures(attempts,logs,target);
  assert.equal(f.priorGames,10);
  assert.equal(f.restDays,7.708333333333333);
  assert.equal(f.attempts_lag1,30);
  assert.equal(f.attempts_lag2,31);
  assert.equal(f.attempts_mean3,31);
  assert.equal(f.attempts_mean5,32);
  assert.ok(Math.abs(f.attempts_std10-Math.sqrt(82.5/9))<1e-12);
  const projection=scoreResearchModel(attempts,f);
  assert.ok(Number.isFinite(projection)&&projection>=0);
});

test('empirical residual calibration is bounded and monotone',()=>{
  const q=attempts.validation.residualQuantiles;
  assert.equal(residualCdf(q,q[0]-1),0);
  assert.equal(residualCdf(q,q.at(-1)+1),1);
  assert.ok(residualCdf(q,0)>=residualCdf(q,-5));
  assert.ok(residualCdf(q,5)>=residualCdf(q,0));
});

test('strict ML store can safely fall back to a separately labelled research model',async()=>{
  const clock=()=>Date.parse('2026-09-13T10:00:00Z');
  const target={sport:'NFL',eventId:'event-1',playerId:'player-1',playerName:'Fixture Player',marketId:'player_pass_attempts',sportsbookKey:'draftkings',gameStartTime:'2026-09-13T17:00:00Z',line:31.5,entityType:'player',live:false,isAlternate:false};
  const researchStore={lookup:async input=>({...input,available:true,modelled:true,engine:'Auto Scout ML',code:'READY',modelVersion:'fixture-v1',projection:32.4,probabilityOver:.55,probabilityUnder:.45,probabilityPush:0,generatedAt:'2026-09-13T10:00:00Z',expiresAt:'2026-09-13T10:15:00Z',validation:{observations:598,events:272},message:'fixture'})};
  const store=createMLStore({file:'/definitely/not/a/model.json',clock,researchStore,pollMs:0});
  const value=await store.lookup(target);
  assert.equal(value.available,true);
  assert.equal(value.engine,'Auto Scout ML');
  assert.equal(currentPrediction(value,clock()).available,true);
});
