import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
let seq=0;
async function api(){const source=readFileSync(new URL('../lib/api.ts',import.meta.url),'utf8');const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;return import(`data:text/javascript;base64,${Buffer.from(js+'\n//'+seq++).toString('base64')}`);}
const group={sport:'NFL',player:'Fixture Player',market:'Passing Yards',line:200.5};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('60-second rate limit is not retried after five seconds; queued work stops and cache survives',async()=>{
 const oldFetch=globalThis.fetch,oldNow=Date.now;let now=100000,calls=0;Date.now=()=>now;
 try {const {fetchResearch,researchRetryAt}=await api();
 globalThis.fetch=async()=>{calls++;return calls===1?Response.json({available:true,gameLog:[]}):Response.json({code:'RATE_LIMITED'},{status:429,headers:{'retry-after':'60'}});};
 await fetchResearch(group,'OVER');
 await assert.rejects(fetchResearch({...group,player:'Other Player'},'OVER'),e=>e.status===429&&e.retryAt===160000);
 assert.equal(calls,2);assert.equal(researchRetryAt(),160000);
 now+=5000;await assert.rejects(fetchResearch({...group,player:'Third Player'},'OVER'),e=>e.status===429);assert.equal(calls,2);
 assert.equal((await fetchResearch(group,'OVER')).available,true);assert.equal(calls,2);
 now=160001;globalThis.fetch=async()=>{calls++;return Response.json({available:true});};await fetchResearch(group,'OVER');assert.equal(calls,3);
 }finally{globalThis.fetch=oldFetch;Date.now=oldNow;}
});
test('same request coalesces; aborting one view does not abort another',async()=>{
 const oldFetch=globalThis.fetch;let calls=0,release;
 try{const {fetchResearch}=await api();globalThis.fetch=async()=>{calls++;return new Promise(resolve=>{release=resolve;});};
 const abort=new AbortController();const first=fetchResearch(group,'OVER',abort.signal);const rejection=assert.rejects(first,e=>e.code==='ABORTED');
 const second=fetchResearch(group,'OVER');abort.abort();await rejection;assert.equal(calls,1);release(Response.json({available:true}));assert.equal((await second).available,true);await tick();
 await fetchResearch(group,'OVER');assert.equal(calls,1);
 }finally{globalThis.fetch=oldFetch;}
});
test('concurrency remains four and abandoned queued requests never fetch',async()=>{
 const oldFetch=globalThis.fetch;let calls=0;const releases=[];
 try{const {fetchResearch}=await api();globalThis.fetch=async()=>{calls++;return new Promise(resolve=>releases.push(resolve));};
 const work=Array.from({length:4},(_,i)=>fetchResearch({...group,player:'Fixture '+i},'OVER'));
 const abort=new AbortController();const queued=fetchResearch({...group,player:'Cancelled Fixture'},'OVER',abort.signal);const rejection=assert.rejects(queued,e=>e.code==='ABORTED');abort.abort();await rejection;
 assert.equal(calls,4);releases.forEach(resolve=>resolve(Response.json({available:true})));await Promise.all(work);await tick();assert.equal(calls,4);
 }finally{globalThis.fetch=oldFetch;}
});
test('429 rejects the remaining queue without dispatching more requests',async()=>{
 const oldFetch=globalThis.fetch;let calls=0;const releases=[];
 try{const {fetchResearch}=await api();globalThis.fetch=async()=>{calls++;return new Promise(resolve=>releases.push(resolve));};
 const work=Array.from({length:10},(_,i)=>fetchResearch({...group,player:'Fixture '+i},'OVER'));const results=Promise.allSettled(work);
 releases.forEach(resolve=>resolve(Response.json({}, {status:429,headers:{'retry-after':'60'}})));const settled=await results;assert.equal(calls,4);assert.equal(settled.filter(x=>x.status==='rejected'&&x.reason.status===429).length,10);
 }finally{globalThis.fetch=oldFetch;}
});
test('HTTP-date Retry-After and absent-header fallback are not shortened',async()=>{
 const oldFetch=globalThis.fetch,oldNow=Date.now;Date.now=()=>100000;
 try{for(const header of [new Date(180000).toUTCString(),null]){const {fetchResearch}=await api();globalThis.fetch=async()=>Response.json({}, {status:429,headers:header?{'retry-after':header}:{}});await assert.rejects(fetchResearch(group,'OVER'),e=>e.retryAt===(header?180000:160000));}}
 finally{globalThis.fetch=oldFetch;Date.now=oldNow;}
});
test('board batch identity is order-independent and cooldown is not missing history',()=>{
 const board=readFileSync(new URL('../components/terminal-board.tsx',import.meta.url),'utf8');assert.match(board,/page\.map\(\(group\) => group\.key\)\.sort\(\)\.join/);
 const view=readFileSync(new URL('../components/player-view.tsx',import.meta.url),'utf8');assert.ok(view.includes('Research temporarily paused'));assert.ok(view.includes('Retry in ${retryIn}s'));assert.ok(view.includes('researchIdentity, researchAttempt'));assert.ok(view.includes('Photo credit'));
});
