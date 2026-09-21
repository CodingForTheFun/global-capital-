import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {activePublicSeason,createPublicResearch,normalizePublicGameLog} from '../lib/data-sources/espn/research.mjs';
import {finalizeResearch} from '../lib/autoscout/research-service.mjs';
const f=JSON.parse(readFileSync(new URL('./fixtures/espn-pipeline-extras.json',import.meta.url)));
const epl=JSON.parse(readFileSync(new URL('./fixtures/espn-epl-current.json',import.meta.url)));
const now=Date.parse('2026-09-12T23:00Z');
const clock={leagues:[{slug:'nfl',season:{year:2026,startDate:'2026-08-06T07:00Z'}}]};

function asSeason(payload,season){
 const copy=structuredClone(payload),idMap=new Map(),events={};
 const filter=copy.filters?.find(item=>item.name==='season');if(filter)filter.value=String(season);
 for(const [id,event] of Object.entries(copy.events||{})){
  const next=`${id}-${season}`;idMap.set(id,next);
  events[next]={...event,id:next,gameDate:String(event.gameDate||'').replace(/^2025/,String(season))};
 }
 copy.events=events;
 for(const group of copy.seasonTypes||[]){
  group.displayName=String(group.displayName||'').replace(/^2025/,String(season));
  for(const category of group.categories||[])for(const row of category.events||[])row.eventId=idMap.get(String(row.eventId))||row.eventId;
 }
 return copy;
}

test('active season requires matching league and a season that has actually started',()=>{
 assert.equal(activePublicSeason(clock,'nfl',now),'2026');
 assert.equal(activePublicSeason(clock,'nba',now),null);
 assert.equal(activePublicSeason({leagues:[{slug:'nba',season:{year:2027,startDate:'2026-09-30T07:00Z'}}]},'nba',now),null);
 assert.equal(activePublicSeason({leagues:[{slug:'nfl',season:{year:2026}}]},'nfl',now),null);
});

test('stale athlete default does not turn last year into SZN or backfill two years back',async()=>{
 const calls=[];
 const lookup=createPublicResearch({now:()=>now,fetchImpl:async url=>{
  calls.push(url);return new Response(JSON.stringify(url.includes('/search/')?f.defenseSearch:
   url.includes('/scoreboard')?clock:url.includes('season=2026')?f.emptyCurrent:f.defense));
 }});
 const r=await lookup({sport:'NFL',playerName:'Micah Parsons',market:'Sacks',providerMarketKey:'player_sacks'});
 assert.equal(r.available,true);assert.equal(r.season,'2026');assert.equal(r.coverage.currentSeasonGames,0);
 assert.ok(r.gameLog.length>0);assert.ok(r.gameLog.every(g=>g.season==='2025'&&g.seasonType===2));
 assert.ok(!calls.some(u=>u.includes('season=2024')));
 const metrics=finalizeResearch({...r,line:.5,side:'OVER'});
 assert.equal(metrics.windows.season.hitRate,null);assert.ok(metrics.windows.l5.games>0);
});

test('deep history walks multiple verified seasons without changing the current SZN window',async()=>{
 const calls=[],season2024=asSeason(f.defense,2024),season2023=asSeason(f.defense,2023);
 const lookup=createPublicResearch({now:()=>now,fetchImpl:async url=>{
  calls.push(url);
  const body=url.includes('/search/')?f.defenseSearch:url.includes('/scoreboard')?clock:
   url.includes('season=2026')?f.emptyCurrent:url.includes('season=2024')?season2024:
   url.includes('season=2023')?season2023:f.defense;
  return new Response(JSON.stringify(body));
 }});
 const r=await lookup({sport:'NFL',playerName:'Micah Parsons',market:'Sacks',providerMarketKey:'player_sacks',historyYears:4,games:100});
 assert.equal(r.available,true);assert.equal(r.season,'2026');
 assert.deepEqual(r.coverage.returnedSeasons,['2025','2024','2023']);
 assert.equal(r.coverage.historyYearsRequested,4);
 assert.ok(calls.some(u=>u.includes('season=2024')));assert.ok(calls.some(u=>u.includes('season=2023')));
 const metrics=finalizeResearch({...r,line:.5,side:'OVER'});
 assert.equal(metrics.windows.season.hitRate,null);
 assert.ok(metrics.windows.l5.games>0);
});

test('explicit defensive sack label cannot be reinterpreted as quarterback sacks taken',()=>{
 assert.equal(normalizePublicGameLog(f.love,{sport:'NFL',market:'Defensive sacks',providerMarketKey:'player_sacks'}).length,0);
 assert.ok(normalizePublicGameLog(f.defense,{sport:'NFL',market:'Defensive sacks',providerMarketKey:'player_sacks'}).length>0);
});

test('soccer backfill from the wrong competition is rejected and marked incomplete',async()=>{
 const lookup=createPublicResearch({now:()=>now,fetchImpl:async url=>new Response(JSON.stringify(
  url.includes('/search/')?f.soccerSearch:url.includes('/scoreboard')?{}:url.includes('season=2025')?f.ucl:epl))});
 const r=await lookup({sport:'EPL',playerName:'Erling Haaland',providerMarketKey:'player_shots',market:'Shots'});
 assert.equal(r.available,true);assert.equal(r.gameLog.length,3);assert.equal(r.coverage.historyPartial,true);
 assert.ok(r.gameLog.every(g=>g.season==='2026'));assert.equal(r.coverage.backfilled,false);
});
