import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {compareResearchQuotes} from '../lib/ui/line-comparison.mjs';
const source=fs.readFileSync(new URL('../apex-v2/scout-ui-v5.js',import.meta.url),'utf8');
const context=vm.createContext({compareResearchQuotes,payload:{meta:{}},defaultSide:g=>g.side||'OVER'});
const start=source.indexOf('function lineSpread('),end=source.indexOf('\nfunction ',start+1);
vm.runInContext(source.slice(start,end),context);
const group={sport:'NBA',eventId:'game',playerId:'player',marketId:'player_points',entityType:'player'};
const quote=(book,line,extra={})=>({...group,sportsbookKey:book,line,price:-110,side:'OVER',providerUpdatedAt:new Date(Date.now()-1000).toISOString(),...extra});
test('discrepancies use distinct fresh books on the same side',()=>{
 assert.equal(context.lineSpread({...group,rows:[quote('A',20.5),quote('B',22.5),quote('C',30.5,{side:'UNDER'})]}),2);
 assert.equal(context.lineSpread({...group,rows:[quote('A',20.5),quote('A',22.5)]}),0);
});
test('stale, ambiguous and foreign-event quotes cannot create discrepancies',()=>{
 for(const extra of [{providerUpdatedAt:new Date(Date.now()-3600000).toISOString()},{providerUpdatedAt:null},{eventId:'different'}])assert.equal(context.lineSpread({...group,rows:[quote('A',20.5),quote('B',25.5,extra)]}),0);
 const rows=[quote('A',20.5),quote('B',25.5)];
 assert.equal(context.lineSpread({...group,rows,comparisonOffers:[...rows,quote('B',26.5,{providerUpdatedAt:rows[1].providerUpdatedAt})]}),0);
 context.payload.meta.stale=true;assert.equal(context.lineSpread({...group,rows}),0);context.payload.meta.stale=false;
 assert.equal(context.lineSpread({...group,rows,archived:true}),0);
});
