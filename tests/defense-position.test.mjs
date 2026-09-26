import test from 'node:test';
import assert from 'node:assert/strict';
import {positionGameRows,rankPositionRows,rankOffenseRows,createDefensePosition,balancedEvents,priorSeasonEvents,calendarDays,normalizePosition,isRegularSeason} from '../lib/data-sources/espn/defense-position.mjs';
import {gatedApi} from '../lib/auth/gate.mjs';
function summary(){return {header:{id:'1',league:{slug:'nba'},season:{type:2},competitions:[{date:'2026-01-01',status:{type:{completed:true,state:'post'}},competitors:[{team:{id:'a'}},{team:{id:'b'}}]}]},boxscore:{players:[{team:{id:'a'},statistics:[{labels:['PTS','REB','AST','3PT'],athletes:[{athlete:{id:'p1',position:{abbreviation:'C'}},stats:['20','10','4','1-3']},{athlete:{id:'p2',position:{abbreviation:'C'}},stats:['8','3','0','0-1']}]}]}]}};}
test('position defense aggregates opponents once per game and preserves zero',()=>{const rows=positionGameRows(summary(),'NBA',new Set(['a','b']));assert.equal(rows.find(r=>r.metric==='points'&&r.position==='C').total,28);assert.equal(rows.find(r=>r.metric==='threes'&&r.position==='C').total,1);assert.ok(rows.every(r=>r.teamId==='b'));});
test('foreign leagues, uncompleted games and unclear positions do not create observations',()=>{for(const mutate of [s=>s.header.league.slug='wnba',s=>s.header.competitions[0].status.type.completed=false,s=>s.header.season.type=1,s=>s.boxscore.players[0].statistics[0].athletes.forEach(a=>a.athlete.position.abbreviation='XX')]){const s=summary();mutate(s);assert.deepEqual(positionGameRows(s,'NBA',new Set(['a','b'])),[]);}});
test('league ranks require all teams with three observed games and retain ties',()=>{const teams=[{id:'a'},{id:'b'},{id:'c'}],rows=teams.flatMap((t,i)=>[1,2,3].map(gameId=>({teamId:t.id,position:'C',metric:'points',gameId:String(gameId),total:i===0?10:20})));let result=rankPositionRows(rows,teams);assert.deepEqual(result.map(r=>r.rank),[1,2,2]);assert.equal(rankPositionRows([...rows,...rows],teams)[0].games,3);assert.ok(rankPositionRows(rows.filter(r=>r.teamId!=='c'),teams).every(r=>r.rank===null));});
test('unsupported sports do not fetch; shared cache avoids per-position polling',async()=>{let calls=0;const get=createDefensePosition({teamDirectory:async()=>[{id:'a',abbreviation:'A',displayName:'A'}],request:async()=>{calls++;return {data:{events:[]}};},now:()=>Date.parse('2026-09-20')});assert.equal((await get({sport:'tennis_atp'})).available,false);assert.equal(calls,0);await Promise.all([get({sport:'NBA'}),get({sport:'NBA'})]);await get({sport:'NBA'});assert.equal(calls,16,'14 day boards, then two season calendars for the prior-season fallback, all shared by the concurrent calls');assert.equal(gatedApi('/api/apex/research-defense-position'),true);});

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
test('offense ranks read the same team-games from the producing side',()=>{
  const rows=positionGameRows(summary(),'NBA',new Set(['a','b']));
  assert.ok(rows.every(r=>r.offenseTeamId==='a'&&r.teamId==='b'),'team a produced what team b allowed');
  const teams=[{id:'a'},{id:'b'},{id:'c'}];
  // Team a allows 10 per game but scores 30; b and c allow 20 and score 15.
  const games=teams.flatMap((t,i)=>[1,2,3].map(g=>({teamId:t.id,offenseTeamId:teams[(i+1)%3].id,position:'C',metric:'points',gameId:t.id+g,total:i===0?10:20})))
    .concat(teams.flatMap((t,i)=>[1,2,3].map(g=>({teamId:teams[(i+2)%3].id,offenseTeamId:t.id,position:'C',metric:'rebounds',gameId:'r'+t.id+g,total:i===0?30:15}))));
  const offense=rankOffenseRows(games,teams).filter(r=>r.metric==='rebounds');
  assert.equal(offense.find(r=>r.teamId==='a').rank,3,'the most productive offense ranks last, as the most generous defense does');
  assert.equal(offense.find(r=>r.teamId==='a').average,30);
  // Rows without a producing team (older cached rows) are left out, not guessed.
  assert.deepEqual(rankOffenseRows(games.map(({offenseTeamId,...r})=>r),teams),[]);
});

