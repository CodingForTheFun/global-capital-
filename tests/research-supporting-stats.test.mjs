import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {analyzeResearch,researchOpponentMatches} from '../lib/analytics/research.mjs';
const source=fs.readFileSync(new URL('../apex-v2/scout-ui-v5.js',import.meta.url),'utf8');
const context=vm.createContext({researchOpponentMatches,drawerState:{window:'l5'}});
for(const name of ['esc','num','dec','filteredGames','secondaryHeaders','supportingStats']){
 const start=source.indexOf(`function ${name}(`),end=source.indexOf('\nfunction ',start+1);
 vm.runInContext(source.slice(start,end),context);
}
const games=Array.from({length:12},(_,i)=>({gameId:String(i),date:new Date(Date.UTC(2026,8,12-i)).toISOString(),value:i,assists:i===1?null:i,isHome:i%2===0,season:2026,opponent:i%2?'NY':'LA'}));
const base={available:true,gameLog:games,season:2026,matchup:{opponent:'NY'}};
const group={sport:'NBA',marketId:'player_points'};
test('supporting stats retain zero, exclude missing data and report their own sample',()=>{
 const html=context.supportingStats(analyzeResearch(base,4.5,'OVER'),group);
 assert.match(html,/data-support-stat="assists"><small>AST \/ game<\/small><b>2.3<\/b><span class="asSupportSample">4 of 5 games reported/);
 assert.match(html,/data-support-stat="rebounds"><small>REB \/ game<\/small><b>Unavailable/);
});
test('supporting stats follow venue and window selections',()=>{
 let r=analyzeResearch(base,4.5,'OVER','home');
 assert.match(context.supportingStats(r,group),/<b>4<\/b><span class="asSupportSample">5 of 5 games reported/);
 context.drawerState.window='l20';
 assert.match(context.supportingStats(r,group),/<b>5<\/b><span class="asSupportSample">6 of 6 games reported/);
 context.drawerState.window='h2h';
 r=analyzeResearch(base,4.5,'OVER');
 assert.match(context.supportingStats(r,group),/<b>7<\/b><span class="asSupportSample">5 of 6 games reported/);
 context.drawerState.window='l5';
});
test('unsupported and team markets cannot inherit player supporting statistics',()=>{
 assert.match(context.supportingStats(base,{sport:'NFL',entityType:'team'}),/unavailable for this market/);
 assert.match(context.supportingStats(base,{sport:'UNKNOWN'}),/unavailable for this market/);
});
test('boolean and nonfinite fields are not measured supporting statistics',()=>{
 const r=analyzeResearch({...base,gameLog:games.slice(0,4).map((g,i)=>({...g,assists:[true,Infinity,NaN,0][i]}))},4.5,'OVER');
 assert.match(context.supportingStats(r,group),/<b>0<\/b><span class="asSupportSample">1 of 4 games reported/);
});
