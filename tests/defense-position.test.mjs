import test from 'node:test';
import assert from 'node:assert/strict';
import {positionGameRows,rankPositionRows,createDefensePosition} from '../lib/data-sources/espn/defense-position.mjs';
import {gatedApi} from '../lib/auth/gate.mjs';
function summary(){return {header:{id:'1',league:{slug:'nba'},season:{type:2},competitions:[{date:'2026-01-01',status:{type:{completed:true,state:'post'}},competitors:[{team:{id:'a'}},{team:{id:'b'}}]}]},boxscore:{players:[{team:{id:'a'},statistics:[{labels:['PTS','REB','AST','3PT'],athletes:[{athlete:{id:'p1',position:{abbreviation:'C'}},stats:['20','10','4','1-3']},{athlete:{id:'p2',position:{abbreviation:'C'}},stats:['8','3','0','0-1']}]}]}]}};}
test('position defense aggregates opponents once per game and preserves zero',()=>{const rows=positionGameRows(summary(),'NBA',new Set(['a','b']));assert.equal(rows.find(r=>r.metric==='points'&&r.position==='C').total,28);assert.equal(rows.find(r=>r.metric==='threes'&&r.position==='C').total,1);assert.ok(rows.every(r=>r.teamId==='b'));});
test('foreign leagues, uncompleted games and unclear positions do not create observations',()=>{for(const mutate of [s=>s.header.league.slug='wnba',s=>s.header.competitions[0].status.type.completed=false,s=>s.header.season.type=1,s=>s.boxscore.players[0].statistics[0].athletes.forEach(a=>a.athlete.position.abbreviation='F')]){const s=summary();mutate(s);assert.deepEqual(positionGameRows(s,'NBA',new Set(['a','b'])),[]);}});
test('league ranks require all teams with three observed games and retain ties',()=>{const teams=[{id:'a'},{id:'b'},{id:'c'}],rows=teams.flatMap((t,i)=>[1,2,3].map(gameId=>({teamId:t.id,position:'C',metric:'points',gameId:String(gameId),total:i===0?10:20})));let result=rankPositionRows(rows,teams);assert.deepEqual(result.map(r=>r.rank),[1,2,2]);assert.equal(rankPositionRows([...rows,...rows],teams)[0].games,3);assert.ok(rankPositionRows(rows.filter(r=>r.teamId!=='c'),teams).every(r=>r.rank===null));});
test('unsupported sports do not fetch; shared cache avoids per-position polling',async()=>{let calls=0;const get=createDefensePosition({teamDirectory:async()=>[{id:'a',abbreviation:'A',displayName:'A'}],request:async()=>{calls++;return {data:{events:[]}};},now:()=>Date.parse('2026-09-20')});assert.equal((await get({sport:'tennis_atp'})).available,false);assert.equal(calls,0);await Promise.all([get({sport:'NBA'}),get({sport:'NBA'})]);await get({sport:'NBA'});assert.equal(calls,14);assert.equal(gatedApi('/api/apex/research-defense-position'),true);});

test('roster positions resolve missing box-score roles without guessing by statistical category',()=>{
 const s=summary();s.boxscore.players[0].statistics[0].athletes.forEach(p=>delete p.athlete.position);
 const allowed=new Set(['a','b']);assert.deepEqual(positionGameRows(s,'NBA',allowed),[]);
 const positions=new Map([['a:p1','C'],['a:p2','C']]);assert.equal(positionGameRows(s,'NBA',allowed,positions).find(r=>r.metric==='points'&&r.position==='C').total,28);
 s.boxscore.players[0].statistics[0].athletes[1].stats[0]='--';assert.ok(!positionGameRows(s,'NBA',allowed,positions).some(r=>r.metric==='points'&&r.position==='C'));
});

test('present NFL receiving category counts absent TE production as zero; missing category stays missing',()=>{
 const s=summary();s.header.league.slug='nfl';s.boxscore.players[0].statistics=[{name:'receiving',labels:['YDS','REC'],athletes:[{athlete:{id:'p1',position:{abbreviation:'WR'}},stats:['40','3']}]}];
 const rows=positionGameRows(s,'NFL',new Set(['a','b']));
 assert.equal(rows.find(r=>r.position==='TE'&&r.metric==='receivingYards').total,0);
 assert.equal(rows.find(r=>r.position==='WR'&&r.metric==='receivingYards').total,40);
 assert.ok(!rows.some(r=>r.metric==='passingYards'));
 const ranked=rankPositionRows([...rows,...rows.map(r=>({...r,gameId:'2',total:r.position==='TE'?10:r.total}))],[{id:'b'}]);
 assert.equal(ranked.find(r=>r.position==='TE'&&r.metric==='receivingYards').average,5);
 s.boxscore.players[0].statistics[0].athletes[0].stats=['40'];
 assert.deepEqual(positionGameRows(s,'NFL',new Set(['a','b'])),[]);
});

test('raw tennis history retains source stats and rejects missing stats as zero',async()=>{
 const {historyForMarket}=await import('../lib/web/prop-workspace.mjs');
 const p={name:'Test Tennis',aliases:['Test Tennis'],playerId:'p',eventId:'next',sport:'tennis',startsAt:'2026-09-22T12:00:00Z'};
 const h=historyForMarket({player_name:p.name,player_id:'p',sport_key:'tennis',season:2026,games:[{event_id:'old',status:'final',commence_time:'2026-09-18T12:00:00Z',opponent:'Other',season:2026,result:'W',stats:{aces:8,dblfaults:0,games_w:12,sets_won:2,breakpts_w:null}}]},p,{marketKey:'player_aces'},{now:Date.parse('2026-09-20')});
 assert.equal(h.gameLog[0].aces,8);assert.equal(h.gameLog[0].doubleFaults,0);assert.equal(h.gameLog[0].setsWon,2);assert.equal(h.gameLog[0].breakPointsWon,undefined);assert.equal(h.season,2026);assert.equal(h.gameLog[0].gameResult,'W');
});

test('NFL reads six weeks of daily scoreboards; basketball keeps fourteen days',async()=>{
 const boards=sport=>{const days=new Set();return {days,get:createDefensePosition({teamDirectory:async()=>[{id:'a',abbreviation:'A',displayName:'A'}],request:async path=>{const m=/scoreboard\?dates=(\d{8})/.exec(path);if(m)days.add(m[1]);return {data:{events:[]}};},now:()=>Date.parse('2026-09-24T12:00:00Z')})};};
 const nfl=boards('NFL'),nba=boards('NBA');
 const n=await nfl.get({sport:'NFL'}),b=await nba.get({sport:'NBA'});
 assert.equal(nfl.days.size,42);assert.equal(nba.days.size,14);
 assert.equal(n.windowDays,42);assert.equal(b.windowDays,14);
 assert.match(n.basis,/within 42 days/);
});
