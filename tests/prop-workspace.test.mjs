import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOffers,normalizeCatalog,historyForMarket,number} from '../lib/web/prop-workspace.mjs';
import {createWorkspaceHandler} from '../lib/web/workspace-api.mjs';
const event={id:'e1',sport:'football_nfl',startsAt:'2026-09-20T18:00:00Z',homeTeam:'A',awayTeam:'B'};
const quote=(description,point,extra={})=>({name:'Over',description,point,price:-110,player_id:'nfl:1',...extra});
const payload=(book,market,outcomes,extra={})=>({id:'e1',sport_key:'football_nfl',bookmakers:[{key:book,markets:[{key:market,outcomes,...extra}]}]});
test('one player owns all books, lines and category variants',()=>{
 const result=normalizeOffers([payload('draftkings','player_rush_yds',[quote('Test Player',50.5)]),payload('fanduel','player_rush_yds',[quote('Test Player Sr.',55.5)]),payload('prizepicks','player_receptions',[quote('Test Player',3.5)]),payload('draftkings','player_rush_yds',[quote('Test Player',25.5)],{period:'h1'})],event);
 assert.equal(result.players.length,1);assert.equal(result.players[0].markets.length,3);
 const full=result.players[0].markets.find(m=>m.marketKey==='player_rush_yds'&&!m.period);
 assert.deepEqual(full.offers.map(o=>o.line).sort((a,b)=>a-b),[50.5,55.5]);
});
test('distinct player ids and games are never merged',()=>{
 const result=normalizeOffers([payload('a','player_receptions',[quote('Same Name',2.5),quote('Same Name',2.5,{player_id:'nfl:2'})]),{...payload('a','player_receptions',[quote('Same Name',2.5)]),id:'e2'}],event);
 assert.equal(result.players.length,3);
});
test('current duplicate conflicts do not become artificially better prices',()=>{
 const data=normalizeOffers([payload('a','player_receptions',[quote('Test',2.5,{price:-120}),quote('Test',2.5,{price:110})])],event);
 const offer=data.players[0].markets[0].offers[0];assert.equal(offer.price,null);assert.equal(offer.conflict,true);
});
test('latest timestamp wins instead of best stale price; suspended markets removed',()=>{
 const data=normalizeOffers([payload('a','player_receptions',[quote('Test',2.5,{price:150,last_seen_at:'2026-09-18T00:00:00Z'}),quote('Test',2.5,{price:-110,last_seen_at:'2026-09-18T01:00:00Z'})]),payload('b','player_receptions',[quote('Test',2.5)],{suspended_at:'2026-09-18'})],event);
 assert.equal(data.players[0].markets[0].offers.length,1);assert.equal(data.players[0].markets[0].offers[0].price,-110);assert.equal(data.suspendedMarkets,1);
});
test('all catalog sports survive including inactive and future keys',()=>{
 const sports=normalizeCatalog([{key:'football_nfl',title:'NFL'},{key:'new_sport',title:'New',active:false},{key:'soccer_x',title:'X'}]);
 assert.equal(sports.length,3);assert.equal(sports.find(s=>s.key==='new_sport').active,false);
});
test('missing numeric inputs never fabricate zero',()=>{for(const x of [null,undefined,'',false,[],{}])assert.equal(number(x),null);assert.equal(number(0),0);});
test('history exactness: completed games, numeric zero and no future/period substitution',()=>{
 const player=normalizeOffers(payload('a','player_rush_yds',[quote('Test',30.5)]),event).players[0],market=player.markets[0];
 const row=(id,value,status='final')=>({event_id:id,commence_time:'2026-09-10T00:00:00Z',status,stats:{rushing_yards:value},opponent:'B'});
 const body={sport_key:event.sport,player_name:'Test',games:[row('1',0),row('2',null),row('3',80,'in_progress'),{...row('4',10),commence_time:'2026-09-21T00:00:00Z'}]};
 const history=historyForMarket(body,player,market);assert.equal(history.gameLog.length,1);assert.equal(history.gameLog[0].value,0);
 assert.equal(historyForMarket(body,player,{...market,period:'h1'}).available,false);
 assert.equal(historyForMarket({...body,player_name:'Test Somebody'},player,market).code,'IDENTITY_UNVERIFIED');
});
test('gateway authenticates before any provider request and rejects writes',async()=>{
 let reads=0;const handler=createWorkspaceHandler({authenticate:async()=>null,read:async()=>{reads++;return[];}});
 const call=async(method)=>{let status,body;await handler({url:'/api/oblige-workspace',method},{writeHead(s){status=s;},end(b){body=JSON.parse(b);}});return{status,body};};
 assert.equal((await call('GET')).status,401);assert.equal((await call('POST')).status,405);assert.equal(reads,0);
});
test('unknown sport fails closed, error does not disclose upstream credentials',async()=>{
 const handler=createWorkspaceHandler({authenticate:async()=>({id:'u'}),read:async()=>[{key:'football_nfl',title:'NFL'}]});
 let status;await handler({url:'/api/oblige-workspace?action=events&sport=evil',method:'GET'},{writeHead(s){status=s;},end(){}});assert.equal(status,400);
 const failed=createWorkspaceHandler({authenticate:async()=>({id:'u'}),read:async()=>{throw new Error('secret fake-test-key');}});
 let body;await failed({url:'/api/oblige-workspace',method:'GET'},{writeHead(){},end(b){body=b;}});assert.equal(body.includes('fake-test-key'),false);
});

