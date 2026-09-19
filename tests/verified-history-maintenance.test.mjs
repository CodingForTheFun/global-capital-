import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildHistoryPlan, historyName, historyKey, runHistoryMaintenance, verifyPublicRows, createHistoryTransport } from '../lib/diagnostics/verified-history-maintenance.mjs';
import { parseHistoryArgs, createHistoryRpc } from '../scripts/verified-history-maintenance.mjs';

// Synthetic unit fixtures only. Never exported as production history.
const NOW = Date.parse('2026-09-18T20:00:00Z');
const leagues = Object.fromEntries(['NFL','MLB','NBA','WNBA','NCAAF','NHL','NCAAB','MLS','EPL','UCL','SOCCER'].map(s=>[s,true]));
const adapters = { publicLeagues:leagues, canonicalSport:s=>({CFB:'NCAAF',CBB:'NCAAB'}[s]||s),
  marketContract:c=>c.market==='Unsupported' ? null : {entityType:'player',category:c.market==='Pitching'?'pitching':null} };
const context = (sport='NFL',playerName='Fixture Player', extra={}) => ({sport,playerName,team:'LV',period:'game',market:'Passing Yards',entityType:'player',...extra});
const snapshot = (active=[context()],history=[]) => ({asOf:new Date(NOW).toISOString(),active,history,truncated:false});
const plan = (active,history) => buildHistoryPlan(snapshot(active,history),adapters);
function row(sport='NFL',id='1',game='10') {
  const date='2026-09-14T20:00:00.000Z';
  return {player_id:`history:${sport}:${id}`,game_id:`${sport.toLowerCase()}:${game}`,sport,player_name:'Fixture Player',game_date:date,
    season:'2026',category:sport==='MLB'?'batting':'general',season_type:2,
    stats:{gameId:`${sport.toLowerCase()}:${game}`,date,season:'2026',seasonType:2,teamId:`${sport}:1`,opponentId:`${sport}:2`,
      scoreFor:21,scoreAgainst:10,gameResult:'W',value:101,passingYards:101,minutes:24,statKind:'PassingYards'}};
}
const result = (sport='NFL',rows=[row(sport)]) => ({available:true,entityType:'player',player:{providerPlayerId:`history:${sport}:1`,playerName:'Fixture Player'},rows});
const dependencies = () => ({fetchResearch:async p=>result(p.sport),mapRows:r=>r.rows,now:()=>NOW});

