import test from 'node:test';
import assert from 'node:assert/strict';
import {historyForMarket, normalizeOffers} from '../lib/web/prop-workspace.mjs';
import {createWorkspaceHandler} from '../lib/web/workspace-api.mjs';
import {rawStatFor} from '../lib/data-sources/propline/game-research.mjs';

const NOW=Date.parse('2026-09-18T12:00:00Z');
const fixtures=[
 ['football_nfl','player_pass_yds','passing_yards'],['football_ncaaf','player_receptions','receptions'],
 ['basketball_nba','player_points','points'],['basketball_wnba','player_points','points'],['basketball_ncaab','player_assists','assists'],
 ['baseball_mlb','pitcher_strikeouts','strikeouts'],['baseball_mlb','batter_strikeouts','batter_strikeouts'],
 ['hockey_nhl','goalie_saves','saves'],['tennis','total_games','total_games'],['tennis','player_total_games','total_games'],
 ['tennis','sets_won','sets_won'],['tennis','player_sets_won','sets_won'],['tennis','set_1_games','set_1_games'],
 ['soccer_epl','player_shots_on_target','shots_on_target'],['soccer_laliga','player_assists','assists'],
 ['golf','player_total_score','total_score'],['mma_ufc','player_takedowns','takedowns'],['esports','kills_maps_1_2','kills_maps_1_2'],
];
for(const [sport,marketKey,stat] of fixtures){
 test(`authenticated workspace history: ${sport}/${marketKey} reaches raw ${stat}`,async()=>{
  const event={id:'fixture-event',sport,startsAt:'2026-09-20T12:00:00Z',homeTeam:'Home',awayTeam:'Away',aliases:[]};
  const odds={id:event.id,sport_key:sport,commence_time:event.startsAt,bookmakers:[{key:'prizepicks',markets:[{key:marketKey,outcomes:[{name:'Over',description:'History Fixture',player_id:'fixture-id',point:22.5,price:null}]}]}]};
  const player=normalizeOffers(odds,event).players[0],market=player.markets[0];
  const calls=[];
  const handler=createWorkspaceHandler({authenticate:async()=>({id:'fixture-user'}),now:()=>NOW,read:async(path,params,options)=>{
   calls.push({path,params,options});
   if(path==='/v1/sports')return [{key:sport,title:sport}];
   if(path.endsWith('/events'))return [{id:event.id,sport_key:sport,commence_time:event.startsAt,home_team:'Home',away_team:'Away'}];
   if(path.endsWith('/markets'))return [{key:marketKey}];
   if(path.endsWith('/odds'))return odds;
   assert.ok(path.endsWith('/players/History%20Fixture/games'),'history must use the raw game archive, not trends or graded odds');
   return {sport_key:sport,player_name:player.name,player_id:player.playerId,games:[{event_id:'completed-game',commence_time:'2026-09-10T12:00:00Z',status:'final',stats:{[stat]:0}}]};
  }});
  const query=new URLSearchParams({action:'history',sport,event:event.id,player:player.key,market:market.key});
  let status,body;
  assert.equal(await handler({url:`/api/oblige-workspace?${query}`,method:'GET'},{writeHead(value){status=value;},end(value){body=JSON.parse(value);}}),true);
  assert.equal(status,200);assert.equal(body.available,true);assert.equal(body.sourceStat,stat);assert.equal(body.gameLog.length,1);assert.equal(body.gameLog[0].value,0);
  const archives=calls.filter(call=>call.path.endsWith('/games'));
  assert.equal(archives.length,1);assert.equal(archives[0].options.ttlSeconds,900);assert.equal(archives[0].options.bypassCache,undefined);
 });
}
test('canonical WNBA workspace exhausts PropLine and ESPN before verified WNBA Stats archive', async () => {
 const sport='basketball_wnba',marketKey='player_offensive_rebounds';
 const event={id:'wnba-current',sport,startsAt:'2026-09-20T12:00:00Z',homeTeam:'ATL',awayTeam:'CON',aliases:[]};
 const odds={id:event.id,sport_key:sport,commence_time:event.startsAt,bookmakers:[{key:'prizepicks',markets:[{key:marketKey,outcomes:[{name:'Over',description:'Angel Reese',player_id:'1642291',point:4.5,price:null}]}]}]};
 const normalized=normalizeOffers(odds,event);
 const p=normalized.players[0],m=p.markets[0];
 let espnCalls=0,archiveCalls=0;
 const handler=createWorkspaceHandler({
  authenticate:async()=>({id:'fixture-user'}),
  now:()=>NOW,
  historyFallback:async params=>{espnCalls++;assert.equal(params.sport,'WNBA');assert.equal(params.providerMarketKey,marketKey);return {available:false,code:'STAT_NOT_AVAILABLE',gameLog:[]};},
  wnbaHistoryFallback:async params=>{
   archiveCalls++;assert.equal(params.sport,'WNBA');assert.equal(params.playerName,'Angel Reese');assert.equal(params.eventId,event.id);
   return {available:true,source:'WNBA Stats archive via SportsDataverse',gameLog:[{gameId:'wnba:prior',date:'2026-09-17T00:00:00.000Z',value:3,offensiveRebounds:3,rebounds:10}]};
  },
  read:async path=>{
   if(path==='/v1/sports')return [{key:sport,title:'WNBA'}];
   if(path.endsWith('/events'))return [{id:event.id,sport_key:sport,commence_time:event.startsAt,home_team:'ATL',away_team:'CON'}];
   if(path.endsWith('/markets'))return [{key:marketKey}];
   if(path.endsWith('/odds'))return odds;
   if(path.endsWith('/players/Angel%20Reese/games'))return {sport_key:sport,player_name:'Angel Reese',player_id:'1642291',games:[]};
   throw Error('unexpected path '+path);
  },
 });
 const query=new URLSearchParams({action:'history',sport,event:event.id,player:p.key,market:m.key});
 let status,body;
 assert.equal(await handler({url:`/api/oblige-workspace?${query}`,method:'GET'},{writeHead(value){status=value;},end(value){body=JSON.parse(value);}}),true);
 assert.equal(status,200);assert.equal(body.available,true);assert.equal(body.gameLog[0].value,3);
 assert.equal(body.sourceProvider,'WNBA Stats archive via SportsDataverse');
 assert.deepEqual(body.attemptedSources,['PropLine','ESPN','WNBA Stats archive']);
 assert.equal(espnCalls,1);assert.equal(archiveCalls,1);
});

