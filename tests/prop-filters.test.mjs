import test from 'node:test';
import assert from 'node:assert/strict';
import {filterPropResearch,propFiltersHtml} from '../lib/ui/prop-filters.mjs';
import {analyzeResearch} from '../lib/analytics/research.mjs';
const base={season:2026,available:true,context:{seasonAverage:99,seasonStat:999},coverage:{seasonComplete:true},gameLog:[
 {gameId:'a',date:'2026-09-10T00:00:00Z',season:2026,opponent:'NY',team:'BOS',minutes:30,pitchingOuts:16,started:true,value:10},
 {gameId:'b',date:'2026-09-09T00:00:00Z',season:2026,opponent:'NY',team:'BOS',minutes:0,pitchingOuts:0,started:false,value:0},
 {gameId:'c',date:'2025-09-08T00:00:00Z',season:2025,opponent:'LA',team:'CHI',value:20}
]};
test('prop filters preserve the original sample when no filter is selected',()=>assert.equal(filterPropResearch(base,{}),base));
test('cohorts combine exact fields without treating missing participation as false',()=>{
 assert.deepEqual(filterPropResearch(base,{opponent:'NY',starter:'no'}).gameLog.map(r=>r.gameId),['b']);
 assert.deepEqual(filterPropResearch(base,{season:'2025',team:'CHI'}).gameLog.map(r=>r.gameId),['c']);
 assert.deepEqual(filterPropResearch(base,{minMinutes:'0'}).gameLog.map(r=>r.gameId),['a','b']);
});
test('innings thresholds use outs, with source nulls excluded',()=>{
 assert.deepEqual(filterPropResearch(base,{minOuts:'15'}).gameLog.map(r=>r.gameId),['a']);
 assert.deepEqual(filterPropResearch(base,{minOuts:'18'}).gameLog,[]);
});
test('filtered analytics recompute without leaking season totals or mutating original history',()=>{
 const filtered=filterPropResearch(base,{minMinutes:'25'}),result=analyzeResearch(filtered,5,'OVER');
 assert.equal(result.windows.l5.games,1);assert.equal(result.windows.l5.hitRate,100);
 assert.equal(filtered.context.seasonStat,null);assert.equal(filtered.coverage.seasonComplete,false);
 assert.equal(base.gameLog.length,3);assert.equal(base.context.seasonStat,999);
 assert.equal(analyzeResearch(filterPropResearch(base,{minMinutes:'40'}),5,'OVER').windows.l5.games,0);
});
test('dropdowns expose supported fields and escape source labels',()=>{
 const html=propFiltersHtml(base);assert.match(html,/5 IP \(15 outs\)/);assert.match(html,/Starting role/);
 const empty=propFiltersHtml({gameLog:[]});assert.doesNotMatch(empty,/Minimum minutes|Minimum innings|Starting role|Historical team/);
 assert.match(propFiltersHtml({gameLog:[{opponent:'<script>'}]}),/&lt;script&gt;/);
});
