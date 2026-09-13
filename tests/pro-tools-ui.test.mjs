import test from 'node:test';
import assert from 'node:assert/strict';
import {proToolsAnalysis} from '../lib/analytics/pro-tools.mjs';
import {proToolsHtml} from '../lib/ui/pro-tools.mjs';
const now=Date.parse('2026-09-13T12:00:00Z');
const group={sport:'NBA',eventId:'event',playerId:'player',playerName:'Fixture',marketId:'player_points',gameStartTime:new Date(now+3600000).toISOString()};
const q=(book,side,line)=>({...group,sportsbookKey:book,sportsbook:book,side,line,price:110,providerUpdatedAt:new Date(now-1000).toISOString()});
test('presentation preserves push break-even and does not invent EV from missing forecasts',()=>{
 const html=proToolsHtml(proToolsAnalysis({...group,rows:[q('<img src=x>','OVER',20),q('Other','UNDER',20)]},{now}));
 assert.match(html,/Lowest scenario return<\/dt><dd>0.00%/);
 assert.match(html,/No qualifying positive EV/);
 assert.match(html,/push<\/td><td>push/);
 assert.match(html,/Execution and matching settlement rules have not been verified/);
 assert.match(html,/&lt;img src=x&gt;/);assert.doesNotMatch(html,/<img/);
});
test('stale data renders unavailable without opportunity cards',()=>{
 const html=proToolsHtml(proToolsAnalysis({...group,archived:true,rows:[q('A','OVER',20.5),q('B','UNDER',21.5)]},{now}));
 assert.match(html,/Fresh pre-game offers/);assert.doesNotMatch(html,/class="asProCard"/);
});
