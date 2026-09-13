import test from 'node:test';
import assert from 'node:assert/strict';
import {compareResearchQuotes} from '../lib/ui/line-comparison.mjs';
const now=Date.parse('2026-09-13T12:00:00Z');
const group={sport:'NBA',eventId:'game',playerId:'player',marketId:'player_points'};
const quote=(book,line=20.5,price=-110,extra={})=>({...group,sportsbookKey:book,sportsbook:book,side:'OVER',line,price,providerUpdatedAt:'2026-09-13T11:59:00Z',...extra});
const compare=(rows,options={},scope={})=>compareResearchQuotes({...group,...scope,rows},{line:20.5,now,...options});
test('only identical lines and sides compete for best price; selected research line is independent',()=>{
 const rows=[quote('a'),quote('b',20.5,-105),quote('c',25.5,200),quote('d',20.5,150,{side:'UNDER'})];
 const r=compare(rows);
 assert.deepEqual(r.bestPrices.OVER.map(q=>q.bookKey),['b']);
 assert.deepEqual(r.bestPrices.UNDER,[]);
 assert.equal(r.consensus,20.5);
 assert.deepEqual(compare(rows,{line:21.5}).bestPrices.OVER,[]);
 assert.equal(rows[0].line,20.5);
});
test('even-money signs and identical payouts tie',()=>{
 assert.equal(compare([quote('a',20.5,-100),quote('b',20.5,100)]).bestPrices.OVER.length,2);
 assert.equal(compare([quote('a',20.5,-120),quote('b',20.5,-110)]).bestPrices.OVER[0].bookKey,'b');
});
test('newest quote wins independently of order; older lines cannot affect consensus',()=>{
 const rows=[quote('a',99,200,{providerUpdatedAt:'2026-09-13T11:58:00Z'}),quote('a',20.5),quote('b',22.5)];
 assert.deepEqual(compare(rows),compare(rows.slice().reverse()));
 assert.equal(compare(rows).consensus,21.5);
 assert.equal(compare(rows).offers.length,2);
});
test('conflicting simultaneous and undated quotes fail closed',()=>{
 for(const extra of [{},{providerUpdatedAt:null}]){
  const r=compare([quote('a'),quote('a',22.5,-110,extra),quote('b')]);
  assert.equal(r.omitted.length,1);assert.equal(r.consensus,null);assert.equal(r.offers.length,1);
 }
 assert.equal(compare([quote('a'),quote('a',20.5,-115)]).offers.length,0);
});
test('stale, missing-time and future offers cannot earn rank; ingestion time is not freshness',()=>{
 const r=compare([quote('a'),quote('old',15,200,{providerUpdatedAt:'2026-09-13T11:00:00Z'}),quote('unknown',10,300,{providerUpdatedAt:null,ingestedAt:new Date(now).toISOString()}),quote('future',5,400,{providerUpdatedAt:new Date(now+1000).toISOString()})]);
 assert.equal(r.offers.length,3);assert.equal(r.omitted.length,1);assert.equal(r.bestLines.OVER,20.5);assert.deepEqual(r.bestPrices.OVER,[]);assert.equal(r.consensus,null);
 assert.equal(compare([quote('a'),quote('b')],{},{archived:true}).bestLines.OVER,null);
});
test('event, identity, market, period, entity and promotions remain isolated',()=>{
 const bad=[{eventId:'other'},{playerId:'other'},{marketId:'other'},{sport:'NFL'},{period:'first_half'},{entityType:'team'},{side:'OTHER'},{completed:true},...['isAlternate','isPromotional','isDiscounted','isBoosted','isGoblin','isDemon'].map(k=>({[k]:true}))];
 for(const extra of bad)assert.equal(compare([quote('a',20.5,-110,extra)]).offers.length,0,JSON.stringify(extra));
 assert.equal(compare([quote('a',20.5,-110,{live:true})],{},{live:false}).offers.length,0);
});
test('missing or malformed odds stay unavailable; recorded line zero remains valid',()=>{
 for(const value of [null,'',true,0,20,NaN,Infinity])assert.equal(compare([quote('a',0,value)]).offers[0].price,null);
 assert.equal(compare([quote('a',0)]).bestLines.OVER,0);
 assert.equal(compare([quote('a',true)]).offers.length,0);
});
test('each book has one vote per side and differing over/under lines are separate rows',()=>{
 const r=compare([quote('A',20.5),quote('a',20.5),quote('a',22.5,-110,{side:'UNDER'}),quote('b',24.5),quote('b',24.5,-110,{side:'UNDER'})]);
 assert.equal(r.consensus,22.5);assert.equal(r.rows.length,3);
 assert.equal(r.rows.find(q=>q.bookKey==='a'&&q.line===20.5).UNDER,null);
 assert.equal(compare(r.offers,{side:'UNDER'}).consensus,23.5);
});
