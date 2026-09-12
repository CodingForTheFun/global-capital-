import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { marketCatalog, allocateMarkets, createCreditLedger, coverageWarning } from '../lib/autoscout/providers/odds-coverage.mjs';

// Network-free fixtures, not fabricated production rows or live verification.
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'autoscout-dfs-test-'));
process.env.DATA_DIR = temp;
process.env.THE_ODDS_API_KEY = 'fixture-only-do-not-use-live';
const { fetchBoard, theOddsApiProvider, projectedCreditsPerRefresh } = await import('../lib/autoscout/providers/the-odds-api.mjs');
const { writeCachedBoard, recordProviderRequest, snapshotDiagnostics } = await import('../lib/autoscout/runtime-store.mjs');
const originalFetch = globalThis.fetch;
const updated = '2026-09-11T20:00:00Z';
let sequence = 0;
function events(count) {
  const prefix = `fixture-${++sequence}-`;
  return Array.from({ length: count }, (_, i) => ({ id: prefix+i, commence_time: new Date(Date.now() + (i+1)*3600_000).toISOString(), home_team: `Fixture home ${i}`, away_team: `Fixture away ${i}` }));
}
function installFeed({ count = 4, keys = ['player_points','player_rebounds'], failIndex = -1, empty = false, quota = 20000, extraOutcomes = [] } = {}) {
  const list = events(count), calls = [];
  let cost = 0;
  globalThis.fetch = async url => {
    const u = new URL(url);
    assert.equal(u.hostname, 'api.the-odds-api.com');
    calls.push(u);
    const event = list.find(e => u.pathname.includes(e.id));
    let body, status = 200, charged = 0;
    if (u.pathname.endsWith('/events')) body = list;
    else if (u.pathname.endsWith('/markets')) {
      charged = 1;
      body = { id: event.id, bookmakers: empty ? [] : [
        { key: 'prizepicks', markets: keys.map(key => ({ key })) },
        { key: 'underdog', markets: keys.map(key => ({ key })) },
        { key: 'draftkings', markets: keys.map(key => ({ key })) },
      ] };
    } else if (u.pathname.endsWith('/odds')) {
      const markets = u.searchParams.get('markets').split(',');
      charged = markets.length * (u.searchParams.has('regions') ? u.searchParams.get('regions').split(',').length : Math.ceil(u.searchParams.get('bookmakers').split(',').length / 10));
      if (event.id === list[failIndex]?.id) { body = { message: 'Fixture event failure' }; status = 503; }
      else body = { ...event, bookmakers: ['prizepicks','underdog','draftkings'].map(key => ({ key, title: key, markets: markets.map(market => ({ key: market, last_update: updated, outcomes: [
        { name:'Over', description:'Fixture Player', point:0, price:-110, ...(key === 'underdog' ? { multiplier:1 } : {}) },
        { name:'Under', description:'Fixture Player', point:0, price:-110 },
        ...extraOutcomes,
      ] })) })) };
    } else throw new Error(`Unexpected fixture request ${u.pathname}`);
    cost += charged;
    return new Response(JSON.stringify(body), { status, headers: { 'content-type':'application/json', 'x-requests-last': String(charged), 'x-requests-remaining': String(quota-cost), 'x-requests-used':String(cost) } });
  };
  return { calls, list, get cost() { return cost; } };
}
function resetConfig() {
  for (const key of ['THE_ODDS_API_MAX_EVENTS','THE_ODDS_API_MAX_MARKETS_PER_EVENT','THE_ODDS_API_REGIONS','THE_ODDS_API_BOOKMAKERS','THE_ODDS_API_MAX_CREDITS_PER_REFRESH']) delete process.env[key];
  recordProviderRequest({ remaining:20000, used:0, cost:0 });
}

