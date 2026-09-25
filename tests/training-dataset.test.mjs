import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTrainingRows} from '../lib/ml/training-dataset.mjs';

test('training rows use only games strictly before each target game',()=>{
 const start=Date.parse('2026-01-01T00:00:00Z');
 const records=Array.from({length:12},(_,i)=>({sport:'MLB',playerId:'p1',marketId:'pitcher_strikeouts',eventId:'e'+i,gameStartTime:new Date(start+i*86400000).toISOString(),actual:4+i%5,line:4.5,opponent:i%3===0?'NYM':'ATL'}));
 const rows=buildTrainingRows(records);assert.equal(rows.length,7);
 assert.equal(rows[0].features.historyGames,5);assert.equal(rows[0].featureCutoff,records[4].gameStartTime);
 assert.ok(Date.parse(rows[0].featureCutoff)<Date.parse(rows[0].gameStartTime));
 assert.equal(rows.at(-1).features.historyGames,11);
});
test('H2H and current-line hit features are computed from prior verified games only',()=>{
 const start=Date.parse('2026-01-01T00:00:00Z');
 const records=Array.from({length:8},(_,i)=>({sport:'NBA',playerId:'p',marketId:'points',eventId:'e'+i,gameStartTime:new Date(start+i*86400000).toISOString(),actual:i<6?20:30,line:22.5,opponent:i%2?'BOS':'NYK'}));
 const rows=buildTrainingRows(records),r=rows[0];assert.equal(r.features.historyGames,5);assert.equal(r.features.l5OverRate,0);assert.ok(r.features.h2hGames>0);
});
