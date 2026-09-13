import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeResearch } from '../lib/analytics/research.mjs';
import { verifiedGames,sensitivityMap,disagreementMap,evidenceQuality,propTimeline,scenarioLab,
 playerDependencies,createChangeRadar,researchBrief } from '../lib/autoscout/intelligence.mjs';
const now=Date.parse('2026-09-13T02:00:00Z'),at='2026-09-13T01:55:00Z';
const games=Array.from({length:20},(_,i)=>({gameId:`g${i}`,date:new Date(now-i*86400000-86400000).toISOString(),value:i,minutes:30,season:2026,isHome:i%2===0,opponent:'NY',completed:true}));
const base={available:true,player:{id:'p1'},sport:'NBA',gameLog:games,season:2026,matchup:{opponent:'NY'},coverage:{seasonComplete:false}};
const group={key:'NBA|e1|p1|player_points',sport:'NBA',eventId:'e1',playerId:'p1',playerName:'Test Athlete',marketId:'player_points',market:'Points',rows:[]};
const row=(book,line,extra={})=>({sport:'NBA',eventId:'e1',playerId:'p1',marketId:'player_points',side:'OVER',sportsbookKey:book,sportsbook:book,line,providerUpdatedAt:at,...extra});
const g={...group,rows:[row('Book A',9.5),row('Book B',10.5),row('Book A',9.5,{side:'UNDER'})]};

