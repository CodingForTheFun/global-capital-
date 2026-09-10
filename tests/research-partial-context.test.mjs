import test from 'node:test';
import assert from 'node:assert/strict';
import { researchPlayerProp } from '../lib/autoscout/research-service-v2.mjs';

test('injury context survives missing game history through the complete fallback pipeline', async () => {
  const oldFetch = globalThis.fetch;
  const keys = Object.fromEntries(['CLEARSPORTS_API_KEY','SPORTSDATAIO_API_KEY'].map(k=>[k,process.env[k]]));
  process.env.CLEARSPORTS_API_KEY = 'test-only';
  process.env.SPORTSDATAIO_API_KEY = 'unit-test-only';
  let calls = 0;
  globalThis.fetch = async url => {
    assert.ok(String(url).startsWith('https://api.clearsportsapi.com/'), 'research must never call the retired provider');
    calls++;
    const data = String(url).endsWith('/player-stats')
      ? [{player_id:'partial-1',full_name:'Partial Player',team_id:'nfl_lar',passing_yards_yds:0}]
      : String(url).endsWith('/injury-stats')
        ? [{full_name:'Partial Player',team_id:'nfl_lar',injury_status:'Questionable',description:'Ankle'}]
        : [];
    return new Response(JSON.stringify(data),{status:200});
  };
  try {
    const r = await researchPlayerProp({sport:'NFL',playerName:'Partial Player',team:'LAR',market:'Pass Yards',providerMarketKey:'player_pass_yds',line:200.5,side:'OVER'});
    assert.equal(r.available,false);
    assert.equal(r.context.injuryStatus,'Questionable');
    assert.equal(r.context.injuryDetail,'Ankle');
    assert.equal(r.context.seasonStat,0);
    assert.equal(r.context.projection ?? null,null);
    assert.equal(r.sections.gameLog,false);
    assert.equal(r.sections.seasonTotal,true);
    assert.equal(r.sections.context,true);
    assert.equal(calls,3,'game and season adapters share the cached responses');
  } finally {
    globalThis.fetch=oldFetch;
    for(const [k,v] of Object.entries(keys))if(v===undefined)delete process.env[k];else process.env[k]=v;
  }
});
