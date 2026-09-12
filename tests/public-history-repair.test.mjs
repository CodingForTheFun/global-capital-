import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPublicResearch, normalizePublicGameLog, resolvePublicAthlete } from '../lib/data-sources/espn/research.mjs';
import { finalizeResearch } from '../lib/autoscout/research-service.mjs';
const captured=JSON.parse(readFileSync(new URL('./fixtures/espn-history-repair.json',import.meta.url)));
const fixture=n=>JSON.parse(readFileSync(new URL(`./fixtures/espn-${n}.json`,import.meta.url)));
const now=()=>Date.parse('2026-09-12T22:00:00Z');
const read=(n,sport,key,market='unused label')=>normalizePublicGameLog(captured[n],{sport,market,providerMarketKey:key,now:now()});
const search=(name,id,league='nfl',sport='football')=>({results:[{type:'player',totalFound:1,contents:[{sport,defaultLeagueSlug:league,displayName:name,uid:`s:20~l:28~a:${id}`,link:{web:`https://www.espn.com/${league}/player/_/id/${id}/name`}}]}]});
const json=d=>new Response(JSON.stringify(d));

test('captured defensive sacks are not QB sacks taken; defensive interceptions are not passing interceptions',()=>{
 const rows=read('defense-current','NFL','player_sacks');
 assert.ok(rows.length>0);assert.equal(rows[0].value,0);assert.equal(rows[0].passingInterceptions,null);
 assert.ok(read('defense-previous','NFL','player_sacks').some(r=>r.value===2.5));
 assert.deepEqual(normalizePublicGameLog(fixture('nfl-gamelog'),{sport:'NFL',market:'Sacks',providerMarketKey:'player_sacks'}),[]);
 assert.deepEqual(read('defense-current','NFL','player_pass_interceptions'),[]);
 const passing=normalizePublicGameLog(fixture('nfl-gamelog'),{sport:'NFL',market:'Pass Yards'});
 assert.equal(passing[0].defensiveSacks,null);assert.equal(passing[0].defensiveInterceptions,null);
});
test('captured tackle and assist fields retain zeros and exact totals',()=>{
 const total=read('defense-current','NFL','player_tackles_assists');
 assert.ok(total.length>0);
 for(const r of total)assert.equal(r.value,r.soloTackles+r.assistedTackles);
 assert.equal(read('defense-current','NFL','player_assists')[0].value,total[0].assistedTackles);
 assert.equal(read('defense-current','NFL','player_solo_tackles')[0].value,total[0].soloTackles);
});
test('captured kicking pairs and actual kicking points are mapped without invented scoring',()=>{
 const fg=read('kicker-previous','NFL','player_field_goals'), pats=read('kicker-previous','NFL','player_pats'), points=read('kicker-previous','NFL','player_kicking_points');
 assert.ok(fg.length>0);assert.equal(fg[0].value,1);assert.equal(pats[0].value,2);assert.equal(points[0].value,5);
 const broken=structuredClone(captured['kicker-previous']);
 const row=broken.seasonTypes[0].categories[0].events[0];
 row.stats[broken.names.indexOf('fieldGoalsMade-fieldGoalAttempts')]='3-2';
 assert.ok(!normalizePublicGameLog(broken,{sport:'NFL',market:'Field Goals'}).some(r=>r.gameId===`nfl:${row.eventId}`));
});
test('official pass+rush key computes the sum, without falling back to passing alone',()=>{
 const rows=normalizePublicGameLog(fixture('nfl-gamelog'),{sport:'NFL',market:'Pass Yards',providerMarketKey:'player_pass_rush_yds'});
 assert.ok(rows.length>0);for(const r of rows)assert.equal(r.value,r.passingYards+r.rushingYards);
});
test('official MLB runs-scored, triples, walks and outs keys use role-specific fields',()=>{
 assert.ok(normalizePublicGameLog(fixture('mlb-gamelog'),{sport:'MLB',market:'Runs',providerMarketKey:'batter_runs_scored'}).length>0);
 assert.ok(normalizePublicGameLog(fixture('mlb-gamelog'),{sport:'MLB',market:'Triples',providerMarketKey:'batter_triples'}).length>0);
 const outs=read('pitcher-current','MLB','pitcher_outs');assert.equal(outs[0].value,16);
 assert.equal(read('pitcher-current','MLB','pitcher_walks')[0].value,1);
 assert.deepEqual(read('pitcher-current','MLB','batter_hits'),[]);
 assert.equal(normalizePublicGameLog(captured['pitcher-current'],{sport:'MLB',market:'Hits Allowed'})[0].value,4);
});
test('unknown, team, alternate, period and cross-sport keys fail closed even with a plausible label',()=>{
 for(const [n,sport,key,market] of [
  ['defense-current','NFL','team_sacks','Sacks'],['defense-current','NFL','player_sacks_alternate','Sacks'],
  ['goalie-current','NHL','batter_hits','Hits'],['goalie-current','NHL','player_total_saves_q1','Saves'],
  ['kicker-previous','NFL','player_tds_over','Kicking Points'],['college-current','NCAAB','player_pass_yds','Points'],
 ])assert.deepEqual(read(n,sport,key,market),[],key);
});
test('goalie saves and NCAAM-labelled college basketball are accepted only in the matching league',()=>{
 assert.equal(read('goalie-current','NHL','player_total_saves')[0].value,17);
 assert.ok(read('college-current','NCAAB','player_points').length>0);
 assert.deepEqual(read('college-current','NBA','player_points'),[]);
 const swapped=structuredClone(captured['college-current']);swapped.filters.find(f=>f.name==='league').value='nba';
 assert.deepEqual(normalizePublicGameLog(swapped,{sport:'NCAAB',market:'Points'}),[]);
});
test('captured Josh Allen search is genuinely truncated/ambiguous and is never guessed',()=>{
 assert.equal(resolvePublicAthlete(captured['common-search'],{sport:'NFL',playerName:'Josh Allen'}),null);
});
test('negative identity results expire; successful identities and logs still coalesce',async()=>{
 let clock=now(),searches=0;
 const provider=createPublicResearch({now:()=>clock,fetchImpl:async url=>{
  if(url.includes('/search/'))return json(++searches===1?{results:[]}:fixture('player-search'));
  return json(fixture('wnba-gamelog'));
 }});
 const params={sport:'WNBA',playerName:'Caitlin Clark',market:'Assists'};
 assert.equal((await provider(params)).available,false);await provider(params);assert.equal(searches,1);
 clock+=6*60_000;
 const [a,b]=await Promise.all([provider(params),provider({...params,market:'Points'})]);
 assert.equal(a.available,true);assert.equal(b.available,true);assert.equal(searches,2);
});
test('previous-season fallback handles a missing year without labelling it the current season',async()=>{
 const current={filters:[{name:'season',value:'2026',options:[{value:'2026'},{value:'2024'}]}]};
 const older=structuredClone(fixture('nfl-gamelog'));older.filters.find(f=>f.name==='season').value='2024';
 const urls=[];const provider=createPublicResearch({now,fetchImpl:async url=>{
  urls.push(url);return json(url.includes('/search/')?fixture('nfl-search'):url.includes('season=2024')?older:current);
 }});
 const name=fixture('nfl-search').results.find(g=>g.type==='player').contents.find(r=>r.defaultLeagueSlug==='nfl').displayName;
 const result=await provider({sport:'NFL',playerName:name,market:'Pass Attempts',line:25.5});
 assert.equal(result.available,true);assert.equal(result.season,'2026');assert.equal(result.coverage.seasonComplete,false);
 assert.ok(urls.some(u=>u.includes('season=2024')));
 const finalized=finalizeResearch({...result,sport:'NFL',market:'Pass Attempts',line:25.5});
 assert.equal(finalized.windows.season.hitRate,null);assert.ok(finalized.windows.l5.hitRate!==null);
});
// Explicitly synthetic roster boundary cases; the game log comes from the captured NFL fixture.
function rosterProvider({duplicate=false,failAway=false}={}){
 const teams=[{id:'2',uid:'s:20~l:28~t:2',abbreviation:'BUF',displayName:'Buffalo Bills'},
  {id:'15',uid:'s:20~l:28~t:15',abbreviation:'MIA',displayName:'Miami Dolphins'}];
 const calls=[];
 const provider=createPublicResearch({now,fetchImpl:async url=>{
  calls.push(url);
  if(url.includes('/search/'))return json(captured['common-search']);
  if(url.includes('/teams?'))return json({sports:[{leagues:[{slug:'nfl',teams:teams.map(team=>({team}))}]}]});
  if(url.includes('/roster')){
   const team=teams.find(t=>url.includes(`/teams/${t.id}/`));
   if(team.id==='15'&&failAway)return new Response('',{status:503});
   return json({team,athletes:[{items:team.id==='2'||duplicate?[{id:team.id==='2'?'3918298':'999',uid:`s:20~l:28~a:${team.id==='2'?'3918298':'999'}`,displayName:'Josh Allen',position:{abbreviation:'QB'}}]:[]}]});
  }
  return json(fixture('nfl-gamelog'));
 }});
 return {provider,calls};
}
test('ambiguous search can be resolved against both exact current matchup rosters',async()=>{
 const {provider,calls}=rosterProvider();
 const r=await provider({sport:'NFL',playerName:'Josh Allen',homeTeam:'Buffalo Bills',awayTeam:'Miami Dolphins',market:'Pass Attempts',games:15});
 assert.equal(r.available,true);assert.equal(r.player.team,'BUF');assert.equal(r.opponent,'MIA');
 assert.ok(calls.some(u=>u.includes('/athletes/3918298/')));
 const count=calls.length;await provider({sport:'NFL',playerName:'Josh Allen',homeTeam:'Buffalo Bills',awayTeam:'Miami Dolphins',market:'Pass Yards',games:15});assert.equal(calls.length,count);
});
test('ambiguous or partially unavailable rosters never pick the first match',async()=>{
 for(const opts of [{duplicate:true},{failAway:true}]){
  const {provider,calls}=rosterProvider(opts);
  const r=await provider({sport:'NFL',playerName:'Josh Allen',homeTeam:'Buffalo Bills',awayTeam:'Miami Dolphins',market:'Pass Attempts'});
  assert.equal(r.available,false);assert.ok(!calls.some(u=>u.includes('/athletes/')));
 }
});
test('line/side recomputation shares real samples, preserves zero/push and computes all split metrics',()=>{
 const gameLog=read('defense-previous','NFL','player_sacks');
 const over=finalizeResearch({gameLog,sport:'NFL',market:'Sacks',line:0,side:'OVER',season:'2024',coverage:{seasonComplete:true},opponent:gameLog[0].opponent});
 const under=finalizeResearch({...over,line:0,side:'UNDER',opponent:gameLog[0].opponent});
 for(const w of ['l5','l10','l15','l20','season']){
  assert.equal(over.windows[w].games,under.windows[w].games);
  assert.equal(over.windows[w].pushes,under.windows[w].pushes);
  if(over.windows[w].hitRate!==null)assert.equal(over.windows[w].hitRate+under.windows[w].hitRate,100);
 }
 assert.notEqual(over.streak,null);assert.notEqual(over.diff,null);assert.ok(over.h2h.games>0);
});

