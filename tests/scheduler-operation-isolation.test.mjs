import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicIngestionRunner } from '../lib/ingestion/public-worker.mjs';
import { withIngestionDeadline } from '../lib/ingestion/operation-deadline.mjs';
import { persistPublicSnapshot } from '../lib/ingestion/public-persistence.mjs';
import { __testPersistBoards } from '../lib/autoscout/persistence-scheduler.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise, resolve, reject}; };
const flush = () => new Promise(resolve => setImmediate(resolve));
function env(t, values) {
  const before = {};
  for (const [key,value] of Object.entries(values)) { before[key]=process.env[key]; process.env[key]=value; }
  t.after(() => { for (const [key,value] of Object.entries(before)) { if(value===undefined)delete process.env[key];else process.env[key]=value; } });
}
const smallDeadline = (key, task) => withIngestionDeadline(key, task, key.startsWith('public-source:') || key==='public-claim' || key==='public-release' || key.startsWith('public-status:') ? 100 : 2000);

// Faults use deferred promises rather than actual upstream requests. Deadlines
// are overridden only in these tests; production polling and budgets are fixed.
test('a stalled provider is retained while the next provider and actual-owner release complete', async t => {
  env(t, { AUTOSCOUT_DRAFTKINGS_PUBLIC_ENABLED:'false' });
  const gate=deferred(), fetches=[], writes=[], owners=[]; let stalled=true;
  const runner=createPublicIngestionRunner({
    deadline:smallDeadline,
    claim:async()=>({claimed:true,owner:'database-owner'}), release:async owner=>owners.push(owner),
    feeds:{ refreshFeed:async source=>{ fetches.push(source); if(source==='prizepicks' && stalled)return gate.promise; return {status:'no_props',records:[],fetchedAt:new Date().toISOString()}; } },
    persistSnapshot:async source=>{ writes.push(source); return {written:0}; }, recordStatus:async()=>{},
  });
  const first=await runner.cycle();
  assert.equal(first.results[0].retained,true); assert.equal(first.results[0].code,'INGESTION_DEADLINE');
  assert.deepEqual(writes,['underdog']); assert.deepEqual(owners,['database-owner']);
  await runner.cycle();
  assert.equal(fetches.filter(x=>x==='prizepicks').length,1,'still-pending source is not polled twice');
  stalled=false; gate.resolve({status:'no_props',records:[],fetchedAt:new Date().toISOString()}); await flush();
  assert.ok(!writes.includes('prizepicks'),'late empty response must not finalize the previous good snapshot');
  await runner.cycle(); assert.ok(writes.includes('prizepicks'),'normal next cycle recovers after the old task settles');
});

test('an ambiguous timed-out claim authorizes no provider calls or guessed release', async t => {
  env(t, { AUTOSCOUT_DRAFTKINGS_PUBLIC_ENABLED:'false' });
  const gate=deferred(); let providers=0,releases=0;
  const runner=createPublicIngestionRunner({ deadline:smallDeadline, claim:()=>gate.promise,
    release:async()=>releases++, feeds:{refreshFeed:async()=>providers++}, recordStatus:async()=>{}, persistSnapshot:async()=>{} });
  await assert.rejects(runner.cycle(),{code:'INGESTION_DEADLINE'});
  gate.resolve({claimed:true,owner:'late-owner'}); await flush();
  assert.equal(providers,0); assert.equal(releases,0);
});

test('stalled best-effort status and lease release cannot wedge the worker', async t => {
  env(t, { AUTOSCOUT_DRAFTKINGS_PUBLIC_ENABLED:'false' });
  const status=deferred(), release=deferred(); const persisted=[];
  const runner=createPublicIngestionRunner({deadline:smallDeadline,
    claim:async()=>({claimed:true,owner:'database-owner'}), release:()=>release.promise,
    feeds:{refreshFeed:async()=>({status:'no_props',records:[],fetchedAt:new Date().toISOString()})},
    persistSnapshot:async source=>{persisted.push(source);return {written:0};},
    recordStatus:source=>source==='prizepicks'?status.promise:Promise.resolve(),
  });
  const result=await runner.cycle(); assert.equal(result.claimed,true);
  assert.deepEqual(persisted,['prizepicks','underdog']);
  status.resolve();release.resolve();await flush();
});

for(const failure of ['body','transport']) {
  test(`snapshot ${failure} timeout forbids another chunk, finalization and direct fallback`,async t=>{
    env(t,{AUTOSCOUT_SUPABASE_URL:'https://example.invalid',AUTOSCOUT_SUPABASE_PUBLISHABLE_KEY:'test-key',AUTOSCOUT_SUPABASE_INGEST_TOKEN:'test-token',AUTOSCOUT_PUBLIC_SNAPSHOT_BATCH_SIZE:'50',AUTOSCOUT_DIRECT_DB_FALLBACK:'true',AUTOSCOUT_DIRECT_DB_PRIMARY:'false',AUTOSCOUT_PUBLIC_FALLBACK_DELAY_MS:'0'});
    const original=globalThis.fetch; t.after(()=>{globalThis.fetch=original;});
    const gate=deferred(), calls=[]; let requestSignal;
    globalThis.fetch=async(url,init)=>{
      calls.push({url:String(url),payload:JSON.parse(init.body).p_payload}); requestSignal=init.signal;
      if(failure==='transport')return gate.promise;
      return {ok:true,status:200,json:()=>gate.promise};
    };
    await assert.rejects(withIngestionDeadline(`test-snapshot:${failure}`,()=>persistPublicSnapshot('prizepicks',Array.from({length:103},(_,i)=>({id:String(i)}))),100),{code:'INGESTION_DEADLINE'});
    assert.equal(requestSignal.aborted,true);
    if(failure==='transport')gate.reject(new Error('late transport failure'));else gate.resolve({written:50});
    await flush();await flush();
    assert.equal(calls.length,1);assert.equal(calls[0].payload.finalize,false);
  });
}