test('DFS coverage regression suite', async t => {
  await t.test('DFS-only market is prioritized above 30 popular sportsbook markets', () => {
    const popular = Array.from({length:30}, (_,i) => ({key:`player_common_${i}`}));
    const catalog = marketCatalog([{key:'draftkings', markets:popular},{key:'fanduel',markets:popular},{key:'prizepicks',markets:[{key:'player_dfs_only'}]}], key => key.startsWith('player_'));
    assert.equal(catalog.length,31);
    assert.equal(catalog[0].key,'player_dfs_only');
  });
  await t.test('round-robin budget spreads DFS slots across games before comparisons', () => {
    const catalogs = Array.from({length:4}, () => [{key:'dfs1',priority:true},{key:'dfs2',priority:true},{key:'other',priority:false}]);
    assert.deepEqual(allocateMarkets(catalogs,{credits:4}), [['dfs1'],['dfs1'],['dfs1'],['dfs1']]);
    assert.deepEqual(allocateMarkets(catalogs,{credits:2,billedRegions:2}), [['dfs1'],[],[],[]]);
  });
  await t.test('empty configured values use safe defaults, not one game', () => {
    resetConfig(); process.env.THE_ODDS_API_MAX_EVENTS = '';
    assert.equal(theOddsApiProvider.health().maxEvents,25);
    assert.equal(projectedCreditsPerRefresh().billedRegions,1);
    assert.equal(projectedCreditsPerRefresh().creditsPerRefresh,250);
  });
  await t.test('actual adapter loads beyond game two with exact platform lines and timestamps', async () => {
    resetConfig(); const feed = installFeed({count:6});
    const board = await fetchBoard('NBA',{force:true});
    assert.equal(board.data.events.length,6);
    assert.equal(board.meta.coverage.checkedEvents,6);
    assert.equal(board.meta.coverage.complete,true);
    assert.equal(board.meta.coverage.platforms.prizepicks.lineCount,24);
    assert.equal(board.meta.coverage.platforms.underdog.lineCount,24);
    assert.equal(board.meta.coverage.platforms.prizepicks.newestUpdate,updated);
    assert.equal(board.meta.coverage.platforms.underdog.propCount,12);
    assert.ok(board.props.some(p => p.providerEventId === feed.list[5].id));
    assert.ok(board.props.every(p => p.line === 0 && !('hitRates' in p)));
    for (const call of feed.calls.filter(c => !c.pathname.endsWith('/events'))) {
      assert.equal(call.searchParams.has('regions'),false);
      for (const key of ['prizepicks','underdog','draftkings','fanduel']) assert.ok(call.searchParams.get('bookmakers').split(',').includes(key));
    }
    assert.equal(feed.cost,18);
  });
  await t.test('shared board cache avoids additional provider calls', async () => {
    resetConfig(); const feed = installFeed();
    const first = await fetchBoard('WNBA',{force:true});
    const n = feed.calls.length;
    const second = await fetchBoard('WNBA');
    assert.equal(second.meta.cacheHit,true);
    assert.equal(feed.calls.length,n);
    assert.deepEqual(second.props,first.props);
  });
  await t.test('legacy two-game disk cache does not mask the new coverage policy', async () => {
    resetConfig(); const feed = installFeed({count:5});
    await writeCachedBoard('NFL',{props:[],meta:{maxEvents:2}},3600);
    const board = await fetchBoard('NFL');
    assert.equal(board.meta.coverage.checkedEvents,5);
    assert.equal(board.meta.cacheHit,false);
    assert.ok(feed.calls.length > 0);
  });
  await t.test('more than 25 distinct regular markets are collected when affordable', async () => {
    resetConfig(); const feed = installFeed({count:1,keys:Array.from({length:35},(_,i)=>`player_fixture_${i}`)});
    const board = await fetchBoard('MLB',{force:true});
    assert.equal(board.meta.marketKeys.length,35);
    assert.equal(board.meta.coverage.complete,true);
    assert.equal(feed.cost,36);
  });
  await t.test('explicit event limit is honored and partial coverage is exposed', async () => {
    resetConfig(); process.env.THE_ODDS_API_MAX_EVENTS='3'; installFeed({count:5});
    const board = await fetchBoard('NBA',{force:true});
    assert.equal(board.meta.coverage.availableEvents,5);
    assert.equal(board.meta.coverage.checkedEvents,3);
    assert.equal(board.meta.coverage.complete,false);
    assert.match(board.meta.warning,/Partial board coverage/);
    assert.ok(board.meta.coverage.reasons.includes('event_limit'));
  });
  await t.test('low refresh budget is never exceeded and later games get DFS coverage', async () => {
    resetConfig(); process.env.THE_ODDS_API_MAX_CREDITS_PER_REFRESH='9';
    const feed = installFeed({count:4,keys:['player_points','player_rebounds','player_assists']});
    const board = await fetchBoard('NBA',{force:true});
    assert.equal(feed.cost,9);
    assert.equal(board.meta.coverage.complete,false);
    assert.equal(new Set(board.props.map(p => p.providerEventId)).size,4);
    assert.ok(board.meta.coverage.reasons.includes('market_limit'));
  });
  await t.test('one failed event does not erase successful responses', async () => {
    resetConfig(); installFeed({count:4,failIndex:1});
    const board = await fetchBoard('NBA',{force:true});
    assert.equal(board.meta.coverage.checkedEvents,3);
    assert.equal(board.meta.coverage.complete,false);
    assert.ok(board.meta.coverage.reasons.includes('request_failed'));
    assert.equal(board.meta.coverage.platforms.prizepicks.lineCount,12);
  });
  await t.test('no lines is distinguished from a failed or incomplete board', async () => {
    resetConfig(); installFeed({empty:true,count:1});
    const board = await fetchBoard('NHL',{force:true});
    assert.equal(board.meta.coverage.complete,true);
    assert.equal(board.meta.coverage.platforms.underdog.status,'no_lines_returned');
    assert.match(board.meta.warning,/Underdog: no regular lines returned/);
  });
  await t.test('regular requests reject alternate markets, promos, missing values and non-default Underdog multipliers', async () => {
    resetConfig(); installFeed({count:1, keys:['player_points','player_points_alternate'],extraOutcomes:[
      {name:'Over',description:'Promo Fixture',point:1,isPromo:true},
      {name:'Over',description:'Missing Line Fixture',point:null},
      {name:'Over',description:'Multiplier Fixture',point:2,multiplier:1.5},
    ]});
    const board = await fetchBoard('NBA',{force:true});
    assert.ok(board.props.every(p => !p.isAlternate && p.marketId === 'player_points'));
    assert.ok(board.props.every(p => !['Promo Fixture','Missing Line Fixture'].includes(p.playerName)));
    assert.ok(!board.props.some(p => p.sportsbookKey === 'underdog' && p.playerName === 'Multiplier Fixture'));
    assert.ok(board.props.some(p => p.sportsbookKey === 'underdog' && p.line === 0));
  });
  await t.test('explicit region configuration remains respected', async () => {
    resetConfig(); process.env.THE_ODDS_API_REGIONS='us,us_dfs'; const feed = installFeed({count:1});
    const board = await fetchBoard('NBA',{force:true});
    assert.equal(board.meta.coverage.platforms.prizepicks.requested,true);
    assert.ok(feed.calls.filter(c=>c.pathname.endsWith('/odds')).every(c=>c.searchParams.get('regions')==='us,us_dfs'));
    assert.equal(feed.cost,5);
  });
  await t.test('a fully exhausted collection budget exposes an incomplete empty board, not fake coverage', async () => {
    resetConfig(); process.env.THE_ODDS_API_MAX_CREDITS_PER_REFRESH='1'; installFeed({count:3});
    const board=await fetchBoard('NCAAB',{force:true});
    assert.equal(board.props.length,0);
    assert.equal(board.meta.coverage.complete,false);
    assert.equal(board.meta.coverage.platforms.prizepicks.status,'incomplete');
    assert.match(board.meta.warning,/Partial board coverage/);
  });
  await t.test('explicit source exclusion is labelled and unsolicited books are not ingested', async () => {
    resetConfig(); process.env.THE_ODDS_API_BOOKMAKERS='draftkings'; installFeed({count:1});
    const board=await fetchBoard('NCAAF',{force:true});
    assert.ok(board.props.every(p=>p.sportsbookKey==='draftkings'));
    assert.equal(board.meta.coverage.platforms.prizepicks.status,'not_requested');
    assert.match(board.meta.warning,/PrizePicks is not included/);
  });
  await t.test('missing quota headers do not become zero remaining credits', () => {
    recordProviderRequest({remaining:500,used:100,cost:1});
    recordProviderRequest({remaining:null,used:null,cost:null});
    assert.equal(snapshotDiagnostics().quota.remaining,500);
    assert.equal(snapshotDiagnostics().quota.used,100);
  });
  await t.test('ledger prevents concurrent overspend and preserves unknown vs zero quota', async () => {
    let remaining = 3; const create = createCreditLedger(()=>remaining);
    const a = create(10), b = create(10);
    let done;
    const pending = a.run(2,()=>new Promise(resolve=>{done=resolve;}));
    await assert.rejects(b.run(2,()=>null),{code:'COVERAGE_BUDGET'});
    remaining=1; done(); await pending;
    await b.run(1,async()=>{});
    const zero=createCreditLedger(()=>0)(5);
    await assert.rejects(zero.run(1,()=>null),{code:'COVERAGE_BUDGET'});
    const unknown=createCreditLedger(()=>null)(5);
    await unknown.run(5,async()=>{});
    await assert.rejects(unknown.run(1,()=>null),{code:'COVERAGE_BUDGET'});
  });
  await t.test('stale fallback is labelled and original timestamps are retained', async () => {
    resetConfig(); installFeed({count:1});
    const good=await fetchBoard('NBA',{force:true});
    globalThis.fetch=async()=>{throw new Error('Fixture network outage');};
    const stale=await fetchBoard('NBA',{force:true});
    assert.equal(stale.meta.stale,true);
    assert.equal(stale.meta.fetchedAt,good.meta.fetchedAt);
    assert.deepEqual(stale.props,good.props);
  });
}).finally(async () => {
  globalThis.fetch=originalFetch;
  // Diagnostic persistence is asynchronous; removal after it settles is only
  // test cleanup and never changes production DATA_DIR.
  await new Promise(resolve=>setTimeout(resolve,100));
  await fs.rm(temp,{recursive:true,force:true});
});