const player={name:'Fixture',aliases:['Fixture'],sport:'tennis',playerId:'fixture-id',eventId:'current',startsAt:'2026-09-20T12:00:00Z'};
const market={marketKey:'total_games',period:null};
const row=(event_id,value,extra={})=>({event_id,status:'final',commence_time:'2026-09-10T12:00:00Z',stats:{total_games:value},...extra});
const archive=games=>({player_name:'Fixture',sport_key:'tennis',player_id:'fixture-id',games});

test('current workspace excludes future finals, current event, private/redacted rows and conflicting IDs',()=>{
 const history=historyForMarket(archive([
  row('good',0),row('future',24,{commence_time:'2026-09-19T12:00:00Z'}),row('current',24),
  row('hidden',24,{redacted:true}),row('foreign-id',24,{player_id:'another-id'}),row('foreign-name',24,{player_name:'Another Player'}),
  row('dnp',0,{dnp:true}),row('walkover',0,{walkover:true}),row('retired',0,{retired:true}),row('not-played',0,{played:false}),
 ]),player,market,{now:NOW});
 assert.deepEqual(history.gameLog.map(game=>[game.gameId,game.value]),[['good',0]]);
 assert.equal(history.gameLog[0].opponent,null);assert.equal(history.gameLog[0].isHome,null);
 const mismatch=historyForMarket({...archive([row('good',24)]),player_id:'other-id'},player,market,{now:NOW});
 assert.equal(mismatch.available,false);
});
test('conflicting event dates are not two samples and period totals never use full games',()=>{
 const history=historyForMarket(archive([row('conflict',24),row('conflict',24,{commence_time:'2026-09-11T12:00:00Z'}),row('good',23)]),player,market,{now:NOW});
 assert.deepEqual(history.gameLog.map(game=>game.gameId),['good']);
 assert.equal(historyForMarket(archive([row('good',24)]),player,{...market,period:'set1'},{now:NOW}).available,false);
});
test('basketball zero minutes is no appearance, but a played zero is real',()=>{
 const p={...player,sport:'basketball_wnba'},m={marketKey:'player_points',period:null};
 const body={...archive([]),sport_key:p.sport,games:[row('dnp',null,{stats:{points:0,minutes:0}}),row('played',null,{stats:{points:0,minutes:12}})]};
 assert.deepEqual(historyForMarket(body,p,m,{now:NOW}).gameLog.map(game=>[game.gameId,game.value]),[['played',0]]);
});
test('legacy fallback never treats fractional total rounds or generic esports as a mapped statistic',()=>{
 assert.equal(rawStatFor({sport:'MMA',playerName:'Fixture',market:'Total Rounds'}),null);
 assert.equal(rawStatFor({sport:'ESPORTS',playerName:'Fixture',market:'kills_maps_1_2'}),null);
});
