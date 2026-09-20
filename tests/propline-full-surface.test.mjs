import test from 'node:test';
import assert from 'node:assert/strict';
import { patchProplineFullFrontdoor, patchProplineFullUi } from '../lib/autoscout/propline-full-runtime-patch.mjs';
import { priceSameGameParlay } from '../lib/data-sources/propline/full.mjs';

test('extended PropLine frontdoor route is inserted once and parses', () => {
  const source = `
async function maybeServeResearchBatch(req, res) { return false; }
async function server(req,res){
  if (await maybeServePropLineInsights(req, res)) return;
}`;
  const patched = patchProplineFullFrontdoor(source);
  assert.match(patched, /async function maybeServePropLineFull/);
  assert.match(patched, /player-history/);
  assert.match(patched, /market-hit-rates/);
  assert.match(patched, /resolution-summary/);
  assert.match(patched, /kind: 'sgp'/);
  assert.equal(patchProplineFullFrontdoor(patched), patched);
  assert.doesNotThrow(() => new Function(patched));
});

test('extended UI adds verified intelligence and on-demand SGP pricing', () => {
  const source = `(async function(){
var nativeFetch=window.fetch,proplineCache=new Map(),slip=[];
function num(v){return Number(v)||0}function esc(v){return String(v)}function dec(v){return String(v)}function money(v){return String(v)}function shortDate(v){return String(v)}function defaultSide(){return 'OVER'}function boardLine(){return 1.5}function bestPrice(){return {price:-110,sportsbookKey:'fanduel'}}function proplineAsk(){return Promise.resolve(null)}
function loadProplineInsights(g){}
function drawer(g){var x='<div class="asProplineSection" id="asProplineInsights" hidden></div>'; loadProplineInsights(g);return x;}
function toggleSlip(){var key='x',g={sport:'MLB',playerName:'A',market:'Hits',marketId:'batter_hits',eventId:'1',playerId:'p'};slip.push({key:key,sport:g.sport,playerName:g.playerName,market:g.market,
   eventId:g.eventId,playerId:g.playerId,line:1.5,side:'OVER',price:-110,sportsbook:'x'});}
function renderSlip(){var host={innerHTML:''},count=slip.length,sized={};host.innerHTML='x'
   +(count?'<button class="asBtn" id="asSlipClear">Clear slip</button>':'')
  +'</div>';bindSlip();}
function bindSlip(){
 var clear=document.getElementById('asSlipClear');
 if(clear)clear.onclick=function(){};
}
})();`;
  const patched = patchProplineFullUi(source);
  assert.match(patched, /function loadProplineFull/);
  assert.match(patched, /Verified market intelligence/);
  assert.match(patched, /marketKey:g\.marketId\|\|g\.market/);
  assert.match(patched, /Get live SGP price/);
  assert.match(patched, /Exact outcome line history/);
  assert.match(patched, /g\.providerEventId\|\|g\.eventId/);
  assert.match(patched, /providerOutcomeId/);
  assert.equal(patchProplineFullUi(patched), patched);
  assert.doesNotThrow(() => new Function(patched));
});

test('invalid SGP input fails closed without an upstream request', async () => {
  assert.equal(await priceSameGameParlay('UNKNOWN', '123', { legs: [{ market: 'x', name: 'Over' }, { market: 'y', name: 'Under' }] }), null);
  assert.equal(await priceSameGameParlay('MLB', '123', { legs: [{ market: 'x', name: 'Over' }] }), null);
});