test('model action falls back to exact PropLine market projection and no-vig EV without publishing an unvalidated model',async()=>{
 const reads=[];
 const read=async(path,params)=>{
  reads.push([path,params]);
  if(path==='/v1/sports')return[{key:'football_nfl',title:'NFL'}];
  if(path==='/v1/sports/football_nfl/events')return[{id:'e1',sport_key:'football_nfl',commence_time:'2026-09-20T18:00:00Z',home_team:'A',away_team:'B'}];
  if(path==='/v1/sports/football_nfl/events/e1/markets')return[{key:'player_rush_yds'}];
  if(path==='/v1/sports/football_nfl/events/e1/odds')return payload('draftkings','player_rush_yds',[quote('Test Player',50.5)]);
  if(path==='/v1/sports/football_nfl/events/e1/projections')return{projections:[{player_id:'nfl:1',player_name:'Test Player',market:'player_rush_yds',projection:53.2}]};
  if(path==='/v1/sports/football_nfl/events/e1/ev')return{plays:[{player_id:'nfl:1',player_name:'Test Player',market:'player_rush_yds',point:50.5,bookmaker:'draftkings',ev_percent:4.7,fair_probability:.55,fair_price:-122}]};
  throw new Error('unexpected '+path);
 };
 const handler=createWorkspaceHandler({authenticate:async()=>({id:'u'}),read,predict:async()=>({available:false,code:'MODEL_NOT_READY'})});
 let body,status;
 await handler({url:'/api/oblige-workspace?action=model&sport=football_nfl&event=e1&player='+encodeURIComponent(JSON.stringify(['football_nfl','e1',['id','nfl:1']]))+'&market='+encodeURIComponent(JSON.stringify(['player_rush_yds',null,'standard']))+'&offer='+encodeURIComponent(JSON.stringify(['draftkings',50.5,'Over'])),method:'GET'},{writeHead(s){status=s;},end(b){body=JSON.parse(b);}});
 assert.equal(status,200);assert.equal(body.prediction.available,false);
 assert.equal(body.marketReference.projection,53.2);assert.equal(body.marketReference.evPercent,4.7);
 assert.equal(body.marketReference.basis,'PropLine market-implied / no-vig');
 assert.ok(reads.some(([path])=>path.endsWith('/projections')));
 assert.ok(reads.some(([path])=>path.endsWith('/ev')));
});
