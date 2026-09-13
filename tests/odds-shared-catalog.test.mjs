import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('regular and alternate boards share discovery without sharing line filters', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'odds-catalog-'));
  process.env.DATA_DIR = dir;
  process.env.THE_ODDS_API_KEY = 'mock-not-live';
  process.env.THE_ODDS_API_REQUEST_SPACING_MS = '100';
  const nativeFetch = globalThis.fetch, nativeNow = Date.now;
  let clock = nativeNow(), onlyAlternates = false;
  Date.now = () => clock;
  const calls = [];
  const event = {id:'catalog-fixture', commence_time:'2099-01-01T00:00:00Z', home_team:'Home', away_team:'Away'};
  globalThis.fetch = async input => {
    const url = new URL(input);
    assert.equal(url.hostname, 'api.the-odds-api.com');
    calls.push({path:url.pathname, markets:url.searchParams.get('markets')});
    if (url.pathname.endsWith('/events')) return Response.json([event]);
    if (url.pathname.endsWith('/markets')) return Response.json({bookmakers:[{key:'draftkings', markets:
      (onlyAlternates ? ['player_points_alternate'] : ['player_points','player_points_alternate']).map(key=>({key}))}]});
    return Response.json({...event, bookmakers:[{key:'draftkings',title:'DraftKings',markets:
      url.searchParams.get('markets').split(',').map(key=>({key,last_update:'2026-09-13T12:00:00Z',outcomes:[
        {name:'Over',description:'Fixture Player',point:key.endsWith('_alternate')?7.5:5.5,price:-110},
        {name:'Under',description:'Fixture Player',point:key.endsWith('_alternate')?7.5:5.5,price:-105},
      ]}))}]});
  };
  const discoveries = () => calls.filter(row=>row.path.endsWith('/markets')).length;
  try {
    const {fetchBoard} = await import('../lib/autoscout/providers/the-odds-api.mjs');
    await t.test('sequential views spend one discovery request and preserve main lines', async () => {
      const main = await fetchBoard('NBA', {force:true});
      const alt = await fetchBoard('NBA', {force:true,includeAlternates:true});
      assert.equal(discoveries(), 1);
      assert.deepEqual(main.props.map(p=>[p.line,p.price]), [[5.5,-110],[5.5,-105]]);
      assert.ok(main.props.every(p=>!p.isAlternate));
      assert.ok(alt.props.some(p=>p.isAlternate && p.line===7.5));
      const before = calls.length;
      await fetchBoard('NBA');
      assert.equal(calls.length, before, 'customer cache hits do not call upstream');
    });
    await t.test('simultaneous view refreshes share catalog but retain separate price requests', async () => {
      calls.length = 0;
      const boards = await Promise.all([fetchBoard('WNBA',{force:true}),fetchBoard('WNBA',{force:true,includeAlternates:true})]);
      assert.equal(discoveries(), 1);
      assert.equal(calls.filter(row=>row.path.endsWith('/odds')).length, 2);
      assert.ok(boards[0].props.every(p=>!p.isAlternate));
      assert.ok(boards[1].props.some(p=>p.isAlternate));
    });
    await t.test('an alternate-only catalog does not freeze newly posted main markets for 30 minutes', async () => {
      calls.length = 0; onlyAlternates = true;
      const alt = await fetchBoard('NHL',{force:true,includeAlternates:true});
      assert.ok(alt.props.length);
      const empty = await fetchBoard('NHL',{force:true});
      assert.equal(empty.props.length, 0);
      assert.equal(discoveries(), 1);
      clock += 301000; onlyAlternates = false;
      const revived = await fetchBoard('NHL',{force:true});
      assert.equal(discoveries(), 2);
      assert.equal(revived.props.length, 2);
      assert.ok(revived.props.every(p=>!p.isAlternate));
    });
  } finally {
    globalThis.fetch = nativeFetch; Date.now = nativeNow;
    await new Promise(resolve=>setTimeout(resolve,100));
    await fs.rm(dir,{recursive:true,force:true});
  }
});
