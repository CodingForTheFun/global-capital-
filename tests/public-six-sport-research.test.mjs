import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPublicResearch, normalizePublicGameLog, resolvePublicAthlete } from '../lib/data-sources/espn/research.mjs';
import { finalizeResearch } from '../lib/autoscout/research-service.mjs';
import { analyzeResearch, researchOpponentMatches } from '../lib/analytics/research.mjs';
const fixture=name=>JSON.parse(readFileSync(new URL(`./fixtures/espn-${name}.json`,import.meta.url)));

test('NFL regular and postseason logs retain attempts, negative rushing yards, dates and scores without minutes',()=>{
  const d=fixture('nfl-gamelog');
  const rows=normalizePublicGameLog(d,{sport:'NFL',market:'Pass Attempts',providerMarketKey:'player_pass_attempts'});
  assert.equal(rows.length,17);assert.equal(rows[0].value,33);assert.equal(rows[0].seasonType,3);
  assert.equal(rows[0].gameResult,'L');assert.equal(rows[0].scoreFor,6);assert.equal(rows[0].scoreAgainst,30);
  assert.equal(rows[0].opponentId,'NFL:34');assert.equal(rows[0].started,null);
  const rush=normalizePublicGameLog(d,{sport:'NFL',market:'Rush Yards'});
  assert.ok(rush.some(row=>row.value===-1));assert.ok(rush.some(row=>row.value===0));
  const numbered=structuredClone(d);numbered.seasonTypes[0].displayName='';numbered.seasonTypes[0].seasonType=3;
  assert.equal(normalizePublicGameLog(numbered,{sport:'NFL',market:'Pass Attempts'}).length,17);
});

test('MLB separates batting/pitching, derives total bases with complete components and retains full logs',()=>{
  const batting=fixture('mlb-gamelog'), pitching=fixture('mlb-pitching-gamelog');
  const hits=normalizePublicGameLog(batting,{sport:'MLB',market:'Hits',providerMarketKey:'batter_hits'});
  assert.equal(hits.length,130);assert.equal(hits[0].value,0);
  const bases=normalizePublicGameLog(batting,{sport:'MLB',market:'Total Bases',providerMarketKey:'batter_total_bases'});
  assert.equal(bases.length,130);
  for(const row of bases)assert.equal(row.value,row.hits+row.doubles+2*row.triples+3*row.homeRuns);
  const so=normalizePublicGameLog(pitching,{sport:'MLB',market:'Strikeouts',providerMarketKey:'pitcher_strikeouts'});
  assert.equal(so[0].value,9);assert.equal(so[0].hitsAllowed,7);assert.equal(so[0].hits,null);
  assert.deepEqual(normalizePublicGameLog(batting,{sport:'MLB',market:'Strikeouts',providerMarketKey:'pitcher_strikeouts'}),[]);
});

test('NHL parses named shots and time on ice; NCAAF uses the college-football identity',()=>{
  const nhl=normalizePublicGameLog(fixture('nhl-gamelog'),{sport:'NHL',market:'Shots on Goal',providerMarketKey:'player_shots_on_goal'});
  assert.equal(nhl.length,88);assert.equal(nhl[0].value,3);assert.ok(nhl[0].minutes>24);
  const college=normalizePublicGameLog(fixture('ncaaf-gamelog'),{sport:'NCAAF',market:'Pass Yards'});
  assert.equal(college[0].value,305);assert.equal(college[0].season,'2026');
  assert.equal(resolvePublicAthlete(fixture('ncaaf-search'),{sport:'NCAAF',playerName:'Arch Manning'}).id,'4870906');
  assert.equal(resolvePublicAthlete(fixture('ncaaf-search'),{sport:'NFL',playerName:'Arch Manning'}),null);
});

test('full-season card stays separate from recent windows, prior seasons and opponent aliases',async()=>{
  let calls=0;
  const fetcher=createPublicResearch({fetchImpl:async url=>{
    calls++;return new Response(JSON.stringify(fixture(url.includes('/search/')?'mlb-search':'mlb-gamelog')));
  }});
  const p={sport:'MLB',playerName:'Shohei Ohtani',market:'Hits',providerMarketKey:'batter_hits',line:1,side:'OVER',games:20,opponent:'Cincinnati Reds'};
  const history=await fetcher(p);
  assert.equal(history.gameLog.length,130);assert.equal(history.coverage.seasonComplete,true);
  const base=finalizeResearch({...p,...history});
  assert.equal(base.windows.season.games,130);assert.equal(base.windows.l20.games,20);
  assert.equal(base.matchup.opponentId,'MLB:17');assert.ok(base.h2h.games>0);
  const withOlder=analyzeResearch({...base,gameLog:[...base.gameLog,{gameId:'old',date:'2025-01-01',season:'2025',value:999,opponentId:'MLB:17'}]},1);
  assert.equal(withOlder.windows.season.games,130);assert.equal(withOlder.windows.season.average,base.windows.season.average);
  assert.equal(withOlder.h2h.games,base.h2h.games+1);
  const zero=analyzeResearch({...base,matchup:{opponent:'Unknown Club',opponentId:'MLB:999'}},1);
  assert.equal(zero.h2h.games,0);assert.equal(zero.h2h.hitRate,null);
  assert.equal(researchOpponentMatches({opponent:'CIN',opponentId:'MLB:99'},base.matchup),false);
  const home=analyzeResearch(base,1,'UNDER','home');
  assert.equal(home.windows.season.games,base.gameLog.filter(r=>r.isHome).length);
  await fetcher({...p,line:2,side:'UNDER'});assert.equal(calls,3); // cached league season is shared across markets
});

test('a missing current-season event prevents a false complete-season claim',async()=>{
  const d=fixture('mlb-gamelog');delete d.events[Object.keys(d.events)[0]];
  const fetcher=createPublicResearch({fetchImpl:async url=>new Response(JSON.stringify(url.includes('/search/')?fixture('mlb-search'):d))});
  assert.equal((await fetcher({sport:'MLB',playerName:'Shohei Ohtani',market:'Hits'})).coverage.seasonComplete,false);
});