for (const [a,b] of [["P.J. Fixture Jr.",'PJ Fixture'],['Fixture-Surname III','Fixture Surname'],["D’Angelo Fixture",'DAngelo Fixture'],['Jóse Fixture Sr.','Jose Fixture']]) {
  test(`candidate normalization: ${a}`,()=>assert.equal(historyName(a),historyName(b)));
}
test('only trailing suffix tokens are stripped, not words inside names',()=>{
  assert.equal(historyName('Jr Fixture'),'jr fixture');
  assert.equal(historyName('Oliver'),'oliver');
  assert.notEqual(historyName('Fixture One'),historyName('Fixture Other'));
});
test('reject malformed or explicitly truncated snapshots',()=>{
  assert.throws(()=>buildHistoryPlan({...snapshot(),truncated:true},adapters));
  assert.throws(()=>buildHistoryPlan({...snapshot(),history:null},adapters));
  assert.throws(()=>buildHistoryPlan({...snapshot(),asOf:'invalid'},adapters));
});
test('books and lines do not multiply the player denominator',()=>{
  const p=plan([context(),context('NFL','Fixture Player',{market:'Receptions'}),context('NFL','Another Player')]);
  assert.equal(p.totalPlayers,2); assert.equal(p.players.find(p=>p.playerName==='Fixture Player').choices.length,2);
});
test('same name in another sport cannot satisfy NFL history',()=>{
  const p=plan([context()],[{sport:'NBA',player_id:'history:NBA:1',player_name:'Fixture Player',games:1}]);
  assert.equal(p.players[0].nameMatchCount,0);
});
test('ambiguous stored names are counted, not selected as an identity',()=>{
  const h=[1,2].map(id=>({sport:'NFL',player_id:`history:NFL:${id}`,player_name:'Fixture Player',games:1}));
  const p=plan([context()],h); assert.equal(p.players[0].nameMatchCount,2); assert.equal(p.players[0].status,'PENDING_PUBLIC_VERIFICATION');
});
test('wrong namespaces never count as stored name matches',()=>{
  assert.equal(plan([context()],[{sport:'NFL',player_id:'123',player_name:'Fixture Player',games:8}]).players[0].nameMatchCount,0);
});
test('all 38 production-observed labels are accounted for, including unsupported ones',async()=>{
  const labels='AFL|BANANA BALL|CFB1H|CFL|CRICKET|CS|CS2|DOTA|DOTA2|EPL|EUROGOLF|F1SZN|FIFA|KBO|LA LIGA|LAX|LOL|MLB|MMA|NBA|NBASZN|NCAAF|NFL|NFL1H|NFL1Q|NHLSZN|NPB|PGA|R6|RL|SOCCER|TENNIS|TT|UFC|VAL|WNBA|WNBA1H|WNBA1Q'.split('|');
  const p=plan(labels.map(s=>context(s))); const r=await runHistoryMaintenance(p);
  assert.equal(r.totalPlayers,38); assert.equal(r.outcomes.length,38); assert.equal(r.sports.length,38);
  assert.equal(r.outcomes.find(o=>o.sport==='CS2').status,'UNSUPPORTED_PUBLIC_SPORT');
  assert.equal(r.outcomes.find(o=>o.sport==='NFL1H').status,'UNSUPPORTED_PERIOD_SCOPE');
  assert.equal(r.outcomes.find(o=>o.sport==='NBASZN').status,'UNSUPPORTED_SEASON_SCOPE');
});
for (const c of [context('NFL1Q'),context('NFL','Fixture Player',{period:'1h'}),context('NFL','Fixture Player',{entityType:'team'}),context('NFL','Fixture One + Fixture Two'),context('NFL','Fixture Player',{market:'Unsupported'})]) {
  test(`ineligible context never calls a provider: ${JSON.stringify(c)}`,async()=>{
    let calls=0; const r=await runHistoryMaintenance(plan([c]),{mode:'probe',...dependencies(),fetchResearch:async()=>{calls++;}});
    assert.equal(calls,0); assert.equal(r.totalPlayers,1);
  });
}
test('audit is read-only and makes zero public requests',async()=>{
  const forbidden=()=>{throw Error('must not execute');};
  const r=await runHistoryMaintenance(plan(),{fetchResearch:forbidden,readRows:forbidden,insertRows:forbidden});
  assert.equal(r.mode,'audit');assert.equal(r.attemptedPlayers,0);assert.equal(r.insertedRows,0);
});
test('apply requires the reviewed cohort hash before any side effect',async()=>{
  await assert.rejects(runHistoryMaintenance(plan(),{mode:'apply',...dependencies()}),/APPROVAL/);
});
test('probe verifies completed games but makes no writes or durability claim',async()=>{
  const r=await runHistoryMaintenance(plan(),{mode:'probe',...dependencies(),insertRows:()=>{throw Error('no');}});
  assert.equal(r.outcomes[0].status,'VERIFIED_BACKFILL_READY');assert.equal(r.outcomes[0].durableVerified,false);
  assert.equal(r.insertedRows,0);assert.equal(r.sports[0].completeSeasonCoveragePct,null);
});
for (const [name,mutate] of [
  ['cross-sport player',r=>r.player_id='history:NBA:1'],['cross-sport game',r=>r.game_id='nba:10'],
  ['future',r=>{r.game_date='2027-01-01T00:00:00Z';r.stats.date=r.game_date;}],
  ['preseason',r=>{r.season_type=1;r.stats.seasonType=1;}],['DNP',r=>r.stats.didNotPlay=true],
  ['inactive',r=>r.stats.active=false],['missing statistic',r=>delete r.stats.value],
  ['score disagreement',r=>r.stats.gameResult='L'],['same opponent',r=>r.stats.opponentId=r.stats.teamId],
  ['unknown season',r=>r.season=null],['period',r=>r.stats.period='1q'],['wrong category',r=>r.category='batting'],
]) test(`reject ${name} evidence`,()=>{const r=row();mutate(r);assert.equal(verifyPublicRows(result('NFL',[r]),context(),[r],NOW),false);});
test('basketball zero minutes cannot become a played game',()=>{
  const r=row('WNBA');r.stats.minutes=0;assert.equal(verifyPublicRows(result('WNBA',[r]),context('WNBA'),[r],NOW),false);
});
test('wrong provider-pinned ID cannot be rescued by a name',()=>{
  assert.equal(verifyPublicRows(result(),context('NFL','Fixture Player',{providerPlayerId:'history:NFL:999'}),[row()],NOW),false);
});
test('zero real stat is retained; missing is not manufactured as zero',()=>{
  const r=row();r.stats.value=0;assert.equal(verifyPublicRows(result('NFL',[r]),context(),[r],NOW),true);
});
test('insert-only write requires exact read-back and is idempotent',async()=>{
  const store=new Map(),p=plan();let writes=0;
  const deps={mode:'apply',approveSnapshot:p.cohortHash,...dependencies(),readRows:async keys=>keys.map(k=>store.get(historyKey(k))).filter(Boolean),
    insertRows:async rows=>{writes++;let n=0;for(const r of rows)if(!store.has(historyKey(r))){store.set(historyKey(r),structuredClone(r));n++;}return {written:n};}};
  const first=await runHistoryMaintenance(p,deps);assert.equal(first.insertedRows,1);assert.equal(first.outcomes[0].durableVerified,true);
  const second=await runHistoryMaintenance(p,deps);assert.equal(second.insertedRows,0);assert.equal(writes,1);
  assert.equal(second.outcomes[0].status,'ALREADY_PERSISTED_AND_VERIFIED');
});
test('failed read-back stops later writes and never claims persistence',async()=>{
  const p=plan([context(),context('MLB')]);let writes=0;
  const r=await runHistoryMaintenance(p,{mode:'apply',approveSnapshot:p.cohortHash,...dependencies(),readRows:async()=>[],insertRows:async()=>{writes++;return{written:1};}});
  assert.equal(writes,1);assert.equal(r.stopped,'PERSISTENCE_UNVERIFIED');assert.equal(r.outcomes.filter(o=>o.durableVerified).length,0);
});
test('existing contradictory history is preserved, not updated',async()=>{
  const p=plan(),old=row();old.stats.value=9;let writes=0;
  const r=await runHistoryMaintenance(p,{mode:'apply',approveSnapshot:p.cohortHash,...dependencies(),readRows:async()=>[old],insertRows:async()=>{writes++;}});
  assert.equal(writes,0);assert.equal(old.stats.value,9);assert.equal(r.outcomes[0].status,'EXISTING_HISTORY_CONFLICT');
});
test('provider failure is unavailable, not no career history or 0%',async()=>{
  const r=await runHistoryMaintenance(plan(),{mode:'probe',...dependencies(),fetchResearch:async()=>({available:false,retryable:true,code:'RESEARCH_PROVIDER_ERROR'})});
  assert.equal(r.outcomes[0].status,'RESEARCH_PROVIDER_ERROR');assert.equal(r.outcomes[0].publicVerified,false);
});
test('all deferred players stay in the denominator; sports receive fair turns',async()=>{
  const p=plan([context('NFL','Fixture A'),context('NFL','Fixture B'),context('WNBA','Fixture C')]);let order=[];
  const r=await runHistoryMaintenance(p,{mode:'probe',maxPlayers:2,...dependencies(),fetchResearch:async x=>{order.push(x.sport);return{available:false,code:'NO_GAME_LOG_DATA'};}});
  assert.deepEqual(order,['NFL','WNBA']);assert.equal(r.totalPlayers,3);assert.equal(r.outcomes.filter(o=>o.status==='DEFERRED_BUDGET').length,1);
});
test('row budget bounds proposals even when the provider returns a full season',async()=>{
  const rows=Array.from({length:100},(_,i)=>row('NFL','1',String(100+i)));
  const r=await runHistoryMaintenance(plan(),{mode:'probe',maxRows:3,...dependencies(),fetchResearch:async()=>result('NFL',rows)});
  assert.equal(r.submittedRows,3);assert.equal(r.outcomes[0].verifiedGames,3);
});
test('transport only permits credential-free public ESPN GETs and disables redirects',async()=>{
  let sent;let time=NOW;
  const t=createHistoryTransport({now:()=>time,sleep:async ms=>{time+=ms;},fetchImpl:async(u,o)=>{sent={u,o};return new Response('{}');}});
  await assert.rejects(t.fetch('https://api.prop-line.com/v1/games'),/BLOCKED/);
  await assert.rejects(t.fetch('https://site.api.espn.com/apis/test?apiKey=secret'),/BLOCKED/);
  await assert.rejects(t.fetch('https://site.api.espn.com/apis/test',{method:'POST',body:'x'}),/BLOCKED/);
  await t.fetch('https://site.api.espn.com/apis/test',{headers:{authorization:'must-not-leak'}});
  assert.deepEqual(sent.o.headers,{accept:'application/json'});assert.equal(sent.o.redirect,'error');assert.equal(sent.o.credentials,'omit');
});
for (const status of [429,403]) test(`public ${status} stops subsequent requests`,async()=>{
  let calls=0,time=NOW;const t=createHistoryTransport({now:()=>time,sleep:async ms=>{time+=ms;},fetchImpl:async()=>{calls++;return new Response('{}',{status});}});
  await t.fetch('https://site.api.espn.com/apis/test');await assert.rejects(t.fetch('https://site.api.espn.com/apis/another'));
  assert.equal(calls,1);
});
test('request/time budgets cannot silently trigger another provider',async()=>{
  let calls=0,time=NOW;const t=createHistoryTransport({maxRequests:1,maxMs:1000,now:()=>time,sleep:async ms=>{time+=ms;},fetchImpl:async()=>{calls++;return new Response('{}');}});
  await t.fetch('https://site.api.espn.com/apis/test');await assert.rejects(t.fetch('https://site.api.espn.com/apis/test2'));
  assert.equal(calls,1);assert.equal(t.status().stopped,'REQUEST_BUDGET');
});
test('CLI rejects misspelled apply flags, invalid budgets and approval omissions',()=>{
  assert.throws(()=>parseHistoryArgs(['--aply=true']));assert.throws(()=>parseHistoryArgs(['--mode=apply']));
  assert.throws(()=>parseHistoryArgs(['--max-requests=501']));assert.throws(()=>parseHistoryArgs(['--offset=-1']));
  assert.equal(parseHistoryArgs([]).mode,undefined);
});
test('RPC does not emit secret-bearing error messages or follow redirects',async()=>{
  const secret='synthetic-test-token',env={AUTOSCOUT_SUPABASE_URL:'https://fixture.supabase.co',AUTOSCOUT_SUPABASE_PUBLISHABLE_KEY:'synthetic-public',AUTOSCOUT_SUPABASE_INGEST_TOKEN:secret};
  const rpc=createHistoryRpc(env,async(u,o)=>{assert.equal(o.redirect,'error');throw Error(secret);});
  await assert.rejects(rpc('snapshot'),e=>e.message==='MAINTENANCE_RPC_UNAVAILABLE'&&!e.message.includes(secret));
  assert.throws(()=>createHistoryRpc({...env,AUTOSCOUT_SUPABASE_URL:'https://evil.example'}));
});
test('migration is isolated, active-board based, token-protected and insert-only',async()=>{
  const sql=await readFile(new URL('../supabase/migrations/20260919014000_verified_history_maintenance.sql',import.meta.url),'utf8');
  assert.match(sql,/private\.autoscout_backend_tokens/);assert.match(sql,/set search_path = ''/);
  assert.match(sql,/from public\.active_props where expires_at > statement_timestamp\(\)/);
  assert.doesNotMatch(sql,/join public\.(players|props|events)\b/i);
  assert.match(sql,/on conflict\(player_id,game_id,category\) do nothing/i);
  assert.doesNotMatch(sql,/\b(delete from|truncate|do update|update public\.)\b/i);
  assert.match(sql,/revoke all[\s\S]+from public;/);assert.match(sql,/One verified player per maintenance batch/);
});
test('PrizePicks single_stat is recognized as scoring metadata, not a fabricated period',()=>{
  const c=context('NFL','Fixture Player',{period:'single_stat',sourceBook:'prizepicks'});
  assert.equal(plan([c]).players[0].choices.length,1);
  assert.equal(plan([{...c,sourceBook:'unknown'}]).players[0].choices.length,0);
  assert.equal(plan([{...c,market:'1H Pass Yards'}]).players[0].choices.length,0);
});
test('oversized public response fails closed without another network request',async()=>{
  let time=NOW; const t=createHistoryTransport({now:()=>time,sleep:async ms=>{time+=ms;},
    fetchImpl:async()=>new Response('{}',{headers:{'content-length':'4000001'}})});
  await assert.rejects(t.fetch('https://site.api.espn.com/apis/test'),/TOO_LARGE/);
  assert.equal(t.status().stopped,'PUBLIC_RESPONSE_TOO_LARGE');
});
