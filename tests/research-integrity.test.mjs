import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeResearch, researchSections, researchTeamMatches } from '../lib/analytics/research.mjs';
import { evaluatePropAgainstFilters } from '../lib/filters/index.mjs';
import { createClearSportsClient } from '../lib/data-sources/clearsports/client.mjs';
import { detailedGameLog } from '../lib/autoscout/research-service.mjs';

const base = { season: 2026, matchup: { opponent: 'BOS' }, gameLog: [
  {gameId:'3',date:'2026-09-03',value:'25',opponent:'BOS',isHome:true},
  {gameId:'2',date:'2026-09-02',value:20,opponent:null,isHome:false},
  {gameId:'1',date:'2026-09-01',value:30,opponent:'BOS',isHome:true},
] };
test('fallback game logs exclude future, unfinished and did-not-play records', () => {
  const row = { GameID: 1, DateTime: '2025-01-01T12:00:00Z', Points: 0, Status: 'Final' };
  const result = detailedGameLog('NBA', 'Points', [row,
    { ...row, GameID: 2, Status: 'InProgress' }, { ...row, GameID: 3, DateTime: '2999-01-01' },
    { ...row, GameID: 4, DidNotPlay: true }, { ...row, GameID: 5, IsGameOver: false },
    { ...row, GameID: 6, Points: null }, { ...row, GameID: 7, DateTime: null }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].value, 0);
});
test('partial logs never masquerade as a full season; zero is a real result', () => {
  const r=analyzeResearch(base,25,'OVER');
  assert.equal(r.windows.season.hitRate,null);
  assert.equal(r.windows.l5.hitRate,50);
  assert.equal(r.windows.l5.pushes,1);
  assert.equal(r.h2h.games,2);
  assert.equal(r.gameLog[0].hit,null);
  assert.equal(analyzeResearch({...base,coverage:{seasonComplete:true}},25,'OVER').windows.season.hitRate,50);
  assert.equal(analyzeResearch({gameLog:[{value:0}]},1,'UNDER').windows.l5.hitRate,100);
});
test('venue filtering recalculates the same sample for cards and charts', () => {
  const r=analyzeResearch(base,25,'UNDER','home');
  assert.equal(r.gameLog.length,2);assert.equal(r.windows.l5.games,2);
  assert.equal(r.windows.l5.hitRate,0);assert.equal(r.windows.l5.pushes,1);
  assert.equal(analyzeResearch(base,null,'OVER').windows.l5.hitRate,null);
});
test('unknown opponents cannot become H2H matches; duplicate games are ignored', () => {
  assert.equal(researchTeamMatches(null,'BOS'),false);
  assert.equal(researchTeamMatches('NBA_BOS','BOS'),true);
  assert.equal(researchTeamMatches('LA','LAL'),false);
  assert.equal(analyzeResearch({...base,gameLog:[...base.gameLog,base.gameLog[0]]},25).gameLog.length,3);
});
test('available season context survives unavailable game history', () => {
  assert.deepEqual(researchSections({available:false,context:{seasonStat:0}}),{gameLog:false,seasonTotal:true,seasonAverage:false,projection:false,context:true});
});
test('explicit research thresholds fail closed, and book and side filters combine', () => {
  const prop={sport:'NFL',side:'UNDER',sportsbookKey:'draftkings',hitRates:{l5:null,l10:90}};
  assert.equal(evaluatePropAgainstFilters(prop,{researchThresholds:{l5:70}}).matchesFilters,false);
  assert.equal(evaluatePropAgainstFilters(prop,{researchThresholds:{l10:80},bookmakers:['draftkings'],side:'UNDER'}).matchesFilters,true);
  assert.equal(evaluatePropAgainstFilters(prop,{researchThresholds:{l10:80},side:'OVER'}).matchesFilters,false);
});
test('unavailable provider results are cached to prevent repeated quota failures', async () => {
  const previousKey=process.env.CLEARSPORTS_API_KEY,previousFetch=globalThis.fetch;
  process.env.CLEARSPORTS_API_KEY='unit-test-only';let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response('{}',{status:403});};
  try{const client=createClearSportsClient();await client.get('/nfl/player-stats');const r=await client.get('/nfl/player-stats');assert.equal(calls,1);assert.equal(r.ok,false);assert.equal(r.cached,true);}
  finally{globalThis.fetch=previousFetch;if(previousKey===undefined)delete process.env.CLEARSPORTS_API_KEY;else process.env.CLEARSPORTS_API_KEY=previousKey;}
});
