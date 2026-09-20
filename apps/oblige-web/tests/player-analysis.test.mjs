import test from 'node:test';
import assert from 'node:assert/strict';
import {loadLib} from './load-lib.mjs';
const {finite,currentSeasonGames,gameColumns,sportFamily,compareGames}=await loadLib('player-analysis');
const {computeWindow,playable}=await loadLib('analytics');
test('missing history cannot turn into zero-score games; zero itself remains valid',()=>{for(const v of [null,undefined,'',false,true,'NaN'])assert.equal(finite(v),null);assert.equal(finite(0),0);assert.equal(playable([{value:null},{value:0}]).length,1);const w=computeWindow([{value:null},{value:0},{value:10},{value:20}],10,'OVER','l5','L5');assert.equal(w.games,3);assert.equal(w.pushes,1);assert.equal(w.hitRate,33);});
test('season sample excludes backfilled years and playoffs',()=>{const rows=[{season:2026,value:20},{season:2025,value:99},{season:2026,seasonType:3,value:40}];assert.deepEqual(currentSeasonGames(rows,2026),[rows[0]]);assert.deepEqual(currentSeasonGames(rows,null),[]);});
test('tennis and other sport logs use their actual metrics',()=>{assert.equal(sportFamily('tennis_atp'),'tennis');assert.ok(gameColumns('TENNIS',[{aces:3,gamesWon:12}]).includes('aces'));assert.ok(!gameColumns('TENNIS',[]).includes('passingYards'));assert.ok(gameColumns('NBA',[]).includes('points'));assert.ok(gameColumns('MLB',[]).includes('hits'));});
test('sort is numeric and missing values stay last in either direction',()=>{for(const d of [1,-1])assert.ok(compareGames({points:null},{points:0},'points',d)>0);assert.ok(compareGames({points:9},{points:20},'points',1)<0);assert.ok(compareGames({date:'2026-09-10'},{date:'2026-09-01'},'date',-1)<0);});

test('tennis H2H opponent matching never aliases different people by initials',async()=>{
 const {buildOpponentOptions}=await loadLib('opponent-options');
 const options=buildOpponentOptions(['Jack Smith','John Smith'],{opponent:'John Smith',team:null,homeTeam:null,awayTeam:null},true);
 assert.equal(options.find(o=>o.value==='Jack Smith').label,'Jack Smith');
 assert.equal(options.find(o=>o.value==='John Smith').label,'John Smith ★');
});

test('tennis upcoming opponent is resolved from exact event participants only',async()=>{
 const {analysisOpponent}=await loadLib('player-analysis');
 const group={sport:'TENNIS',player:'Aliaksandra Sasnovich',opponent:null,awayTeam:'Aliaksandra Sasnovich',homeTeam:'Daria Kasatkina'};
 assert.equal(analysisOpponent(group),'Daria Kasatkina');
 assert.equal(analysisOpponent({...group,player:'Other Player'}),null);
 assert.equal(analysisOpponent({...group,homeTeam:null}),null);
});
