import {sanitizePublicPayload} from '../lib/public-sanitize.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {normalizeGameMarkets,createGameBoard} from '../lib/autoscout/providers/game-markets.mjs';
import {tacoOffer,activeTacos} from '../lib/autoscout/providers/taco-offers.mjs';
import {projectedStat} from '../lib/projections/stat-estimate.mjs';
const event={id:'game',home_team:'Home',away_team:'Away',commence_time:'2099-01-01T00:00:00Z',bookmakers:[{key:'book',title:'Book',markets:[
 {key:'h2h',outcomes:[{name:'Home',price:-110},{name:'Away',price:105},{name:'Draw',price:220},{name:'Fake',price:100}]},
 {key:'spreads',outcomes:[{name:'Home',price:-110,point:-2.5},{name:'Away',price:-105,point:2.5}]},
 {key:'totals',outcomes:[{name:'Over',price:-110,point:42.5},{name:'Under',price:-110,point:42.5},{name:'Over',price:-110}]},
 {key:'player_points',outcomes:[{name:'Over',price:-110,point:25.5}]}
]}]};
test('featured game odds preserve prices, draw, handicap, total; never become player props',()=>{
 const games=normalizeGameMarkets([event],'NFL');assert.equal(games.length,1);assert.equal(games[0].books[0].markets.length,3);
 assert.equal(games[0].books[0].markets[0].outcomes.length,3);assert.equal(games[0].books[0].markets[1].outcomes[0].point,-2.5);assert.equal(games[0].books[0].markets[2].outcomes.length,2);
});
test('a past kickoff is not a fabricated live score or game status',()=>{assert.equal(normalizeGameMarkets([{...event,commence_time:'2020-01-01T00:00:00Z'}],'NFL')[0].status,'STARTED_UNCONFIRMED');});
test('game odds cache coalesces calls and persists reserved daily spend',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'game-test-'));let calls=0;
 const service=createGameBoard({directory,sportKey:s=>s==='NFL'?'americanfootball_nfl':null,scope:()=>({params:{regions:'us,us2,us_dfs'},regions:['us','us2','us_dfs'],bookmakers:[],billedRegions:3}),request:async()=>{calls++;return[event];}});
 const [a,b]=await Promise.all([service('NFL'),service('NFL')]);assert.equal(a.available,true);assert.deepEqual(a,b);assert.equal(calls,1);assert.equal((await service('NFL')).cached,true);assert.equal(calls,1);
 const ledger=JSON.parse(await readFile(path.join(directory,'sportsbook-credit-budget.json'),'utf8'));assert.equal(ledger.credits,9);await assert.rejects(service('invalid'),/Unsupported sport/);
});
test('empty quota never invokes a game provider or fabricates game rows',async()=>{
 let calls=0;const service=createGameBoard({directory:await mkdtemp(path.join(tmpdir(),'game-quota-')),remaining:()=>0,sportKey:()=> 'nfl',scope:()=>({params:{regions:'us'},regions:['us'],bookmakers:[],billedRegions:1}),request:async()=>{calls++;return[event];}});
 const result=await service('NFL');assert.equal(calls,0);assert.equal(result.available,false);assert.equal(result.code,'GAME_BUDGET_LIMIT');assert.deepEqual(result.games,[]);
});
const context={book:{key:'prizepicks'},sport:'NBA',event:{id:'event',homeTeam:'Home',awayTeam:'Away',commenceTime:'2099-01-01T00:00:00Z'},market:'player_points',now:Date.parse('2026-09-12')};
const taco={name:'Over',description:'Test Athlete',point:15.5,promotion:{type:'taco',original_line:25.5,expires_at:'2098-12-31T00:00:00Z'}};
test('Taco means explicit valid unexpired metadata, never a Goblin, lower line or generic discount',()=>{
 assert.equal(tacoOffer(taco,context).promotionType,'taco');for(const row of [{...taco,promotion:undefined,isDiscounted:true},{...taco,promotion:{...taco.promotion,type:'goblin'}},{...taco,promotion:{...taco.promotion,expires_at:'2020-01-01'}},{...taco,point:30}])assert.equal(tacoOffer(row,context),null);
 assert.equal(tacoOffer(taco,{...context,book:{key:'underdog'}}),null);assert.deepEqual(activeTacos([tacoOffer(taco,context)],Date.parse('2100-01-01')),[]);
});
test('projected stat is a labeled log-based estimate, distinct from line and observed average',()=>{
 assert.equal(projectedStat({available:false,gameLog:[{value:99}]}),null);assert.equal(projectedStat({available:true,gameLog:[{value:99}]}),null);
 const result=projectedStat({available:true,gameLog:[{value:0},{value:2},{value:4},{value:6}],context:{projection:999}});
 assert.equal(result.modelled,true);assert.equal(result.sampleSize,4);assert.ok(result.value<3);assert.notEqual(result.value,999);assert.match(result.source,/estimate/);
});

test('public sanitization retains game selection identifiers without admitting secret keys',()=>{
 const response=sanitizePublicPayload({ok:true,games:normalizeGameMarkets([event],'NFL'),key:'secret-key-must-disappear'});
 assert.equal(response.key,undefined);
 const book=response.games[0].books[0];assert.equal(book.sportsbookKey,'book');assert.equal(book.key,undefined);
 for(const id of ['h2h','spreads','totals']){const market=book.markets.find(row=>row.marketKey===id);assert.ok(market,id);assert.ok(market.outcomes.length);assert.equal(market.key,undefined)}
});