test('a response that ignores a requested prior season cannot masquerade as backfilled history',async()=>{
 const current={filters:[{name:'season',value:'2026',options:[{value:'2026'},{value:'2025'}]}]};
 const wrong=structuredClone(fixture('nfl-gamelog'));wrong.filters.find(f=>f.name==='season').value='2026';
 const provider=createPublicResearch({now,fetchImpl:async url=>json(url.includes('/search/')?fixture('nfl-search'):url.includes('season=2025')?wrong:current)});
 const result=await provider({sport:'NFL',playerName:'Aaron Rodgers',market:'Pass Attempts'});
 assert.equal(result.available,false);assert.equal(result.code,'NO_GAME_LOG_DATA');
});
test('malformed completed game metadata prevents claiming a complete season',async()=>{
 for(const damage of [e=>e.gameDate='invalid',e=>e.homeTeamScore=null,e=>e.homeTeamId='wrong',e=>e.gameResult='wrong']){
  const data=structuredClone(fixture('nfl-gamelog'));
  damage(Object.values(data.events)[0]);
  const provider=createPublicResearch({now,fetchImpl:async url=>json(url.includes('/search/')?fixture('nfl-search'):data)});
  const result=await provider({sport:'NFL',playerName:'Aaron Rodgers',market:'Pass Attempts'});
  assert.equal(result.available,true);assert.equal(result.coverage.seasonComplete,false);
 }
});