const ev=(id,date,a,b,{type=2,year=2025,completed=true}={})=>({id,date,season:{type,year},status:{type:{completed}},competitions:[{competitors:[{team:{id:a}},{team:{id:b}}]}]});

test('balanced sampling takes the fewest games that give every team its target',()=>{
  const allowed=new Set(['a','b','c','d']);
  const events=[ev('1','2026-01-10','a','b'),ev('2','2026-01-09','c','d'),ev('3','2026-01-08','a','b'),ev('4','2026-01-07','c','d'),ev('5','2026-01-06','a','c')];
  assert.deepEqual(balancedEvents(events,allowed,2,99),['1','2','3','4'],'once every team has two, older games are not fetched');
  assert.deepEqual(balancedEvents(events,allowed,5,3),['1','2','3'],'the cap bounds summaries');
  assert.deepEqual(balancedEvents([ev('9','2026-01-01','a','zz')],allowed,2,9),[],'unknown teams are not league games');
});

test('the NFL fallback reads only the previous season\'s final regular-season weeks',async()=>{
  const paths=[];
  const request=async path=>{paths.push(path);
    if(path.includes('scoreboard?limit=1'))return {data:{leagues:[{season:{year:2026}}]}};
    const week=Number((path.match(/week=(\d+)/)||[])[1]);
    return {data:{events:[ev('w'+week,`2026-01-0${Math.max(1,week-12)}T18:00Z`,'a','b'),ev('p'+week,'2026-01-20T18:00Z','a','b',{type:3})]}};};
  const r=await priorSeasonEvents({request,prefix:'/site/v2/sports/football/nfl',sport:'NFL',clock:Date.parse('2026-09-26'),allowed:new Set(['a','b'])});
  assert.equal(r.season,2025);
  assert.equal(r.label,"last season's final weeks");
  assert.deepEqual(paths.filter(p=>p.includes('week=')).map(p=>Number(p.match(/week=(\d+)/)[1])),[18,17,16,15,14,13]);
  assert.ok(paths.every(p=>!p.includes('week=')||p.includes('dates=2025&seasontype=2')));
  assert.ok(r.events.every(e=>e.season.type===2),'postseason games are never used');
});

test('the basketball fallback walks game days back, skips the postseason and never mixes seasons',async()=>{
  // The current season has no games yet; last season ended with playoff days.
  const request=async path=>{
    if(path.endsWith('scoreboard?limit=1'))return {data:{leagues:[{season:{year:2027},calendar:['2026-10-20T07:00Z']}]}};
    if(path.includes('dates=2026&limit=1'))return {data:{leagues:[{season:{year:2026},calendar:['2026-04-10T07:00Z','2026-04-12T07:00Z','2026-05-01T07:00Z','2026-06-10T07:00Z']}]}};
    const day=(path.match(/dates=(\d{8})/)||[])[1];
    if(day==='20260610'||day==='20260501')return {data:{events:[ev('po'+day,'2026-05-01T23:00Z','a','b',{type:3,year:2026})]}};
    if(day==='20260412')return {data:{events:[ev('r12','2026-04-12T23:00Z','a','b',{year:2026})]}};
    if(day==='20260410')return {data:{events:[ev('r10','2026-04-10T23:00Z','a','b',{year:2026}),ev('old','2025-04-10T23:00Z','a','b',{year:2025})]}};
    return {data:{events:[]}};};
  const r=await priorSeasonEvents({request,prefix:'/site/v2/sports/basketball/nba',sport:'NBA',clock:Date.parse('2026-09-26'),allowed:new Set(['a','b'])});
  assert.equal(r.season,2026);
  assert.equal(r.label,"last season's final weeks",'2025-26 is last season relative to 2026-27');
  assert.deepEqual(r.events.map(e=>e.id).sort(),['r10','r12'],'playoff days skipped; a different season is never mixed in');
});

