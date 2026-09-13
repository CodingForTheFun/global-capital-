import test from 'node:test';
import assert from 'node:assert/strict';
import {createMatchupClient,winPredictorHtml,gameContextHtml,researchWithMatchupContext} from '../lib/ui/matchup-context.mjs';
const now=Date.now(),target={sport:'NBA',eventId:'g',homeTeam:'Home',awayTeam:'Away',gameStartTime:new Date(now+3600000).toISOString()};
const result=()=>({...target,available:true,expiresAt:new Date(now+300000).toISOString(),retrievedAt:new Date(now).toISOString(),sourceUrl:'https://www.espn.com/nba/game/_/gameId/100',prediction:{available:true,homePercent:60.1,awayPercent:39.6,drawPercent:null,expiresAt:new Date(now+300000).toISOString(),note:'Source estimate'},teams:[{side:'home',name:'<img src=x>',record:'0-0',injuries:{available:false},lineup:{available:false,starters:[],probables:[]}},{side:'away',name:'Away',injuries:{available:true,rows:[]},lineup:{available:false,starters:[],probables:[]}}],weather:{available:true,temperature:0,unit:'°'}});
test('published percentages are shown unchanged and escape team names',()=>{const html=winPredictorHtml(result());assert.match(html,/60.1%/);assert.match(html,/39.6%/);assert.match(html,/&lt;img src=x&gt;/);assert.doesNotMatch(html,/<img/);assert.match(html,/generation timestamp/);});
test('expired estimates are withheld without inventing percentages',()=>{const r=result();r.prediction.expiresAt=new Date(now-1000).toISOString();assert.doesNotMatch(winPredictorHtml(r),/60.1%/);r.expiresAt=r.prediction.expiresAt;assert.match(gameContextHtml(r),/expired/);});
test('report absence is not represented as healthy or confirmed',()=>{const html=gameContextHtml(result());assert.match(html,/does not confirm everyone is healthy/);assert.match(html,/Confirmed starters have not been published/);assert.match(html,/0°/);assert.match(html,/0-0/);});
test('client coalesces identical games and does not key on player or prop line',async()=>{
 let calls=0;const client=createMatchupClient({clock:()=>now,fetcher:async()=>{calls++;return {ok:true,json:async()=>result()};}});
 await Promise.all([client.lookup(target),client.lookup({...target,playerName:'Other',line:99})]);assert.equal(calls,1);await client.lookup(target);assert.equal(calls,1);
});
test('failed fetch can be retried and foreign game payloads fail closed',async()=>{
 let valid=false,calls=0;const client=createMatchupClient({clock:()=>now,fetcher:async()=>{calls++;return {ok:valid,json:async()=>result()};}});
 assert.equal((await client.lookup(target)).available,false);valid=true;assert.equal((await client.lookup(target,{force:true})).available,true);assert.equal(calls,2);
 const wrong=createMatchupClient({clock:()=>now,fetcher:async()=>({ok:true,json:async()=>({...result(),eventId:'other'})})});assert.equal((await wrong.lookup(target)).available,false);
});
test('invalid and archived targets are terminal states without requests or render loops',async()=>{
 let calls=0;const client=createMatchupClient({fetcher:async()=>{calls++;throw Error('unexpected');}});
 assert.equal(client.peek({}).available,false);assert.equal((await client.lookup({...target,archived:true})).available,false);assert.equal(calls,0);
});
test('overview injury and starter context require an exact verified player ID',()=>{
 const base={player:{providerPlayerId:'history:NBA:123'},context:{}},r=result();
 r.teams[0].injuries={available:true,rows:[{playerId:'history:NBA:123',status:'Questionable',detail:'Knee'}]};
 r.teams[0].lineup.starters=[{playerId:'history:NBA:123'}];
 const enriched=researchWithMatchupContext(base,r,now);assert.equal(enriched.context.injuryStatus,'Questionable');assert.equal(enriched.context.isStarter,true);assert.deepEqual(base.context,{});
 assert.equal(researchWithMatchupContext({...base,player:{providerPlayerId:'history:NBA:999'}},r,now).context.injuryStatus,undefined);
 r.teams[1].injuries=r.teams[0].injuries;assert.equal(researchWithMatchupContext(base,r,now).context.injuryStatus,undefined);
});
