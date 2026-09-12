import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizePublicGameLog, resolvePublicAthlete, createPublicBasketballResearch } from '../lib/data-sources/espn/research.mjs';
import { finalizeResearch } from '../lib/autoscout/research-service.mjs';
import { researchPlayerProp } from '../lib/autoscout/research-service-v2.mjs';
import { sanitizePublicPayload } from '../lib/public-sanitize.mjs';
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/espn-${name}.json`, import.meta.url)));
const options = { sport:'WNBA', playerName:'Caitlin Clark', team:'IND', market:'Assists', providerMarketKey:'player_assists', games:15 };

test('captured NBA and WNBA schemas use named stats despite different column orders', () => {
  const nba = normalizePublicGameLog(fixture('nba-gamelog'), {sport:'NBA',market:'Assists'});
  const wnba = normalizePublicGameLog(fixture('wnba-gamelog'), options);
  assert.equal(nba[0].value,7); assert.equal(nba[0].points,12);
  assert.equal(wnba[0].value,12); assert.equal(wnba[0].points,34);
  assert.equal(wnba[0].threes,6); assert.equal(wnba[0].blocks,0);
  const combo = normalizePublicGameLog(fixture('wnba-gamelog'), {...options,providerMarketKey:'player_points_rebounds_assists'});
  assert.equal(combo[0].value,51);
  assert.deepEqual(normalizePublicGameLog(fixture('wnba-gamelog'), {...options,providerMarketKey:'player_assists_q1'}),[]);
  assert.deepEqual(normalizePublicGameLog(fixture('wnba-gamelog'), {...options,providerMarketKey:'player_fantasy_points'}),[]);
});

test('unknown values, DNP, future/live games, preseason, All-Star and duplicates are excluded', () => {
  for(const mutate of [
    (d,e,r)=>{r.stats[d.names.indexOf('assists')]='';},
    (d,e,r)=>{r.stats[d.names.indexOf('assists')]=null;},
    (d,e,r)=>{r.stats[d.names.indexOf('minutes')]='DNP';},
    (d,e)=>{e.gameDate='2099-01-01';},
    (d,e)=>{e.status={type:{completed:false}};},
    (d,e)=>{e.gameResult='';},
    (d,e)=>{e.team.isAllStar=true;},
    (d,e)=>{e.leagueAbbreviation='NBA';},
    (d,e,r)=>{r.stats.pop();},
  ]) {
    const d=fixture('wnba-gamelog'), r=d.seasonTypes[0].categories[0].events[0],e=d.events[r.eventId];
    mutate(d,e,r);
    assert.ok(!normalizePublicGameLog(d,options).some(row=>row.gameId===`wnba:${r.eventId}`));
  }
  const d=fixture('wnba-gamelog'), before=normalizePublicGameLog(d,options);
  d.seasonTypes.push({...structuredClone(d.seasonTypes[0]),displayName:'2026 Preseason'});
  d.seasonTypes[0].categories.push(structuredClone(d.seasonTypes[0].categories[0]));
  assert.deepEqual(normalizePublicGameLog(d,options),before);
  const r=d.seasonTypes[0].categories[0].events[0];
  r.stats[d.names.indexOf('assists')]='0';
  assert.equal(normalizePublicGameLog(d,options)[0].value,0);
});

test('search matches exact normalized name and league, refuses ambiguous or truncated results', () => {
  const search=fixture('player-search');
  assert.equal(resolvePublicAthlete(search,options).id,'4433403');
  assert.equal(resolvePublicAthlete(search,{...options,sport:'NBA'}),null);
  assert.equal(resolvePublicAthlete(search,{...options,playerName:'Caitlin'}),null);
  search.results[0].totalFound=2;
  assert.equal(resolvePublicAthlete(search,options),null);
  const duplicate=structuredClone(search.results[0].contents[0]);
  duplicate.uid='s:40~l:59~a:999'; duplicate.link.web='https://www.espn.com/wnba/player/_/id/999/caitlin-clark';
  search.results[0].contents.push(duplicate);
  assert.equal(resolvePublicAthlete(search,options),null);
});

test('line and market changes reuse cached identity/history; mismatched team fails closed', async () => {
  let calls=0;
  const provider=createPublicBasketballResearch({fetchImpl:async(url,init)=>{
    calls++; assert.equal(init.headers.authorization,undefined);
    return new Response(JSON.stringify(fixture(url.includes('/search/')?'player-search':'wnba-gamelog')));
  }});
  const [a,b]=await Promise.all([provider(options),provider({...options,market:'Points',providerMarketKey:'player_points'})]);
  assert.equal(a.available,true);assert.equal(b.gameLog[0].value,34);assert.equal(calls,2);
  await provider({...options,line:7.5,side:'UNDER'});assert.equal(calls,2);
  assert.equal((await provider({...options,homeTeam:'Indiana Fever',awayTeam:'Connecticut Sun'})).opponent,'CON');
  assert.equal((await provider({...options,team:'LVA'})).code,'PLAYER_TEAM_MISMATCH');
});

test('rate limiting pauses further upstream requests and failure stays unavailable', async () => {
  let calls=0;
  const provider=createPublicBasketballResearch({fetchImpl:async()=>{calls++;return new Response('',{status:429});}});
  assert.equal((await provider(options)).available,false);
  assert.equal((await provider({...options,playerName:'Another Player'})).available,false);
  assert.equal(calls,1);
});

test('real captured games flow through shared windows, pushes and public API shape', async () => {
  const oldFetch=globalThis.fetch, oldKey=process.env.CLEARSPORTS_API_KEY;
  delete process.env.CLEARSPORTS_API_KEY;
  globalThis.fetch=async url=>new Response(JSON.stringify(fixture(String(url).includes('/search/')?'player-search':'wnba-gamelog')));
  try {
    const result=await researchPlayerProp({...options,line:8,side:'OVER',opponent:'Connecticut Sun'});
    assert.equal(result.available,true);assert.equal(result.sections.gameLog,true);
    assert.equal(result.gameLog.length,15);
    assert.equal(result.windows.l5.games,5);assert.equal(result.windows.l10.games,10);assert.equal(result.windows.l15.games,15);
    assert.equal(result.windows.l10.pushes,1);
    assert.equal(result.windows.l10.hitRate,70); // Requested policy: 7 hits / 10 eligible games, including one push.
    assert.equal(result.coverage.seasonComplete,true);assert.equal(result.windows.season.games,result.gameLog.length);
    assert.equal(result.sections.projection,false);
    assert.equal(result.matchup.opponent,'CON');assert.ok(result.h2h.games>0);
    const under=finalizeResearch({...result,line:8,side:'UNDER'});
    assert.equal(under.windows.l10.hitRate,20);assert.equal(under.windows.l10.pushes,1);
    assert.doesNotMatch(JSON.stringify(sanitizePublicPayload(result,{statsContext:true})),/espn|apikey|authorization|endpoint/i);
  } finally {globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.CLEARSPORTS_API_KEY;else process.env.CLEARSPORTS_API_KEY=oldKey;}
});
