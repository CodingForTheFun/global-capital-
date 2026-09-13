import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {tacoOffer,activeTacos} from '../lib/autoscout/providers/taco-offers.mjs';
import {verifiedTacoChannelOffer} from '../lib/ui/offer-promotion.mjs';
const now=Date.parse('2026-09-15T15:00:00Z');
const ctx={book:{key:'prizepicks'},sport:'NFL',event:{id:'test-game',commenceTime:'2026-09-15T23:00:00Z'},market:'player_pass_yds',now};
const raw={description:'Fixture Player',name:'Over',point:150.5,promotion:{type:'taco',original_line:200.5,expires_at:'2026-09-15T18:00:00Z'}};
test('separate Taco channel requires its exact source record, not just a discounted number',()=>{
 const q=tacoOffer(raw,ctx);assert.ok(verifiedTacoChannelOffer(q,'NFL',now));
 assert.equal(q.observedAt,new Date(now).toISOString());
 for(const mutation of [{verified:false},{sportsbookKey:'underdog'},{promotionType:'goblin'},{promotional:false},{market:'player_rush_yds'},{line:160.5},{side:'UNDER'},{playerName:'Other Player'},{eventId:'other-game'}])assert.equal(verifiedTacoChannelOffer({...q,...mutation},'NFL',now),null);
 assert.equal(verifiedTacoChannelOffer(q,'NBA',now),null);
 assert.deepEqual(activeTacos([q],now+15*60000),[]);
 assert.equal(verifiedTacoChannelOffer({...q,gameStartTime:new Date(now).toISOString()},'NFL',now),null);
});
test('contradictory Goblin/Demon source flags cannot become Taco offers',()=>{
 for(const field of ['isGoblin','isDemon','is_goblin','is_demon'])assert.equal(tacoOffer({...raw,[field]:true},ctx),null);
});
test('concurrent game-board and projected-stat controls coexist with ML; Tacos remain Auto Scout-only',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 const workspace=read('apps/guest-dashboard/components/SportsWorkspace.tsx');
 for(const fragment of ['GameBoard','PropInsight','MLPrediction','Projected stat + Ask'])assert.ok(workspace.includes(fragment));
 assert.ok(!workspace.includes('TacoBadge'));
 const ui=read('public/autoscout-tacos.js');assert.ok(ui.includes('verifiedTacoChannelOffer(o, currentSport)'));assert.ok(ui.includes('line.append(old, discounted, badge)'));
 assert.ok(read('apps/guest-dashboard/components/PropInsight.tsx').includes('<MLPrediction target={line === quote.line ? quote : {...quote, eventId: ""}} side={side}/>'));
});
