import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifiedTaco,tacoBadgeHtml,removeExpiredTacoBadges,TACO_FRESHNESS_MS} from '../lib/ui/offer-promotion.mjs';
const now=Date.parse('2026-09-15T15:00:00Z');
function quote(sport='NFL') {
  const q={id:'test-quote',sport,eventId:'test-game',playerId:'test-athlete',playerName:'Fixture Athlete',marketId:'player_pass_yds',side:'OVER',line:150.5,sportsbookKey:'prizepicks',gameStartTime:'2026-09-15T22:00:00Z'};
  q.promotion={type:'taco',status:'active',source:'prizepicks',verified:true,sourceRecordId:'synthetic-taco-test-record',offerId:q.id,sport:q.sport,eventId:q.eventId,playerId:q.playerId,marketId:q.marketId,side:q.side,line:q.line,originalLine:200.5,startsAt:'2026-09-15T14:00:00Z',expiresAt:'2026-09-15T17:00:00Z',observedAt:'2026-09-15T14:59:00Z'};
  return q;
}
test('Taco is attached only to the exact source-verified individual offer in any league',()=>{
  for(const sport of ['NFL','NBA','WNBA','MLB','NHL','NCAAF','NCAAB','MLS','EPL','UCL']) {
    const q=quote(sport);assert.ok(verifiedTaco(q,now));assert.match(tacoBadgeHtml(q,now),/🌮/);
    for(const field of ['id','sport','eventId','playerId','marketId','side','sportsbookKey']) assert.equal(tacoBadgeHtml({...q,[field]:'different'},now),'',field);
    assert.equal(tacoBadgeHtml({...q,line:149.5},now),'');
    assert.equal(tacoBadgeHtml({...q,line:200.5},now),'','Same athlete regular line is not a Taco');
  }
});
test('Tuesday, names, generic discounts, Goblins, Demons and bare flags never imply a Taco',()=>{
  const q=quote();
  for(const p of [null,{}, {...q.promotion,verified:false},{...q.promotion,verified:'true'}, {...q.promotion,type:'flash_sale'},{...q.promotion,type:'goblin'},{...q.promotion,source:'underdog'}, {...q.promotion,sourceRecordId:''},{...q.promotion,status:'removed'}])assert.equal(tacoBadgeHtml({...q,promotion:p,isTaco:true,isDiscounted:true,playerName:'Taco Tuesday'},now),'');
  for(const key of ['isGoblin','isDemon','live','completed','archived','stale'])assert.equal(tacoBadgeHtml({...q,[key]:true},now),'');
});
test('expired, unstarted, unobserved or stale source records cannot retain a Taco badge',()=>{
  const q=quote();
  for(const p of [{expiresAt:'2026-09-15T15:00:00Z'},{startsAt:'2026-09-15T15:01:00Z'},{observedAt:'2026-09-15T15:01:00Z'},{observedAt:'2026-09-15T14:45:00Z'},{observedAt:'2026-09-15T14:59:00'},{originalLine:100}])assert.equal(verifiedTaco({...q,promotion:{...q.promotion,...p}},now),null);
  assert.equal(verifiedTaco({...q,gameStartTime:'2026-09-15T15:00:00Z'},now),null);
  assert.equal(verifiedTaco(q,now).validUntil,Date.parse(q.promotion.observedAt)+TACO_FRESHNESS_MS);
  let removed=0;removeExpiredTacoBadges({querySelectorAll:()=>[{dataset:{tacoUntil:String(now)},remove:()=>removed++},{dataset:{tacoUntil:String(now+1)},remove:()=>removed++}]},now);assert.equal(removed,1);
});
test('badge metadata is escaped and quote rendering never annotates the player or market header',()=>{
  const q=quote();q.id=q.promotion.offerId='\" onmouseover=\"bad';assert.ok(!tacoBadgeHtml(q,now).includes('="bad'));assert.match(tacoBadgeHtml(q,now),/&quot;/);
  const ui=readFileSync(new URL('../apex-v2/scout-ui-v5.js',import.meta.url),'utf8');
  const card=ui.slice(ui.indexOf('function rowHtml('),ui.indexOf('function rowHtml(')+2000);
  assert.ok(!card.includes('tacoBadgeHtml('));
  assert.ok(ui.includes('tacoBadgeHtml(g.archived?null:x.o)'));assert.ok(ui.includes('tacoBadgeHtml(g.archived?null:x.u)'));
  assert.ok(!ui.includes('new Date().getDay()===2'));
});
