import test from 'node:test';
import assert from 'node:assert/strict';
import {createOddsRequestGate,oddsRequestKey} from '../lib/autoscout/providers/odds-request-gate.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
test('10 identical concurrent requests share one operation',async()=>{
 const gate=createOddsRequestGate({spacingMs:0,paused:()=>false});const hold=deferred();let calls=0;
 const all=Array.from({length:10},()=>gate.run('same',async()=>{calls++;return hold.promise;}));
 assert.equal(calls,1);hold.resolve(12);assert.deepEqual(await Promise.all(all),Array(10).fill(12));assert.equal(gate.state().joins,9);
});
test('request identity canonicalizes market, bookmaker and region sets',()=>{
 assert.equal(oddsRequestKey('/events/a/odds',{markets:'a,b',bookmakers:'x,y'}),oddsRequestKey('/events/a/odds',{bookmakers:'y,x',markets:'b,a'}));
 assert.notEqual(oddsRequestKey('/events/a/odds',{markets:'a'}),oddsRequestKey('/events/b/odds',{markets:'a'}));
});
test('global concurrency applies across leagues and pending requests',async()=>{
 const gate=createOddsRequestGate({spacingMs:0,paused:()=>false,maxRequestsPerHour:()=>100});let active=0,peak=0;
 await Promise.all(Array.from({length:12},(_,i)=>gate.run('sport-'+i,async()=>{peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,3));active--;return i;})));
 assert.equal(peak,2);assert.equal(gate.state().active,0);
});
test('paused provider rejects before any paid operation launches',async()=>{
 let calls=0;const gate=createOddsRequestGate({spacingMs:0,paused:()=>true});
 await assert.rejects(gate.run('paid',async()=>{calls++;return 1;}),{code:'PAID_PROVIDER_PAUSED'});
 assert.equal(calls,0);assert.equal(gate.state().launches,0);assert.equal(gate.state().rejected,1);assert.equal(gate.state().paused,true);
});
test('hourly launch budget blocks accidental request loops and resets after one hour',async()=>{
 let clock=0;const gate=createOddsRequestGate({spacingMs:0,now:()=>clock,paused:()=>false,maxRequestsPerHour:()=>2});
 assert.equal(await gate.run('a',async()=>1),1);assert.equal(await gate.run('b',async()=>2),2);
 await assert.rejects(gate.run('c',async()=>3),{code:'REQUEST_BUDGET_EXHAUSTED'});
 assert.equal(gate.state().launchesLastHour,2);assert.equal(gate.state().maxRequestsPerHour,2);
 clock=3600001;assert.equal(await gate.run('d',async()=>4),4);assert.equal(gate.state().launchesLastHour,1);
});
test('429 respects Retry-After, blocks queued calls, and admits only one recovery probe',async()=>{
 let clock=1000,calls=0;const states=[];const gate=createOddsRequestGate({concurrency:1,spacingMs:0,now:()=>clock,onState:s=>states.push(s),paused:()=>false});
 const first=gate.run('a',async()=>{calls++;throw Object.assign(new Error('limited'),{status:429,retryAfter:'60'});});
 const second=gate.run('b',async()=>{calls++;});
 await assert.rejects(first,{status:429});await assert.rejects(second,{code:'PROVIDER_COOLDOWN'});
 assert.equal(states[0].blockedUntil,61000);clock=60999;
 await assert.rejects(gate.run('c',async()=>{calls++;}),{code:'PROVIDER_COOLDOWN'});assert.equal(calls,1);
 clock=61000;const hold=deferred();const probe=gate.run('probe',()=>hold.promise);
 const extra=gate.run('other',()=>{calls++;return 1;});hold.resolve('ok');await probe;await extra;
 assert.equal(gate.state().circuit,'CLOSED');
});
test('parallel callers cannot bypass a half-open probe',async()=>{
 let clock=0;const gate=createOddsRequestGate({spacingMs:0,now:()=>clock,initialState:{blockedUntil:10},paused:()=>false});clock=10;
 const hold=deferred();const probe=gate.run('probe',()=>hold.promise);
 await assert.rejects(gate.run('other',()=>1),{code:'PROVIDER_COOLDOWN'});
 hold.resolve(1);await probe;assert.equal(gate.state().circuit,'CLOSED');
});
test('HTTP-date Retry-After and bounded fallback backoff',async()=>{
 let clock=Date.parse('2026-09-13T12:00:00Z');const gate=createOddsRequestGate({spacingMs:0,now:()=>clock,random:()=>0.5,paused:()=>false});
 await assert.rejects(gate.run('a',async()=>{throw Object.assign(new Error(),{status:429,retryAfter:'Sun, 13 Sep 2026 12:01:00 GMT'});}));
 assert.equal(gate.state().blockedUntil,clock+60000);clock+=60000;
 await assert.rejects(gate.run('a',async()=>{throw Object.assign(new Error(),{status:429});}));
 assert.equal(gate.state().blockedUntil,clock+20000);
});
test('repeated 5xx opens circuit; operation timeout is bounded without a retry loop',async()=>{
 const gate=createOddsRequestGate({spacingMs:0,timeoutMs:10,paused:()=>false});
 for(let i=0;i<3;i++)await assert.rejects(gate.run(String(i),async()=>{throw Object.assign(new Error(),{status:503});}));
 await assert.rejects(gate.run('blocked',()=>1),{code:'PROVIDER_COOLDOWN'});
 const timed=createOddsRequestGate({spacingMs:0,timeoutMs:10,paused:()=>false});
 const keep=setTimeout(()=>{},30);
 await assert.rejects(timed.run('timeout',signal=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason)))) ,{name:'TimeoutError'});clearTimeout(keep);
});
