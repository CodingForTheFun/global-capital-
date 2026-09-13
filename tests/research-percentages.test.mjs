import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeResearch} from '../lib/analytics/research.mjs';
import {researchRate,formatResearchRate,researchSideRates} from '../lib/ui/research-percentages.mjs';
const base={available:true,season:2026,gameLog:[4,5,6].map((value,i)=>({gameId:String(i),value,season:2026}))};
test('tiles and rings retain matching precision from counts, not rounded rates',()=>{
 const w=analyzeResearch(base,4.5,'OVER').windows.l5;
 assert.equal(w.hitRate,67);
 assert.equal(formatResearchRate(researchRate(w)),'66.7%');
 assert.equal(formatResearchRate(researchSideRates(w,'OVER').over),'66.7%');
});
test('line changes and side changes preserve O/U meaning and neutral pushes',()=>{
 const over=analyzeResearch(base,5,'OVER').windows.l5;
 const under=analyzeResearch(base,5,'UNDER').windows.l5;
 assert.deepEqual(researchSideRates(over,'OVER'),researchSideRates(under,'UNDER'));
 assert.equal(formatResearchRate(researchSideRates(over,'OVER').push),'33.3%');
 assert.equal(formatResearchRate(researchRate(analyzeResearch(base,6.5,'OVER').windows.l5)),'0%');
 assert.equal(formatResearchRate(researchRate(analyzeResearch(base,6.5,'UNDER').windows.l5)),'100%');
});
test('missing, empty and inconsistent samples never become fabricated percentages',()=>{
 for(const w of [null,{}, {games:0,hits:0}, {games:3,hits:4}, {games:3,hits:null}])assert.equal(researchRate(w),null);
 assert.equal(researchSideRates({games:3,hits:2,misses:2,pushes:0},'OVER'),null);
 assert.equal(formatResearchRate(null),'N/A');
 assert.equal(formatResearchRate(101),'N/A');
});
