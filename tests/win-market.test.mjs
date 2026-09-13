import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeWinMarket} from '../lib/analytics/win-market.mjs';
const now=Date.parse('2026-09-13T12:00:00Z');
const target={sport:'NBA',eventId:'game',homeTeam:'Home',awayTeam:'Away',gameStartTime:new Date(now+3600000).toISOString(),period:'including-overtime',settlement:'two-way-no-draw'};
const quote=(sportsbookKey='A',extra={})=>({...target,sportsbookKey,source:'Fixture',sourceKind:'bookmaker-moneyline',observedAt:new Date(now-1000).toISOString(),oddsFormat:'american',outcomes:[{side:'HOME',price:-150},{side:'AWAY',price:130}],...extra});
const run=(rows=[quote(),quote('B')],event=target)=>analyzeWinMarket(event,rows,{now});
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-12,`${actual} != ${expected}`);
test('proportional margin removal agrees with an independent two-outcome calculation',()=>{
 const r=run();assert.equal(r.available,true);assert.equal(r.modelPrediction,false);
 near(r.probabilities.HOME,(150/250)/((150/250)+(100/230)));
 near(r.probabilities.HOME+r.probabilities.AWAY,1);assert.ok(r.books[0].overround>0);
});
test('averages complete book vectors with one vote per sportsbook',()=>{
 const b=quote('B',{outcomes:[{side:'HOME',price:100},{side:'AWAY',price:100}]}),r=run([quote(),quote('a'),b]);
 assert.equal(r.books.length,2);near(r.probabilities.HOME,(run().probabilities.HOME+.5)/2);
 assert.deepEqual(run([b,quote()]),run([quote(),b]));
});
test('three-way regulation preserves draw probability and excludes incomplete books',()=>{
 const event={...target,sport:'EPL',period:'regulation',settlement:'three-way'};
 const q=book=>quote(book,{...event,outcomes:[{side:'HOME',price:100},{side:'DRAW',price:300},{side:'AWAY',price:300}]});
 const r=run([q('A'),q('B')],event);assert.equal(r.available,true);near(r.probabilities.HOME,.5);near(r.probabilities.DRAW,.25);near(r.probabilities.AWAY,.25);
 assert.equal(run([q('A'),{...q('B'),outcomes:q('B').outcomes.slice(0,2)}],event).available,false);
});
test('refunded ties are conditional, never silently presented as zero draw probability',()=>{
 const event={...target,sport:'NFL',settlement:'two-way-push-on-draw'};
 const r=run([quote('A',event),quote('B',event)],event);
 assert.equal(r.conditionalOnNoDraw,true);assert.equal(r.probabilities.DRAW,undefined);assert.match(r.drawNote,/conditional/);
});
test('identity, period, settlement and kickoff must match exactly',()=>{
 for(const change of [{sport:'WNBA'},{eventId:'other'},{homeTeam:'Away',awayTeam:'Home'},{period:'regulation'},{settlement:'two-way-push-on-draw'},{gameStartTime:new Date(now+7200000).toISOString()}])assert.equal(run([quote(),quote('B',change)]).available,false);
 for(const change of [{eventId:''},{homeTeam:'Away'},{period:''},{settlement:'unknown'}])assert.equal(run(undefined,{...target,...change}).available,false);
});
test('stale, live, started and archived targets fail closed',()=>{
 for(const change of [{live:true},{stale:true},{archived:true},{gameStartTime:new Date(now).toISOString()}])assert.equal(run(undefined,{...target,...change}).available,false);
 assert.equal(analyzeWinMarket(target,[quote(),quote('B')],{now:NaN}).available,false);
});
test('unknown, future and stale observation timestamps cannot rank',()=>{
 for(const observedAt of [null,'2026-09-13T11:59:00',new Date(now+1).toISOString(),new Date(now-300001).toISOString()])assert.equal(run([quote(),quote('B',{observedAt})]).available,false);
 assert.equal(run([quote(),quote('B'),quote('B',{observedAt:null})]).available,false);
});
test('quotes beyond the allowed inter-book timestamp gap do not form consensus',()=>{
 assert.equal(run([quote(),quote('B',{observedAt:new Date(now-61002).toISOString()})]).available,false);
 assert.equal(run([quote(),quote('B',{observedAt:new Date(now-61000).toISOString()})]).available,true);
});
test('newest evidence wins, but conflicting or invalid latest records block stale fallback',()=>{
 const old=quote('A',{observedAt:new Date(now-2000).toISOString()}),latest=quote('A',{outcomes:[{side:'HOME',price:100},{side:'AWAY',price:100}]});
 assert.deepEqual(run([old,latest,quote('B')]),run([latest,quote('B')]));
 assert.equal(run([quote(),latest,quote('B')]).available,false);
 assert.equal(run([old,quote('A',{outcomes:[]}),quote('B')]).available,false);
});
test('incomplete, duplicate, malformed, decimal and promotional outcomes are excluded',()=>{
 for(const extra of [{outcomes:[]},{outcomes:[{side:'HOME',price:100},{side:'HOME',price:100}]},{outcomes:[{side:'HOME',price:true},{side:'AWAY',price:100}]},{oddsFormat:'decimal'},{sourceKind:'historical-hit-rate'},{source:''},{suspended:true},{live:true},{stale:true},{isAlternate:true},{requiresParlay:true}])assert.equal(run([quote(),quote('B',extra)]).available,false);
});
test('missing evidence never becomes a 50/50 prediction or a fake draw estimate',()=>{
 for(const rows of [[],null,[quote()]]){const r=run(rows);assert.equal(r.available,false);assert.equal(r.probabilities,null);assert.equal(r.modelPrediction,false);}
 assert.equal(analyzeWinMarket(null).available,false);
});
