import test from 'node:test';
import assert from 'node:assert/strict';
import { researchPlayerProp } from '../lib/autoscout/research-service-v2.mjs';

test('six supported leagues never fall back to paid statistics, even with configured keys', async () => {
  const oldFetch=globalThis.fetch;
  const keys=Object.fromEntries(['CLEARSPORTS_API_KEY','SPORTSDATAIO_API_KEY'].map(k=>[k,process.env[k]]));
  process.env.CLEARSPORTS_API_KEY='test-only';process.env.SPORTSDATAIO_API_KEY='test-only';
  let calls=0;
  globalThis.fetch=async url=>{
    assert.ok(String(url).startsWith('https://site.web.api.espn.com/'));
    calls++;return new Response(JSON.stringify({results:[]}));
  };
  try {
    for(const [sport,market]of [['NFL','Pass Yards'],['NBA','Points'],['WNBA','Points'],['MLB','Hits'],['NHL','Goals'],['NCAAF','Pass Yards']]){
      const r=await researchPlayerProp({sport,market,playerName:`Missing ${sport}`,line:5});
      assert.equal(r.available,false);assert.equal(r.sections.gameLog,false);assert.equal(r.sections.projection,false);
    }
    assert.equal(calls,6);
  } finally {
    globalThis.fetch=oldFetch;
    for(const [k,v]of Object.entries(keys))if(v===undefined)delete process.env[k];else process.env[k]=v;
  }
});