test('when this season cannot rank every team, the prior season fills in and says so',async()=>{
  const teams=['a','b','c','d'].map(id=>({id,abbreviation:id.toUpperCase(),displayName:'Team '+id}));
  const box=(id,date,x,y)=>({header:{id,league:{slug:'nfl'},season:{type:2},competitions:[{date,status:{type:{completed:true,state:'post'}},competitors:[{team:{id:x}},{team:{id:y}}]}]},
    boxscore:{players:[x,y].map(t=>({team:{id:t},statistics:[{name:'passing',labels:['YDS','TD'],athletes:[{athlete:{id:t+'qb'+id,position:{abbreviation:'QB'}},stats:[String(200+id.length*10+(t==='a'?50:0)),'1']}]}]}))}});
  const games=[];let n=0;
  for(let week=18;week>=13;week--)for(const [x,y] of [['a','b'],['c','d'],['a','c'],['b','d']])games.push({id:String(++n),week,x,y});
  const request=async path=>{
    if(path.includes('scoreboard?limit=1'))return {data:{leagues:[{season:{year:2026}}]}};
    if(path.includes('seasontype=2&week=')){const week=Number(path.match(/week=(\d+)/)[1]);return {data:{events:games.filter(g=>g.week===week).map(g=>ev(g.id,`2025-12-${10+week}T18:00Z`,g.x,g.y))}};}
    if(path.includes('/summary?event=')){const g=games.find(x=>x.id===path.split('=').pop());return {data:box(g.id,`2025-12-${10+g.week}T18:00Z`,g.x,g.y)};}
    if(path.includes('/roster'))return {data:{athletes:[]}};
    return {data:{events:[]}};};
  const get=createDefensePosition({teamDirectory:async()=>teams,request,now:()=>Date.parse('2026-09-26')});
  const r=await get({sport:'NFL'});
  assert.equal(r.fallback?.label,"last season's final weeks");
  assert.equal(r.fallback?.season,2025);
  assert.ok(r.rows.some(row=>row.metric==='passingYards'&&row.position==='QB'&&row.rank!==null));
  assert.match(r.basis,/Not enough games yet this season/);
});

const header=(slug,extra={})=>({id:'g1',league:{slug},season:{type:2,...extra},competitions:[{date:'2026-01-01',status:{type:{completed:true,state:'post'}},competitors:[{team:{id:'a'}},{team:{id:'b'}}]}]});

test('MLB ranks batters and pitchers from the box score groups ESPN labels by type',()=>{
  const s={header:header('mlb'),boxscore:{players:[
    {team:{id:'a'},statistics:[{type:'batting',labels:['AB','R','H','RBI','HR','BB','K'],athletes:[{athlete:{id:'1'},stats:['4','1','2','1','1','0','1']},{athlete:{id:'2'},stats:['3','0','1','0','0','1','2']}]},
      {type:'pitching',labels:['IP','H','R','ER','BB','K','HR'],athletes:[{athlete:{id:'3'},stats:['6.1','5','2','2','1','7','1']},{athlete:{id:'4'},stats:['2.2','1','0','0','0','3','0']}]}]}]}};
  const rows=positionGameRows(s,'MLB',new Set(['a','b']));
  const get=(pos,m)=>rows.find(r=>r.position===pos&&r.metric===m)?.total;
  assert.equal(get('BAT','hits'),3);
  assert.equal(get('BAT','strikeouts'),3);
  assert.equal(get('PIT','pitcherStrikeouts'),10);
  assert.equal(get('PIT','outs'),27,'6.1 + 2.2 innings = 19 + 8 outs');
  assert.ok(rows.every(r=>r.teamId==='b'&&r.offenseTeamId==='a'),'team a produced what team b allowed');
});

test('NHL ranks forwards, defense and goalies from their own groups, with points derived',()=>{
  const s={header:header('nhl'),boxscore:{players:[{team:{id:'a'},statistics:[
    // ESPN's real layout: "S" is shots on goal (key shotsTotal); "SOG" is shootout goals.
    {name:'forwards',labels:['G','A','S','SOG','BS'],athletes:[{athlete:{id:'1'},stats:['1','1','4','1','0']},{athlete:{id:'2'},stats:['0','2','3','0','1']}]},
    {name:'defenses',labels:['G','A','S','SOG','BS'],athletes:[{athlete:{id:'3'},stats:['0','1','2','0','3']}]},
    {name:'goalies',labels:['GA','SA','SV'],athletes:[{athlete:{id:'4'},stats:['2','30','28']}]}]}]}};
  const rows=positionGameRows(s,'NHL',new Set(['a','b']));
  const get=(pos,m)=>rows.find(r=>r.position===pos&&r.metric===m)?.total;
  assert.equal(get('F','shotsOnGoal'),7,'shots on goal come from "S", never from shootout goals');
  assert.equal(get('D','shotsOnGoal'),2);
  assert.equal(get('F','points'),4);
  assert.equal(get('D','blockedShots'),3);
  assert.equal(get('G','saves'),28);
  assert.equal(rows.find(r=>r.position==='G'&&r.metric==='goals'),undefined,'goalies are not ranked on skater stats');
});