// `startPropLineRefresh` counts rather than throws. The paid providers do not
// wait on the public lease — nothing needs to grant ownership when no public
// worker is running — so calling it here is correct, and the counter lets the
// deadline tests below stay about deadlines. The scraped-feed cycles keep
// throwing: two processes scraping one book is the contention the lease exists
// to prevent, and none of them may run without it.
let proplineRefreshes = 0;
function schedulerDeps(fetchBoard, persistBoard) {
  return {persistenceHealth:()=>({configured:true}), publicWorkerConfigured:()=>false,
    publicFeeds:{refresh:async()=>{},health:()=>[]}, fetchUnifiedBoard:fetchBoard,
    decorateBoardWithScoutAudit:x=>x,persistNormalizedBoard:persistBoard,
    retentionConfig:()=>({enabled:false}),startPropLineRefresh:()=>{proplineRefreshes+=1;},
    runFastPrizePicksCycle:()=>{throw Error('must not poll');},runFreeSportsbooksCycle:()=>{throw Error('must not poll');},runDraftKingsPick6Cycle:()=>{throw Error('must not poll');},
  };
}

// The regression itself: with no public worker to arbitrate, the paid providers
// must still refresh. This stayed at zero in production for the life of every
// process running in mesh mode.
test('paid providers refresh when no public worker holds the lease',async()=>{
  proplineRefreshes=0;
  await __testPersistBoards('test-lease-retry',schedulerDeps(async sport=>({sport}),async()=>({persisted:true})),{cycle:5000,sport:100});
  assert.ok(proplineRefreshes>0,'PropLine must refresh when nothing else owns ingestion');
});
test('one hung cache-only sport does not wedge remaining sports or later scheduler ticks',async()=>{
  const gate=deferred(), fetched=[],written=[];let stalled=true;
  const deps=schedulerDeps(async(sport,options)=>{assert.equal(options.cacheOnly,true);fetched.push(sport);if(sport==='NFL'&&stalled)return gate.promise;return {sport};},async board=>{written.push(board.sport);return {persisted:true};});
  await __testPersistBoards('test-lease-retry',deps,{cycle:5000,sport:100});
  assert.ok(written.includes('NBA'));assert.ok(!written.includes('NFL'));
  await __testPersistBoards('test-lease-retry',deps,{cycle:5000,sport:100});
  assert.equal(fetched.filter(x=>x==='NFL').length,1);
  stalled=false;gate.resolve({sport:'NFL'});await flush();
  assert.ok(!written.includes('NFL'),'late board cannot start persistence');
  await __testPersistBoards('test-lease-retry',deps,{cycle:5000,sport:100});
  assert.ok(written.includes('NFL'));
});

test('overall deadline releases sync guard without authorizing late provider fan-out',async()=>{
  const gate=deferred();let claims=0,polls=0;
  const deps={...schedulerDeps(async sport=>({sport}),async()=>({persisted:true})),
    publicWorkerConfigured:()=>true,runPublicIngestionCycle:()=>{claims++;return gate.promise;},
    startPropLineRefresh:()=>polls++,runFreeSportsbooksCycle:()=>polls++,runFastPrizePicksCycle:()=>polls++,runDraftKingsPick6Cycle:()=>polls++,
  };
  await __testPersistBoards('test-lease-retry',deps,{cycle:100,group:5000}); await flush();
  await __testPersistBoards('test-lease-retry',deps,{cycle:5000,group:100});
  assert.equal(claims,1);assert.equal(polls,0);
  gate.resolve({claimed:true,results:[]});await flush();assert.equal(polls,0);
  const writes=[];
  await __testPersistBoards('test-lease-retry',schedulerDeps(async sport=>({sport}),async board=>{writes.push(board.sport);return {persisted:true};}),{cycle:5000,sport:100});
  assert.ok(writes.length>0);
});


test('a bounded public snapshot timeout does not suppress canonical cached-board persistence',async()=>{
  const writes=[];
  const timeout=Object.assign(new Error('public snapshot deadline'),{code:'INGESTION_DEADLINE'});
  const deps={...schedulerDeps(async sport=>({sport}),async board=>{writes.push(board.sport);return {persisted:true};}),
    publicWorkerConfigured:()=>true,
    runPublicIngestionCycle:async()=>{throw timeout;},
    readPublicSchedulerState:async()=>null,
  };
  await __testPersistBoards('test-public-timeout',deps,{cycle:5000,group:100,sport:100});
  assert.ok(writes.length>0,'cancelled public work is fenced; cached canonical writes should still get a turn');
});
