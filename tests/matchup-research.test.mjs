import test from 'node:test';
import assert from 'node:assert/strict';
import {matchupSample,matchupAnalysis,similarGames} from '../lib/analytics/matchup.mjs';
import {summarizeResearchSample} from '../lib/analytics/research.mjs';
import {finalizeResearch} from '../lib/autoscout/research-service.mjs';
const now=Date.parse('2026-09-13T12:00:00Z');
const rows=Array.from({length:30},(_,i)=>({gameId:`g${i}`,date:new Date(now-(i+1)*86400000).toISOString(),value:i,minutes:i===1?null:20+i,
 isHome:i%2===0,started:i%3===0?null:i%3===1,opponentId:i%2?'NBA:2':'NBA:3',opponent:i%2?'NY':'LA',season:2026,seasonType:2}));
const base={available:true,player:{sport:'NBA'},matchup:{opponentId:'NBA:2',opponent:'NY',isHome:true},gameLog:rows,season:2026,coverage:{seasonComplete:false}};
const options={now,window:'l10',line:4,side:'OVER'};
test('matchup slices share a fixed recent sample and retain the research push policy',()=>{
 const r=matchupAnalysis(base,options);
 assert.equal(r.baseline.games,10);assert.equal(r.baseline.hitRate,50);assert.equal(r.baseline.pushes,1);
 assert.equal(r.home.games,5);assert.equal(r.away.games,5);assert.equal(r.h2h.games,5);
 assert.equal(r.home.hitRate,40);assert.equal(r.home.pushes,1);assert.equal(r.targetVenue,'home');
 assert.equal(r.baseline.average,4.5);assert.equal(r.home.average,4);
 assert.equal(matchupAnalysis(base,{...options,side:'UNDER'}).baseline.hitRate,40);
});
test('season and H2H samples are not truncated to twenty or relabeled complete',()=>{
 const season=matchupAnalysis(base,{...options,window:'season'});
 assert.equal(season.baseline.games,30);assert.equal(season.baseline.average,14.5);assert.equal(season.partialSeason,true);
 assert.equal(matchupAnalysis({...base,season:null},{...options,window:'season'}).available,false);
 assert.equal(matchupAnalysis(base,{...options,window:'h2h'}).baseline.games,15);
});
test('same-player selection is independent of line, side and whether results hit',()=>{
 const select={...options,venue:'matchup',role:'any'};
 const a=similarGames(base,select),b=similarGames(base,{...select,line:100,side:'UNDER'});
 assert.deepEqual(a.summary.rows.map(r=>r.gameId),b.summary.rows.map(r=>r.gameId));
 assert.equal(a.matched,5);assert.equal(a.summary.hitRate,40);assert.equal(b.summary.hitRate,100);
});
test('missing venue cannot become away, and missing starter status cannot become bench',()=>{
 const r=similarGames({...base,matchup:{}},{...options,venue:'matchup'});
 assert.equal(r.available,false);assert.match(r.reason,/not verified/);
 const bench=similarGames(base,{...options,venue:'any',role:'bench'});
 assert.equal(bench.matched,3);assert.ok(bench.summary.rows.every(r=>r.started===false));
 const unknown=matchupAnalysis({...base,gameLog:rows.slice(0,3).map(r=>({...r,isHome:null}))},options);
 assert.equal(unknown.unknownVenue,3);assert.equal(unknown.home.games,0);assert.equal(unknown.away.games,0);
});
test('minutes filters reject missing and invalid ranges and unsupported sports',()=>{
 const a=similarGames(base,{...options,venue:'any',minMinutes:20,maxMinutes:24});
 assert.equal(a.matched,4);assert.equal(a.summary.rows[0].value,0);
 for(const range of [{minMinutes:-1},{minMinutes:30,maxMinutes:20},{minMinutes:true},{maxMinutes:'garbage'},{sport:'NFL',minMinutes:20}])
  assert.equal(similarGames(base,{...options,venue:'any',...range}).available,false);
 assert.equal(similarGames({...base,gameLog:[{...rows[0],minutes:0}]},{...options,venue:'any',minMinutes:0,maxMinutes:0}).matched,1);
});
test('future, in-progress, DNP and ambiguous duplicate games are excluded deterministically',()=>{
 const excluded=[{...rows[0],value:99},{...rows[1],gameId:'future',date:new Date(now+1).toISOString()},
  {...rows[1],gameId:'active',completed:false},{...rows[1],gameId:'dnp',didNotPlay:true},
  {...rows[1],gameId:'status',status:'scheduled'},{...rows[1],gameId:'bad',value:true}];
 const raw={...base,gameLog:[...rows.slice(0,4),rows[1],...excluded]};
 const a=matchupSample(raw,options),b=matchupSample({...raw,gameLog:raw.gameLog.slice().reverse()},options);
 assert.deepEqual(a.map(r=>r.gameId),['g1','g2','g3']);assert.deepEqual(a,b);
 assert.equal(matchupSample(base,{...options,eventStart:rows[4].date})[0].gameId,'g5');
});
test('opponent IDs take precedence over misleading names and unknown opponents stay empty',()=>{
 const r=matchupAnalysis({...base,matchup:{opponentId:'NBA:99',opponent:'NY'}},options);
 assert.equal(r.h2h.games,0);assert.equal(r.h2h.hitRate,null);
 assert.equal(matchupAnalysis({...base,matchup:{}},options).opponentKnown,false);
});
test('unavailable research and team totals cannot become same-player samples',()=>{
 assert.equal(matchupAnalysis({...base,available:false},options).available,false);
 assert.equal(similarGames({...base,entityType:'team'},{...options,venue:'any'}).matched,0);
 assert.equal(matchupSample(base,{...options,window:'garbage'}).length,0);
});
test('missing lines keep measured averages but never fabricate outcomes',()=>{
 const r=matchupAnalysis(base,{...options,line:null});assert.equal(r.baseline.average,4.5);assert.equal(r.baseline.hitRate,null);assert.equal(r.baseline.pushes,null);
 const small=similarGames(base,{...options,venue:'any',minMinutes:29,maxMinutes:29});
 assert.equal(small.summary.games,1);assert.equal(small.summary.limited,true);
 assert.equal(summarizeResearchSample(rows,4,'OVER').games,30);
});
test('finalization retains only explicit boolean upcoming venue evidence',()=>{
 for(const [input,expected]of [[true,true],[false,false],[null,null],['false',null]]){
  const r=finalizeResearch({gameLog:rows,line:4,isHome:input});assert.equal(r.matchup.isHome,expected);
 }
});