test('sensitivity uses the shared policy for every line, side and window',()=>{
 for(const side of ['OVER','UNDER'])for(const window of ['l5','l10','l15','l20','season','h2h']){
  const result=sensitivityMap(base,{line:9,side,window,step:1});assert.equal(result.rows.length,7);
  for(const r of result.rows){const a=analyzeResearch(base,r.line,side);const w=window==='h2h'?a.h2h:a.windows[window];assert.equal(r.rate,w.hitRate);assert.equal(r.games,w.games);assert.equal(r.pushes,w.pushes);}
 }
});
test('sensitivity preserves genuine zero, no logs, and null distinction',()=>{
 assert.equal(sensitivityMap(base,{line:100,window:'l5'}).rows[3].rate,0);
 assert.equal(sensitivityMap(base,{line:0}).available,true);
 assert.equal(sensitivityMap(base,{line:null}).available,false);
 assert.equal(sensitivityMap({...base,available:false},{line:9}).available,false);
 assert.equal(sensitivityMap({...base,gameLog:[]},{line:9}).available,false);
 assert.equal(sensitivityMap(base,{line:9,step:Infinity}).available,false);
});
test('game eligibility rejects DNP/incomplete/boolean garbage and deduplicates',()=>{
 const result=verifiedGames({...base,gameLog:[games[0],games[0],{...games[1],dnp:true},{...games[2],completed:false},{...games[3],value:false}]});assert.equal(result.length,1);assert.equal(result[0].value,0);
});
test('comparison separates events, sides, alternate lines and unknown books',()=>{
 const out=disagreementMap({...g,rows:[...g.rows,row('Bad',99,{eventId:'other'}),row('Alt',99,{isAlternate:true}),row('Boost',99,{isBoosted:true}),row('',99)]},'OVER',now);
 assert.equal(out.books.length,2);assert.equal(out.spread,1);assert.equal(out.min,9.5);
});
test('one line per book, latest wins; simultaneous conflicting lines remain excluded',()=>{
 const out=disagreementMap({...group,rows:[row('A',10),row('A',11,{providerUpdatedAt:'2026-09-13T01:56:00Z'}),row('B',12),row('B',13),row('C',0,{providerUpdatedAt:null})]},'OVER',now);
 assert.equal(out.books.length,2);assert.equal(out.books.find(b=>b.key==='A').line,11);assert.deepEqual(out.omitted,['B']);assert.equal(out.books.find(b=>b.key==='C').freshnessKnown,false);
});
test('evidence meter is explicit coverage, unknown identity/lineup receive no credit',()=>{
 const q=evidenceQuality({...base,player:{}},g,'OVER',now);assert.equal(q.total,6);assert.equal(q.passed,4);
 assert.equal(q.checks.find(c=>c.label==='Resolved history identity').met,false);
 assert.equal(q.checks.find(c=>c.label==='Lineup confirmation').met,false);
 assert.equal(q.label,'Partial evidence');
});
test('freshness is provider time rather than browser refresh',()=>{
 const out=evidenceQuality(base,{...group,rows:[row('A',9,{providerUpdatedAt:'2026-09-01T00:00:00Z'})]},'OVER',now);
 assert.equal(out.checks.find(c=>c.label==='Line freshness').met,false);
});
test('timeline uses persisted prop/book/side isolation and observed baselines',()=>{
 const record=(line,date,extra={})=>({prop_id:'p',bookmaker_key:'A',side:'OVER',line,price:null,created_at:date,...extra});
 const history=[record(9,'2026-09-13T01:00:00Z'),record(10,'2026-09-13T01:30:00Z'),record(30,'2026-09-13T01:40:00Z',{prop_id:'wrong'}),record(40,'2026-09-13T01:45:00Z',{side:'UNDER'})];
 const out=propTimeline({history,propId:'p',book:'A',now});assert.equal(out.length,2);assert.equal(out[0].from,9);assert.equal(out[0].to,10);assert.equal(out[1].from,null);
 assert.equal(propTimeline({history,book:'A',now}).length,0);
});
test('timeline does not invent event times or attach another prop\'s context',()=>{
 const contextEvents=[{kind:'injury',groupKey:group.key,label:'Questionable',source:'Verified status'},
  {kind:'lineup',groupKey:'wrong',label:'In',source:'Feed',at},
  {kind:'projection',groupKey:group.key,label:'Estimate revised',source:'Recorded model run',at},
  {kind:'game',groupKey:group.key,label:'Bad future',source:'Feed',at:'2030-01-01T00:00:00Z'}];
 assert.equal(propTimeline({groupKey:group.key,contextEvents,now}).length,1);
});
test('scenario zero minutes is a real zero, not a missing/default minute factor',()=>{
 const out=scenarioLab(base,{sport:'NBA',targetMinutes:0});assert.equal(out.available,true);assert.equal(out.adjusted,0);assert.ok(out.baseline>0);
});
test('scenario weighted per-minute identity is transparent and bounded',()=>{
 const out=scenarioLab(base,{sport:'NBA',targetMinutes:60,usagePercent:0});assert.equal(out.adjusted,9);assert.equal(out.baseline,4.5);assert.equal(out.games,10);
 for(const params of [{sport:'NFL',targetMinutes:30},{sport:'NBA',targetMinutes:-1},{sport:'NBA',targetMinutes:30,usagePercent:999}])assert.equal(scenarioLab(base,params).available,false);
 assert.equal(scenarioLab({...base,gameLog:games.slice(0,3)},{sport:'NBA',targetMinutes:30}).available,false);
});
test('teammate absence must be explicit, verified and sourced',()=>{
 const gameLog=games.map((r,i)=>({...r,teammateParticipation:[{playerId:'t',name:'Teammate',played:i<10,verified:true,source:'Recorded lineup'},{playerId:'unknown',name:'Unknown'},{playerId:'u',name:'Unverified',played:false}]}));
 const out=playerDependencies({...base,gameLog});assert.equal(out.length,1);assert.equal(out[0].withGames,10);assert.equal(out[0].withoutGames,10);assert.equal(out[0].difference,10);assert.equal(out[0].limited,false);
 assert.equal(playerDependencies(base).length,0);
});
test('small samples are visibly marked and one-sided dependency is not inferred',()=>{
 const gameLog=games.slice(0,3).map(r=>({...r,teammateParticipation:[{playerId:'t',name:'T',played:true,verified:true,source:'Recorded lineup'}]}));
 const out=playerDependencies({...base,gameLog})[0];assert.equal(out.limited,true);assert.equal(out.difference,null);
});
test('radar needs two monotonic comparable observations, not repeated renders',()=>{
 const r=createChangeRadar();r.observe([g],{scope:'NBA',at,now});assert.equal(r.current().length,0);
 const changed={...g,rows:[row('Book A',11,{providerUpdatedAt:'2026-09-13T01:56:00Z'})]};
 r.observe([changed],{scope:'NBA',at,now});assert.equal(r.current().length,0);
 r.observe([changed],{scope:'NBA',at:'2026-09-13T01:56:00Z',now});assert.equal(r.current().length,1);assert.equal(r.current()[0].delta,1.5);
});
test('radar ignores stale and out-of-order snapshots and equal provider timestamps',()=>{
 const r=createChangeRadar();r.observe([g],{scope:'NBA',at,now});
 const changed={...g,rows:[row('Book A',20)]};
 r.observe([changed],{scope:'NBA',at:'2026-09-13T01:56:00Z',stale:true,now});
 r.observe([changed],{scope:'NBA',at:'2026-09-13T01:56:00Z',now});
 r.observe([changed],{scope:'NBA',at:'2026-09-13T01:54:00Z',now});assert.equal(r.current().length,0);
});
test('radar does not call a missing row a withdrawal, and clears session data',()=>{
 const r=createChangeRadar();r.observe([g],{scope:'NBA',at,now});r.observe([],{scope:'NBA',at:'2026-09-13T01:59:00Z',now});assert.equal(r.current().length,0);r.clear();assert.equal(r.current().length,0);
});
test('brief is deterministic, grounded, cites evidence and acknowledges missing feeds',()=>{
 const result=researchBrief({base,group:g,line:9.5,side:'OVER',now});assert.ok(result.text.includes('[E1]'));assert.ok(result.text.includes('Source:'));
 assert.ok(result.gaps.some(s=>s.includes('teammate')));assert.ok(result.note.includes('not forecast probabilities'));
 assert.equal(result.text,researchBrief({base,group:g,line:9.5,side:'OVER',now}).text);
 const empty=researchBrief({group,line:9.5,now});assert.equal(empty.evidence.length,0);assert.ok(empty.gaps.some(s=>s.includes('game logs')));
});
test('static browser module allowlist and tab hook are present without provider changes',()=>{
 const server=readFileSync('frontdoor-prod.mjs','utf8'),ui=readFileSync('apex-v2/scout-ui-v5.js','utf8');
 assert.ok(server.includes("'lib/ui/intelligence-studio.mjs'"));assert.ok(server.includes("'lib/autoscout/intelligence.mjs'"));
 assert.ok(ui.includes("['intelligence','Intelligence']"));assert.ok(ui.includes('tabs.length-1'));assert.ok(ui.includes('intelligenceReadHistory'));
 const code=readFileSync('lib/autoscout/intelligence.mjs','utf8');assert.ok(!code.includes('fetch('));assert.ok(!code.includes('setInterval('));
});

test('future quotes and contradictory teammate participation are not evidence',()=>{
 const out=disagreementMap({...group,rows:[row('Future',9,{providerUpdatedAt:'2030-01-01T00:00:00Z'})]},'OVER',now);assert.equal(out.available,false);
 const gameLog=[{...games[0],teammateParticipation:[{playerId:'t',name:'T',played:true,verified:true,source:'Fixture'},{playerId:'t',name:'T',played:false,verified:true,source:'Fixture'}]}];assert.deepEqual(playerDependencies({...base,gameLog}),[]);
});