test('soccer ranks what each club allows from the teams\' own totals',()=>{
  const s={header:header('eng.1',{type:14308,name:'2026-27 English Premier League'}),boxscore:{teams:[
    {team:{id:'a'},statistics:[{name:'totalShots',displayValue:'14'},{name:'shotsOnTarget',displayValue:'5'}]},
    {team:{id:'b'},statistics:[{name:'totalShots',displayValue:'9'},{name:'shotsOnTarget',displayValue:'2'}]}]}};
  const rows=positionGameRows(s,'EPL',new Set(['a','b']));
  assert.equal(rows.find(r=>r.teamId==='b'&&r.metric==='shots').total,14,'b allowed a\'s 14 shots');
  assert.equal(rows.find(r=>r.teamId==='a'&&r.metric==='shotsOnTarget').total,2);
  assert.equal(isRegularSeason({slug:'2026-mls-playoffs'},'MLS'),false);
  assert.equal(isRegularSeason({type:14308,name:'2026-27 English Premier League'},'EPL'),true);
});

test('a box score "Team" line is not a player and does not void the game',()=>{
  const s={header:header('college-football'),boxscore:{players:[{team:{id:'a'},statistics:[
    {name:'rushing',labels:['CAR','YDS'],athletes:[{athlete:{id:'10',position:{abbreviation:'RB'}},stats:['12','80']},{athlete:{id:'-103071',displayName:'Team'},stats:['2','-3']}]}]}]}};
  const rows=positionGameRows(s,'NCAAF',new Set(['a','b']));
  assert.equal(rows.find(r=>r.position==='RB'&&r.metric==='rushingYards').total,80);
});

test('basketball roles map to guards, forwards and centers without guessing a hybrid',()=>{
  assert.equal(normalizePosition('NBA','PG'),'G');
  assert.equal(normalizePosition('NBA','SF'),'F');
  assert.equal(normalizePosition('WNBA','F-C'),'F','the primary role is listed first');
  assert.equal(normalizePosition('NCAAB','C'),'C');
  assert.equal(normalizePosition('NBA','XX'),null);
  assert.equal(normalizePosition('NFL','FB'),'RB');
});

test('a college league ranks among teams with three games and reports that size',()=>{
  const teams=Array.from({length:20},(_,i)=>({id:'t'+i}));
  const rows=teams.slice(0,14).flatMap((t,i)=>[1,2,3].map(g=>({teamId:t.id,position:'QB',metric:'passingYards',gameId:t.id+g,total:100+i})));
  const full=rankPositionRows(rows,teams);
  assert.ok(full.every(r=>r.rank===null),'a pro league needs every team');
  const partial=rankPositionRows(rows,teams,{partial:true});
  assert.ok(partial.every(r=>r.rank!==null&&r.leagueSize===14&&r.partial===true));
  assert.ok(rankPositionRows(rows.slice(0,3*5),teams,{partial:true}).every(r=>r.rank===null),'too few teams to rank');
});

test('a cup calendar\'s phases expand into its matchdays and skip the knockouts',()=>{
  const days=calendarDays([{label:'UCL',entries:[{label:'League Phase',startDate:'2025-09-15T00:00Z',endDate:'2025-09-21T23:59Z'},{label:'Knockout Round Playoffs',startDate:'2026-02-15T00:00Z',endDate:'2026-02-20T00:00Z'}]}],'UCL');
  assert.deepEqual(days.map(t=>new Date(t).toISOString().slice(0,10)),['2025-09-16','2025-09-17'],'Tuesday and Wednesday only');
  assert.equal(calendarDays(['2026-04-10T07:00Z'],'NBA').length,1);
});
