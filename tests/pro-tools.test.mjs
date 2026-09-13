import test from 'node:test';
import assert from 'node:assert/strict';
import {decimalOdds,expectedReturn,proToolsAnalysis,outcomeDomain} from '../lib/analytics/pro-tools.mjs';
const now=Date.parse('2026-09-13T12:00:00Z');
const group={sport:'NBA',eventId:'g',playerId:'p',playerName:'Fixture Player',marketId:'player_points',gameStartTime:new Date(now+3600000).toISOString(),entityType:'player',live:false,isAlternate:false};
const quote=(book,side,line,price,extra={})=>({...group,sportsbookKey:book,sportsbook:book,side,line,price,providerUpdatedAt:new Date(now-10000).toISOString(),...extra});
const run=(rows,opts={},scope={})=>proToolsAnalysis({...group,...scope,rows},{now,...opts});
const prediction=(q,extra={})=>({...q,available:true,modelId:'validated-model',modelVersion:'v1',projection:22,
 probabilityOver:.55,probabilityUnder:.40,probabilityPush:.05,generatedAt:new Date(now-60000).toISOString(),expiresAt:new Date(now+60000).toISOString(),
 validation:{method:'chronological-heldout-real-lines',observations:500,events:100,brier:.20,calibrationError:.02,end:'2026-09-01T00:00:00Z'},...extra});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('American payout conversion rejects booleans, blank, zero, malformed odds',()=>{
 near(decimalOdds(-110),1+100/110);assert.equal(decimalOdds(-100),decimalOdds(100));
 for(const value of [true,false,'',null,0,99,-99,Infinity,NaN])assert.equal(decimalOdds(value),null);
});
test('EV includes refunded push mass and validates probability totals',()=>{
 near(expectedReturn({win:.55,loss:.40,push:.05,price:-110}),10);
 assert.equal(expectedReturn({win:0,loss:0,push:1,price:-110}),0);
 assert.equal(expectedReturn({win:1,loss:0,push:0,price:100}),100);
 assert.equal(expectedReturn({win:.5,loss:.5,push:.1,price:100}),null);
 assert.equal(expectedReturn({win:true,loss:0,push:0,price:100}),null);
});
test('same-line half-point arbitrage models both tails and correct allocation',()=>{
 const r=run([quote('a','OVER',20.5,110),quote('b','UNDER',20.5,110)]).arbitrage[0];
 assert.ok(r);near(r.weightOver,.5);near(r.weightUnder,.5);near(r.minimumReturnPercent,5);
 assert.equal(r.scenarios.length,2);assert.equal(r.possiblePush,false);assert.equal(r.theoretical,true);assert.equal(r.executionVerified,false);
});
test('integer shared lines include both-push break-even, never guaranteed profit',()=>{
 const r=run([quote('a','OVER',20,110),quote('b','UNDER',20,110)]).arbitrage[0];
 near(r.minimumReturnPercent,0);near(r.decidedReturnPercent,5);assert.equal(r.possiblePush,true);
 assert.ok(r.scenarios.some(s=>s.overResult==='push'&&s.underResult==='push'&&s.returnPercent===0));
});
test('middles show attainable integer results, tail loss and both-win returns',()=>{
 const r=run([quote('a','OVER',20.5,-110),quote('b','UNDER',25.5,-110)]);
 assert.equal(r.arbitrage.length,0);assert.equal(r.middles.length,1);
 const m=r.middles[0];assert.deepEqual(m.middle,{minimum:21,maximum:25,outcomes:5});
 near(m.minimumReturnPercent,-100/22);near(m.maximumReturnPercent,1000/11);
});
test('adjacent integer boundaries are not advertised as a double-win middle',()=>{
 const r=run([quote('a','OVER',1,-110),quote('b','UNDER',2,-110)]);
 assert.equal(r.middles.length,0);assert.equal(r.arbitrage.length,0);
});
test('crossed lines, same-book pairs and noncontemporaneous prices are excluded',()=>{
 for(const rows of [[quote('a','OVER',25.5,110),quote('b','UNDER',20.5,110)],
  [quote('a','OVER',20.5,110),quote('a','UNDER',20.5,110)],
  [quote('a','OVER',20.5,110),quote('b','UNDER',20.5,110,{providerUpdatedAt:new Date(now-80000).toISOString()})]])assert.equal(run(rows).arbitrage.length,0);
});
test('stale, future, live, malformed and promotional quotes cannot enter pro tools',()=>{
 const a=quote('a','OVER',20.5,110);
 for(const extra of [{providerUpdatedAt:new Date(now-310000).toISOString()},{providerUpdatedAt:new Date(now+1).toISOString()},{live:true},{started:true},{isPromotional:true},{isGoblin:true},{price:0},{eventId:'other'},{gameStartTime:new Date(now+7200000).toISOString()}]){
  assert.equal(run([a,quote('b','UNDER',20.5,110,extra)]).arbitrage.length,0,JSON.stringify(extra));
 }
 assert.equal(run([a],{},{gameStartTime:new Date(now-1).toISOString()}).quotes.length,0);
 assert.equal(run([a],{},{stale:true}).quotes.length,0);
});
test('ambiguous duplicates remain excluded even if normal display rows were deduplicated',()=>{
 const raw=[quote('a','OVER',20.5,110),quote('a','OVER',20.5,120),quote('b','UNDER',20.5,110)];
 assert.equal(run([raw[0],raw[2]],{},{comparisonOffers:raw}).arbitrage.length,0);
});
test('nonnegative stat domains cannot invent negative middles; yardage may be negative',()=>{
 assert.equal(run([quote('a','OVER',-2.5,-110),quote('b','UNDER',-.5,-110)]).middles.length,0);
 assert.equal(outcomeDomain({sport:'NFL',marketId:'player_rush_yds'}).min,null);
 assert.equal(outcomeDomain({...group,marketId:'fantasy_score'}),null);
 assert.equal(run([quote('a','OVER',20.5,110),quote('b','UNDER',20.5,110)],{},{entityType:'team'}).arbitrage.length,0);
});
test('exact calibrated model output qualifies EV+, while adaptive estimates remain separate',()=>{
 const q=quote('a','OVER',20.5,-110),p=prediction(q);
 const r=run([q],{predictions:[p]});assert.equal(r.evPlus.length,1);near(r.evPlus[0].evPercent,10);
 const adaptive=prediction(q,{sourceKind:'verified-history-adaptive-model',validation:{method:'rolling-player-history',observations:10,events:10}});
 const a=run([q],{predictions:[adaptive]});assert.equal(a.evPlus.length,0);assert.equal(a.ev[0].available,true);assert.equal(a.ev[0].evidence,'adaptive-estimate');
});
test('wrong line, wrong book, expired, duplicate and hit-rate-as-probability inputs fail closed',()=>{
 const q=quote('a','OVER',20.5,-110),p=prediction(q);
 for(const predictions of [[{...p,line:21.5}],[{...p,sportsbookKey:'b'}],[{...p,expiresAt:new Date(now-1).toISOString()}],[p,p],
  [{...p,validation:{method:'L5',observations:5}}],[{...p,validation:{...p.validation,calibrationError:.2}}],[{...p,probabilityPush:.5}]]){
  assert.equal(run([q],{predictions}).ev[0].available,false);
 }
});
test('quote side chooses the correct win/loss probabilities and missing price produces no EV',()=>{
 const q=quote('a','UNDER',20.5,-110),p=prediction(q);
 const e=run([q],{predictions:[p]}).ev[0];near(e.evPercent,100*(.4*100/110-.55));assert.equal(e.qualifiesEVPlus,false);
 assert.equal(run([{...q,price:null}],{predictions:[p]}).ev.length,0);
});
test('scenario enumeration agrees with every integer outcome in an independent bounded sweep',()=>{
 for(const overLine of [.5,1,1.5,2])for(const underLine of [2,2.5,3,3.5])for(const prices of [[110,120],[-110,-120],[-150,200]]){
  if(overLine>underLine)continue;
  const r=run([quote('a','OVER',overLine,prices[0]),quote('b','UNDER',underLine,prices[1])]);
  const pair=r.arbitrage[0]||r.middles[0];if(!pair)continue;
  const returns=[];
  for(let value=0;value<=10;value++){
   const over=value>overLine?pair.weightOver*decimalOdds(prices[0]):value===overLine?pair.weightOver:0;
   const under=value<underLine?pair.weightUnder*decimalOdds(prices[1]):value===underLine?pair.weightUnder:0;
   returns.push(100*(over+under-1));
  }
  near(pair.minimumReturnPercent,Math.min(...returns));near(pair.maximumReturnPercent,Math.max(...returns));near(pair.weightOver+pair.weightUnder,1);
 }
});

test('partial-game and pick-em entry payouts cannot borrow full-game standalone EV',()=>{
 const q=quote('a','OVER',20.5,110),p=prediction(q);
 assert.equal(run([q],{predictions:[p]},{period:'first_half'}).quotes.length,0);
 for(const key of ['prizepicks','underdog','underdog_fantasy'])assert.equal(run([{...q,sportsbookKey:key}]).quotes.length,0);
 for(const extra of [{requiresParlay:true},{payoutType:'entry'}])assert.equal(run([{...q,...extra}]).quotes.length,0);
});
