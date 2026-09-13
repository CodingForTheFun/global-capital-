import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMatchupSummary,resolveMatchupEvent} from '../lib/data-sources/espn/matchup.mjs';
import {createPublicResearch} from '../lib/data-sources/espn/research.mjs';
import {gatedApi} from '../lib/auth/gate.mjs';
const now=Date.parse('2026-09-13T12:00:00Z'),retrievedAt=new Date(now).toISOString();
const target={sport:'NFL',eventId:'canonical-odds-game',homeTeam:'Cincinnati Bengals',awayTeam:'Tampa Bay Buccaneers',gameStartTime:'2026-09-13T17:00:00Z'};
function fixture(){
 const competition={id:'100',date:target.gameStartTime,status:{type:{name:'STATUS_SCHEDULED',state:'pre',completed:false}},competitors:[
  {homeAway:'home',team:{id:'4',displayName:target.homeTeam,abbreviation:'CIN'},record:[{type:'total',summary:'0-0'}]},
  {homeAway:'away',team:{id:'27',displayName:target.awayTeam,abbreviation:'TB'},record:[{type:'total',summary:'0-0'}]}]};
 const summary={header:{id:'100',league:{slug:'nfl'},competitions:[competition]},predictor:{homeTeam:{id:'4',gameProjection:'61.9'},awayTeam:{id:'27',gameProjection:'37.8'}},
  injuries:[{team:{id:'4'},injuries:[{athlete:{id:'123',displayName:'Fixture Player'},status:'Questionable',date:'2026-09-12T12:00Z',details:{type:'Knee'}}]}],gameInfo:{venue:{fullName:'Fixture Stadium'},weather:{temperature:0}}};
 return {summary,scoreboard:{leagues:[{slug:'nfl'}],events:[{id:'100',date:target.gameStartTime,competitions:[competition]}]}};
}
const run=(summary=fixture().summary,options={})=>normalizeMatchupSummary(summary,target,'100',{now,retrievedAt,...options});
test('exact game and league matching resolves source ID without borrowing player IDs',()=>{
 const {scoreboard}=fixture();assert.equal(resolveMatchupEvent(scoreboard,target).id,'100');
 assert.equal(resolveMatchupEvent(scoreboard,{...target,homeTeam:target.awayTeam,awayTeam:target.homeTeam}),null);
 assert.equal(resolveMatchupEvent(scoreboard,{...target,sport:'NCAAF'}),null);
 assert.equal(resolveMatchupEvent(scoreboard,{...target,gameStartTime:'2026-09-13T18:00:00Z'}),null);
 scoreboard.events.push(structuredClone(scoreboard.events[0]));assert.equal(resolveMatchupEvent(scoreboard,target),null);
});
test('summary must independently verify kickoff, team orientation, source ID and league',()=>{
 for(const change of [s=>s.header.id='101',s=>s.header.league.slug='college-football',s=>s.header.competitions[0].date='2026-09-13T18:00:00Z',s=>s.header.competitions[0].competitors.reverse().forEach((c,i)=>c.homeAway=i?'away':'home')]){
  const {summary}=fixture();change(summary);assert.equal(run(summary).available,false);
 }
});
test('published estimates retain provider rounding and do not manufacture a draw probability',()=>{
 const r=run();assert.equal(r.prediction.available,true);assert.equal(r.prediction.homePercent,61.9);assert.equal(r.prediction.awayPercent,37.8);assert.equal(r.prediction.drawPercent,null);assert.equal(r.prediction.generatedAt,null);assert.equal(r.prediction.kind,'published-model');
});
test('stale and missing retrieval timestamps cannot become newly generated predictions',()=>{
 for(const t of [undefined,null,'2026-09-13T11:00:00Z','2026-09-13T12:00:01Z'])assert.equal(run(undefined,{retrievedAt:t}).available,false);
});
test('started, completed, postponed, TBD and expired pre-game estimates are withheld',()=>{
 for(const mutate of [s=>s.header.competitions[0].status.type.state='in',s=>s.header.competitions[0].status.type.completed=true,s=>s.header.competitions[0].status.type.name='STATUS_POSTPONED',s=>s.header.timeValid=false,s=>s.header.competitions[0].status.isTBDFlex=true]){const {summary}=fixture();mutate(summary);assert.equal(run(summary).prediction.available,false);}
 assert.equal(run(undefined,{now:Date.parse(target.gameStartTime),retrievedAt:target.gameStartTime}).prediction.available,false);
});
test('foreign teams and invalid or impossible percentages cannot become predictions',()=>{
 for(const values of [[true,40],['',40],[null,40],[-1,60],[101,0],[80,80],[0,0]]){const {summary}=fixture();[summary.predictor.homeTeam.gameProjection,summary.predictor.awayTeam.gameProjection]=values;assert.equal(run(summary).prediction.available,false);}
 const {summary}=fixture();summary.predictor.homeTeam.id='999';assert.equal(run(summary).prediction.available,false);
});
test('injury evidence is team-scoped and absence is not a healthy designation',()=>{
 const r=run();assert.equal(r.teams[0].injuries.rows[0].playerId,'history:NFL:123');assert.equal(r.teams[0].injuries.rows[0].status,'Questionable');assert.equal(r.teams[1].injuries.available,false);
 const {summary}=fixture();summary.injuries[0].team.id='999';assert.equal(run(summary).teams[0].injuries.available,false);
});
test('probable starters are distinct from confirmed lineup entries',()=>{
 const {summary}=fixture();summary.header.competitions[0].competitors[0].probables=[{displayName:'Probable Starting Pitcher',athlete:{id:'1000',displayName:'Pitcher'}}];
 summary.rosters=[{team:{id:'4'},homeAway:'home',roster:[{athlete:{id:'123',displayName:'Bench Player'},starter:false}]}];
 let r=run(summary);assert.equal(r.teams[0].lineup.available,false);assert.equal(r.teams[0].lineup.probables.length,1);
 summary.rosters[0].roster[0].starter=true;r=run(summary);assert.equal(r.teams[0].lineup.starters.length,1);
});
test('weather zero and real zero-game records survive; missing roof is not assumed outdoors',()=>{
 const r=run();assert.equal(r.weather.temperature,0);assert.equal(r.venue.indoor,null);assert.equal(r.teams[0].record,'0-0');assert.equal(r.teams[0].rank,null);
 const {summary}=fixture();summary.gameInfo.weather.temperature=true;assert.equal(run(summary).weather.available,false);
});
test('malformed optional sections do not erase a valid published prediction',()=>{
 const {summary}=fixture();summary.injuries={};summary.rosters={};assert.equal(run(summary).prediction.available,true);
});
test('shared source client coalesces matchup loads across players and preserves retrieval time',async()=>{
 const {summary,scoreboard}=fixture();let clock=now;const paths=[];
 const client=createPublicResearch({now:()=>clock,fetchImpl:async url=>{paths.push(url);return {ok:true,status:200,json:async()=>url.includes('/summary?')?summary:scoreboard};}});
 const results=await Promise.all([client.matchup(target),client.matchup(target)]);assert.equal(paths.length,2);assert.equal(results[0].prediction.homePercent,61.9);
 clock+=60000;const cached=await client.matchup(target);assert.equal(paths.length,2);assert.equal(cached.retrievedAt,retrievedAt);
 assert.ok(paths[0].includes('dates=20260912-20260914'));
});
test('source failure, unsupported sport and old event stay unavailable without extra requests',async()=>{
 let calls=0;const client=createPublicResearch({now:()=>now,fetchImpl:async()=>{calls++;return {ok:false,status:503};}});
 assert.equal((await client.matchup({...target,sport:'UNKNOWN'})).available,false);assert.equal(calls,0);
 assert.equal((await client.matchup({...target,gameStartTime:'2020-01-01T00:00:00Z'})).available,false);assert.equal(calls,0);
 assert.equal((await client.matchup(target)).available,false);assert.equal(calls,1);
});
test('matchup route is covered by the existing research account gate',()=>{assert.equal(gatedApi('/api/apex/research-matchup'),true);});
