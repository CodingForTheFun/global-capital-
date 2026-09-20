import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOffers,normalizeCatalog,historyForMarket,number} from '../lib/web/prop-workspace.mjs';
import {createWorkspaceHandler} from '../lib/web/workspace-api.mjs';
import {resolveHistoryEventIdentity} from '../lib/data-sources/espn/research.mjs';
const event={id:'e1',sport:'football_nfl',startsAt:'2026-09-20T18:00:00Z',homeTeam:'A',awayTeam:'B'};
test('verified history event identity catches a source event played before a still-future PropLine start',()=>{
 const target={sport:'WNBA',homeTeam:'NY',awayTeam:'LV',gameStartTime:'2026-09-20T18:00:00Z'};
 const rows=[
  {gameId:'wnba:11',date:'2026-09-20T16:30:00Z',team:'NY',teamName:'New York Liberty',opponent:'LV',opponentName:'Las Vegas Aces'},
  {gameId:'wnba:10',date:'2026-09-18T18:00:00Z',team:'NY',opponent:'CON'},
 ];
 const identity=resolveHistoryEventIdentity(rows,target);
 assert.equal(identity.available,true);assert.equal(identity.gameId,'wnba:11');assert.equal(identity.sourceEventId,'11');
});
test('verified history event identity supports generic soccer club names without a league slug',()=>{
 const target={sport:'SOCCER',homeTeam:'Rayo',awayTeam:'Bristol C',gameStartTime:'2026-09-20T18:00:00Z'};
 const identity=resolveHistoryEventIdentity([
  {gameId:'soccer:77',date:'2026-09-20T17:10:00Z',teamName:'Rayo Vallecano',team:'RAY',opponentName:'Bristol City',opponent:'BRI'},
 ],target);
 assert.equal(identity.available,true);assert.equal(identity.gameId,'soccer:77');
});
test('verified history event identity fails closed when same-matchup candidates are too ambiguous',()=>{
 const target={sport:'WNBA',homeTeam:'NY',awayTeam:'LV',gameStartTime:'2026-09-20T18:00:00Z'};
 const identity=resolveHistoryEventIdentity([
  {gameId:'wnba:11',date:'2026-09-20T17:00:00Z',team:'NY',opponent:'LV'},
  {gameId:'wnba:12',date:'2026-09-20T19:30:00Z',team:'NY',opponent:'LV'},
 ],target);
 assert.equal(identity.available,false);assert.equal(identity.code,'MATCHUP_IDENTITY_UNVERIFIED');
});
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
test('canonical basketball split rebounds read verified PropLine raw stats',()=>{
 const basketballEvent={id:'b1',sport:'basketball_wnba',startsAt:'2026-09-20T18:00:00Z',homeTeam:'NY',awayTeam:'LV'};
 const basketballPayload={id:'b1',sport_key:'basketball_wnba',bookmakers:[{key:'prizepicks',markets:[{key:'player_offensive_rebounds',outcomes:[{name:'Over',description:'Board Player',point:0.5,price:-110,player_id:'wnba:1'}]}]}]};
 const player=normalizeOffers(basketballPayload,basketballEvent).players[0],market=player.markets[0];
 const body={sport_key:'basketball_wnba',player_name:'Board Player',player_id:'wnba:1',games:[{event_id:'g1',commence_time:'2026-09-10T00:00:00Z',status:'final',player_id:'wnba:1',player_name:'Board Player',stats:{offensive_rebounds:3,minutes:31}}]};
 const history=historyForMarket(body,player,market,{now:Date.parse('2026-09-19T00:00:00Z')});
 assert.equal(history.available,true);assert.equal(history.sourceStat,'offensive_rebounds');assert.equal(history.gameLog[0].value,3);
});

test('canonical history falls back to verified ESPN only after PropLine lacks the exact stat',async()=>{
 const reads=[];let fallbackParams=null;
 const read=async(path)=>{
  reads.push(path);
  if(path==='/v1/sports')return[{key:'basketball_wnba',title:'WNBA'}];
  if(path==='/v1/sports/basketball_wnba/events')return[{id:'b1',sport_key:'basketball_wnba',commence_time:'2026-09-20T18:00:00Z',home_team:'NY',away_team:'LV'}];
  if(path==='/v1/sports/basketball_wnba/events/b1/markets')return[{key:'player_offensive_rebounds'}];
  if(path==='/v1/sports/basketball_wnba/events/b1/odds')return{id:'b1',sport_key:'basketball_wnba',bookmakers:[{key:'prizepicks',markets:[{key:'player_offensive_rebounds',outcomes:[{name:'Over',description:'Board Player',point:0.5,price:-110,player_id:'wnba:1'}]}]}]};
  if(path==='/v1/sports/basketball_wnba/players/Board%20Player/games')return{sport_key:'basketball_wnba',player_name:'Board Player',player_id:'wnba:1',games:[]};
  throw new Error('unexpected '+path);
 };
 const historyFallback=async params=>{fallbackParams=params;return{ok:true,available:true,source:'Historical stats',selectedSourceGameId:'wnba:11',coverage:{returnedGames:3},gameLog:[
  {gameId:'wnba:10',date:'2026-09-10T00:00:00Z',value:2},
  // Same selected game, but ESPN reports an earlier timestamp than PropLine.
  {gameId:'wnba:11',date:'2026-09-20T16:30:00Z',value:5},
  {gameId:'wnba:12',date:'2026-09-21T00:00:00Z',value:4},
 ]};};
 const handler=createWorkspaceHandler({authenticate:async()=>({id:'u'}),read,historyFallback,now:()=>Date.parse('2026-09-19T00:00:00Z')});
 const playerKey=encodeURIComponent(JSON.stringify(['basketball_wnba','b1',['id','wnba:1']]));
 const marketKey=encodeURIComponent(JSON.stringify(['player_offensive_rebounds',null,'standard']));
 let body,status;await handler({url:'/api/oblige-workspace?action=history&sport=basketball_wnba&event=b1&player='+playerKey+'&market='+marketKey,method:'GET'},{writeHead(s){status=s;},end(b){body=JSON.parse(b);}});
 assert.equal(status,200);assert.equal(body.available,true);assert.equal(body.sourceProvider,'ESPN');assert.equal(body.fallback,true);assert.equal(body.primaryCode,'NO_VERIFIED_STAT_HISTORY');
 assert.deepEqual(body.gameLog.map(row=>row.gameId),['wnba:10']);assert.equal(body.coverage.returnedGames,1);assert.equal(body.coverage.selectedEventCutoff,'2026-09-20T18:00:00.000Z');
 assert.equal(fallbackParams.sport,'WNBA');assert.equal(fallbackParams.providerMarketKey,'player_offensive_rebounds');assert.equal(fallbackParams.gameStartTime,'2026-09-20T18:00:00.000Z');
 assert.ok(reads.some(path=>path.includes('/players/Board%20Player/games')));
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
