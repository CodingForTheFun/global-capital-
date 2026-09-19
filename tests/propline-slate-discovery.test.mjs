import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchBoard,__resetProplineProvider} from '../lib/autoscout/providers/propline.mjs';
import {__resetProplineClient,proplineNoteQuota} from '../lib/data-sources/propline/client.mjs';

// Synthetic fixtures only; no credentials, production database, or live requests.
test('full-slate discovery distinguishes unavailable data from a verified empty slate', async () => {
  const originalFetch=globalThis.fetch, oldKey=process.env.PROPLINE_API_KEY;
  __resetProplineProvider(); process.env.PROPLINE_API_KEY='synthetic-discovery-test';
  const at=new Date(Date.now()+3600000).toISOString();
  let discovery=[{id:'one',sport_key:'football_nfl',commence_time:at}], wrongSport=false, oddsCalls=0;
  const headers=()=>({'x-daily-limit':'250000','x-daily-remaining':'249000','x-daily-used':'1000','x-daily-reset':String(Math.floor((Date.now()+86400000)/1000))});
  globalThis.fetch=async url=>{
    if(new URL(url).pathname.endsWith('/events'))return new Response(JSON.stringify(discovery),{headers:headers()});
    oddsCalls++;
    return new Response(JSON.stringify({id:'one',sport_key:wrongSport?'basketball_wnba':'football_nfl',commence_time:at,bookmakers:[{key:'draftkings',markets:[{key:'player_pass_yds',outcomes:[{name:'Over',description:'Synthetic Quarterback',player_id:'fixture:1',point:200.5,price:-110}]}]}]}),{headers:headers()});
  };
  try {
    const options={fullSlate:true,force:true,requestBudget:10};
    const first=await fetchBoard('NFL',options);
    assert.equal(first.props.length,1);
    const originalTime=first.meta.fetchedAt;
    for(const invalid of [{},null,{events:'unavailable'},[null],[{id:'one',sport_key:'basketball_wnba'}]]) {
      __resetProplineClient(); discovery=invalid;
      const before=oddsCalls, failed=await fetchBoard('NFL',options);
      assert.equal(oddsCalls,before,'invalid discovery must not launch odds requests');
      assert.equal(failed.props.length,1,'invalid discovery is not an authoritative withdrawal');
      assert.equal(failed.meta.fetchedAt,originalTime);
      assert.equal(failed.meta.coverage.complete,false);
      assert.equal(failed.meta.refreshError,'PROPLINE_COVERAGE_INVALID_EVENTS');
    }
    __resetProplineClient(); discovery=[{id:'one',sport_key:'football_nfl',commence_time:at}]; wrongSport=true;
    const foreign=await fetchBoard('NFL',options);
    assert.equal(foreign.meta.coverage.failed,1);
    assert.equal(foreign.meta.coverage.retained,1);
    assert.equal(foreign.meta.fetchedAt,originalTime);
    assert.equal(foreign.meta.failures[0].code,'PROPLINE_COVERAGE_SPORT_MISMATCH');
    // Client cache reuse is not permission to re-age data after quota exhaustion.
    proplineNoteQuota(new Headers({...headers(),'x-daily-remaining':'0','x-daily-used':'250000'}));
    const before=oddsCalls, exhausted=await fetchBoard('NFL',options);
    assert.equal(oddsCalls,before);
    assert.equal(exhausted.meta.fetchedAt,originalTime);
    assert.equal(exhausted.meta.coverage.complete,false);
    assert.equal(exhausted.meta.refreshError,'PROPLINE_QUOTA_RESERVE');
    __resetProplineClient(); discovery=[]; wrongSport=false;
    const withdrawn=await fetchBoard('NFL',options);
    assert.equal(withdrawn.props.length,0);
    assert.equal(withdrawn.meta.coverage.complete,true);
    assert.equal(withdrawn.meta.coverage.eligible,0);
    const cached=await fetchBoard('NFL',{fullSlate:true,cacheOnly:true});
    assert.equal(cached.props.length,0,'cache-only cannot resurrect the withdrawn slate');
  } finally {
    globalThis.fetch=originalFetch;
    oldKey===undefined?delete process.env.PROPLINE_API_KEY:process.env.PROPLINE_API_KEY=oldKey;
    __resetProplineProvider();
  }
});
