import test from 'node:test';
import assert from 'node:assert/strict';
import {loadLib} from './load-lib.mjs';
const {cardHistory}=await loadLib('card-history');
const {playable}=await loadLib('analytics');
const group={line:10.5};
test('card tiles exclude DNP, null and malformed values rather than making them zero',()=>{
 const gameLog=[12,null,9,15,undefined,false,'',0].map((value,i)=>({value,date:`2050-01-${String(20-i).padStart(2,'0')}`}));
 const metrics=cardHistory({available:true,gameLog},group);
 assert.equal(metrics.find(m=>m.label==='L5').value,50);
 assert.equal(metrics.find(m=>m.label==='L5').sample,4);
 assert.equal(metrics.find(m=>m.label==='AVG').value,9);
 assert.equal(metrics.find(m=>m.label==='DIFF').value,-1.5);
 assert.equal(playable(gameLog).length,4);
});
test('absent history never fabricates rate, streak or season',()=>{
 assert.ok(cardHistory({available:false,gameLog:[{value:20}]},group).every(m=>m.value===null));
 assert.ok(cardHistory(null,group).every(m=>m.value===null));
});
test('season and H2H require their verified provider summaries',()=>{
 const gameLog=Array.from({length:10},()=>({value:20,opponent:'ANY',season:2050}));
 let tiles=cardHistory({available:true,gameLog},group);
 assert.equal(tiles.find(m=>m.label==='SZN').value,null);
 assert.equal(tiles.find(m=>m.label==='H2H').value,null);
 tiles=cardHistory({available:true,gameLog,windows:{season:{available:true,hitRate:60,games:50},last5:{available:false,hitRate:1,games:5}},h2h:{hitRate:25,games:4}},group);
 assert.equal(tiles.find(m=>m.label==='SZN').value,60);
 assert.equal(tiles.find(m=>m.label==='H2H').value,25);
 assert.equal(tiles.find(m=>m.label==='L5').value,100);
});

test('the research API uses percentage units: one percent never becomes 100 percent',()=>{
 const metrics=cardHistory({available:true,windows:{season:{games:100,hits:1,hitRate:1},last10:{games:10,hits:0,hitRate:0}},h2h:{games:100,hits:1,hitRate:1}},group);
 assert.equal(metrics.find(m=>m.label==='SZN').value,1);
 assert.equal(metrics.find(m=>m.label==='H2H').value,1);
 assert.equal(metrics.find(m=>m.label==='L10').value,0);
});