test('captured NFL rosters resolve the ambiguous Josh Allen search and replay his real passing log',async()=>{
 const calls=[];
 const provider=createPublicResearch({now,fetchImpl:async url=>{
  calls.push(url);
  if(url.includes('/search/'))return json(captured['common-search']);
  if(url.includes('/teams?'))return json(captured['roster-teams']);
  if(url.includes('/teams/2/roster'))return json(captured['roster-buf']);
  if(url.includes('/teams/15/roster'))return json(captured['roster-mia']);
  assert.match(url,/athletes\/3918298\/gamelog/);
  return json(url.includes('season=2025')?captured['common-previous']:captured['common-current']);
 }});
 const params={sport:'NFL',playerName:'Josh Allen',homeTeam:'Buffalo Bills',awayTeam:'Miami Dolphins',market:'Pass Yards',providerMarketKey:'player_pass_yds',line:225.5,side:'OVER'};
 const result=await provider(params);
 assert.equal(result.available,true);assert.equal(result.player.team,'BUF');
 assert.ok(result.gameLog.length>0);assert.ok(result.gameLog.every(g=>g.team==='BUF'));
 assert.ok(calls.some(u=>u.includes('/teams/15/roster')));
 const final=finalizeResearch({...result,...params});
 assert.notEqual(final.windows.l5.hitRate,null);
 // The feed's empty 2026 season must not inherit the 2025 backfill's rate.
 assert.equal(final.windows.season.hitRate,null);
});
