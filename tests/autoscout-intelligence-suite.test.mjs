import test from 'node:test';import assert from 'node:assert/strict';
import {lineSensitivity,sportsbookDisagreement,dataQuality,scenarioLab,dependencyGraph,changeRadar,researchBrief} from '../lib/autoscout/intelligence-suite.mjs';

test('line sensitivity keeps pushes out of hits',()=>{const out=lineSensitivity([{value:9},{value:10},{value:11}],10,'OVER',[0]);assert.equal(out[0].hits,1);assert.equal(out[0].pushes,1);assert.equal(out[0].hitRate,100/3);});
test('under sensitivity reverses threshold direction',()=>{const out=lineSensitivity([{value:8},{value:10},{value:12}],10,'UNDER',[0]);assert.equal(out[0].hits,1);assert.equal(out[0].misses,1);});
test('book disagreement reports range without inventing books',()=>{const x=sportsbookDisagreement([{sportsbookKey:'a',line:24.5},{sportsbookKey:'b',line:27.5}]);assert.equal(x.spread,3);assert.equal(x.books,2);});
test('quality is evidence quality, not pick confidence',()=>{const x=dataQuality({games:Array.from({length:15},(_,i)=>({value:i})),updatedAt:new Date().toISOString(),identityConfidence:1,opponentGames:5,lineBooks:5,lineupKnown:true});assert.equal(x.label,'HIGH');assert.ok(x.score<=100);});
test('scenario lab is transparent and deterministic',()=>{const x=scenarioLab({baselineProjection:30,baselineMinutes:36,targetMinutes:30});assert.equal(x.adjusted,25);assert.match(x.model,/not a prediction guarantee/);});
test('dependency graph labels small samples',()=>{const x=dependencyGraph([{teammate:'A',withTeammate:true,value:10},{teammate:'A',withTeammate:false,value:15}]);assert.equal(x[0].delta,5);assert.equal(x[0].smallSample,true);});
test('change radar ranks larger fresher moves first',()=>{const x=changeRadar([{player:'A',previousLine:10,currentLine:13,booksMoved:5,minutesAgo:10},{player:'B',previousLine:10,currentLine:11,booksMoved:1,minutesAgo:300}]);assert.equal(x[0].player,'A');});
test('brief refuses to manufacture evidence',()=>{const x=researchBrief({player:'A',market:'Points',line:20.5});assert.match(x.summary,/Insufficient verified evidence/);});
