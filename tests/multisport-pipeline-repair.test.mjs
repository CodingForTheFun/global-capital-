import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {marketContract,normalizeStatColumns,statValue,inningsToOuts} from '../lib/data-sources/espn/stat-contract.mjs';
import {samePublicTeam,resolvePublicAthlete,resolveRosterAthlete} from '../lib/data-sources/espn/identity.mjs';
import {normalizePublicGameLog,createPublicResearch} from '../lib/data-sources/espn/research.mjs';
import {normalizeTeamGame,fetchTeamResearch} from '../lib/data-sources/espn/team-research.mjs';
import {calculatePropSplits,analyzeResearch} from '../lib/analytics/research.mjs';
import {finalizeResearch} from '../lib/autoscout/research-service.mjs';
import {normalizePlayerName} from '../lib/data-sources/contract.mjs';
const f=JSON.parse(readFileSync(new URL('./fixtures/espn-pipeline-extras.json',import.meta.url)));
const parse=(key,sport,providerMarketKey,market='')=>normalizePublicGameLog(f[key],{sport,providerMarketKey,market,now:Date.parse('2026-09-12T23:00Z')});

test('source aliases are strict, zeros survive, and no component is invented',()=>{
 assert.equal(statValue({passYards:'241'},{sport:'NFL',fields:['PassingYards']}),241);
 assert.equal(statValue({recYards:0},{sport:'NFL',fields:['ReceivingYards']}),0);
 assert.equal(statValue({pts:20,reb:8,ast:4},{sport:'NBA',fields:['Points','Rebounds','Assists']}),32);
 assert.equal(statValue({pts:20,reb:8},{sport:'NBA',fields:['Points','Rebounds','Assists']}),null);
 assert.equal(statValue({passYards:''},{sport:'NFL',fields:['PassingYards']}),null);
 assert.equal(statValue({passYards:true},{sport:'NFL',fields:['PassingYards']}),null);
 assert.equal(marketContract({sport:'NBA',providerMarketKey:'player_points_q1',market:'Points'}),null);
 assert.equal(marketContract({sport:'NFL',providerMarketKey:'player_tds_over'}),null);
});

test('QB sacks taken and individual defensive sacks are resolved from verified source column groups',()=>{
 const qb=parse('love','NFL','player_sacks'),defense=parse('defense','NFL','player_sacks');
 assert.ok(qb.length&&defense.length);assert.equal(qb[0].value,1);assert.equal(qb[0].statKind,'sacks_taken');
 assert.equal(defense[0].value,0);assert.equal(defense[0].statKind,'defensive_sacks');
 assert.equal(parse('defense','NFL','player_sacks_taken').length,0);
 assert.equal(parse('love','NFL','team_sacks').length,0);
 assert.equal(normalizeStatColumns({sacks:3},{sport:'NFL'}).Sacks,null);
 const both=normalizeStatColumns({sacks:3,passingAttempts:30,totalTackles:5},{sport:'NFL'});assert.equal(both.Sacks,null);
});

test('NFL tackle, kicking and extra point histories use measured values',()=>{
 assert.equal(parse('defense','NFL','player_tackles_assists')[0].value,2);
 assert.equal(parse('defense','NFL','player_solo_tackles')[0].value,1);
 assert.equal(parse('kicking','NFL','player_field_goals')[0].value,0);
 assert.equal(parse('kicking','NFL','player_kicking_points')[0].value,3);
 assert.equal(parse('kicking','NFL','player_pats')[0].value,3);
 assert.equal(statValue({'fieldGoalsMade-fieldGoalAttempts':'2-3','extraPointsMade-extraPointAttempts':'3-3'},
  {sport:'NFL',fields:['KickingPoints']}),9);
});

test('MLB outs are base-three baseball notation, not decimal innings or half an out',()=>{
 assert.equal(inningsToOuts('5.2'),17);assert.equal(inningsToOuts('6.0'),18);
 assert.equal(inningsToOuts('5.1'),16);assert.equal(inningsToOuts('0.0'),0);
 for(const v of ['5.3','5.5','5.20','',null,'DNP'])assert.equal(inningsToOuts(v),null);
 assert.equal(parse('pitching','MLB','pitcher_outs')[0].value,16);
 assert.equal(parse('pitching','MLB','pitcher_walks')[0].value,1);
 assert.equal(parse('pitching','MLB','pitcher_hits_allowed')[0].value,4);
 assert.equal(parse('pitching','MLB','pitcher_earned_runs')[0].value,0);
 assert.equal(parse('pitching','MLB','batter_strikeouts').length,0);
 const r=calculatePropSplits([17,18],17.5,true,'',[]);assert.equal(r.L5,'50%');
});

test('NHL goalie saves/goals against and CBB combinations use actual raw columns',()=>{
 assert.equal(parse('goalie','NHL','player_total_saves')[0].value,32);
 assert.equal(parse('goalie','NHL','player_goals_against')[0].value,6);
 assert.equal(parse('cbb','NCAAB','player_points_rebounds_assists')[0].value,26);
 assert.equal(parse('cbb','CBB','player_blocks_steals')[0].value,2);
 assert.equal(parse('cbb','NCAAB','player_threes')[0].value,1);
 const d=structuredClone(f.cbb);d.seasonTypes[0].categories[0].events[0].didNotPlay=true;
 assert.equal(normalizePublicGameLog(d,{sport:'NCAAB',providerMarketKey:'player_points'}).length,parse('cbb','NCAAB','player_points').length-1);
});

test('soccer identity crosses competitions, but game logs never mix competitions or omit draws',()=>{
 assert.equal(resolvePublicAthlete(f.soccerSearch,{sport:'UCL',playerName:'Erling Haaland'}).id,'253989');
 assert.equal(parse('ucl','UCL','player_shots')[0].value,6);
 assert.equal(parse('ucl','EPL','player_shots').length,0);
 const mls=parse('mls','MLS','player_shots_on_target');assert.equal(mls[0].value,4);assert.equal(mls[0].gameResult,'T');
 assert.equal(parse('mls','MLS','player_passes_attempted').length,0,'absent passes are not fabricated');
 const d=structuredClone(f.mls);d.seasonTypes[0].displayName='Club Friendly';
 assert.equal(normalizePublicGameLog(d,{sport:'MLS',providerMarketKey:'player_shots'}).length,0);
});

test('player dictionary handles accents, suffixes, adjacent initials and rejects ambiguous identities',()=>{
 assert.equal(normalizePlayerName('C.J. Stroud'),normalizePlayerName('CJ Stroud'));
 assert.equal(normalizePlayerName('Nikola Jokić'),normalizePlayerName('Nikola Jokic'));
 assert.equal(normalizePlayerName('Gary Trent Jr.'),normalizePlayerName('Gary Trent'));
 assert.equal(samePublicTeam('NFL_GNB','GB','NFL'),true);assert.equal(samePublicTeam('PHO','PHX','NBA'),true);
 assert.equal(samePublicTeam('GB','GNB','NBA'),false);assert.equal(samePublicTeam('LA','LAL','NBA'),false);
 const d=structuredClone(f.loveSearch),group=d.results.find(g=>g.type==='player');
 const row=group.contents.find(r=>r.defaultLeagueSlug==='nfl'&&r.displayName==='Jordan Love');
 group.contents.push({...row,uid:'s:20~l:28~a:99999',link:{web:'https://www.espn.com/nfl/player/_/id/99999/'}});group.totalFound=group.contents.length;
 assert.equal(resolvePublicAthlete(d,{sport:'NFL',playerName:'Jordan Love'}),null);
 assert.equal(resolvePublicAthlete(d,{sport:'NFL',playerName:'Jordan Love',providerPlayerId:'history:NFL:4036378'}).id,'4036378');
 assert.equal(resolveRosterAthlete({athletes:[{id:'1',displayName:'Gary Trent Jr.'}]},{sport:'NBA',playerName:'Gary Trent'}).id,'1');
 assert.equal(resolveRosterAthlete({athletes:[{id:'1',displayName:'John Smith'},{id:'2',displayName:'John Smith Jr.'}]},{sport:'NBA',playerName:'John Smith'}),null);
});

test('empty early season still backfills the previous regular season, labels the current season honestly and caches per player',async()=>{
 const calls=[];
 const lookup=createPublicResearch({now:()=>Date.parse('2026-09-12T23:00Z'),fetchImpl:async url=>{
  calls.push(url);return new Response(JSON.stringify(url.includes('/search/')?f.loveSearch:url.includes('season=2025')?f.love:f.emptyCurrent));
 }});
 const request={sport:'NFL',playerName:'Jordan Love',market:'Sacks',providerMarketKey:'player_sacks',line:2.5,side:'OVER',games:15};
 const result=await lookup(request);assert.equal(result.available,true);assert.equal(result.season,'2026');
 assert.equal(result.marketDisplayName,'Sacks taken');assert.ok(result.gameLog.every(r=>r.season==='2025'&&r.seasonType===2));
 assert.ok(result.coverage.backfilled);assert.equal(result.coverage.currentSeasonGames,0);
 const metrics=finalizeResearch({...request,...result});assert.ok(metrics.windows.l5.games>0);assert.equal(metrics.windows.season.hitRate,null);
 await lookup({...request,line:1.5,side:'UNDER'});assert.equal(calls.length,4); // one cached league-season context request
});

test('current regular season excludes playoff and prior-year results; partial coverage is explicitly labeled',()=>{
 const gameLog=[{gameId:'1',date:'2026-09-12',value:15,season:'2026',seasonType:3},
  {gameId:'2',date:'2026-09-11',value:5,season:'2026',seasonType:2},
  {gameId:'3',date:'2025-12-30',value:50,season:'2025',seasonType:2}];
 const r=analyzeResearch({gameLog,season:'2026',coverage:{seasonComplete:true}},10,'OVER');
 assert.equal(r.windows.l5.games,3);assert.equal(r.windows.season.games,1);assert.equal(r.windows.season.hitRate,0);
 const partial=analyzeResearch({gameLog,season:'2026',coverage:{seasonComplete:false}},10,'OVER');
 assert.equal(partial.windows.season.games,1);assert.equal(partial.windows.season.partial,true);assert.equal(partial.coverage.seasonComplete,false);
});

test('one shared research engine handles small samples, pushes, zero, deltas and consecutive streaks',()=>{
 const r=calculatePropSplits([12,10,11,4,null,0],10,true,'MIN',[0,11],{seasonLogs:[12,4],window:'l5'});
 assert.equal(r.L5,'40%');assert.equal(r.L10,'40%');assert.equal(r.AVG,'7.4');assert.equal(r.DIFF,'-2.6');
 assert.equal(r.H2H,'50%');assert.equal(r.STRK,'1 Over');assert.equal(r.SZN,'50%');
 const u=calculatePropSplits([0,4,11],10,false,'X',[],{seasonLogs:[]});assert.equal(u.STRK,'2 Under');assert.equal(u.H2H,'N/A');assert.equal(u.SZN,'N/A');
 const empty=calculatePropSplits([],10,true,'X');for(const k of ['L5','L10','L15','H2H','AVG','DIFF','STRK','SZN'])assert.equal(empty[k],'N/A');
 assert.equal(calculatePropSplits([12],10,true,'X').DIFF,'+2.0');
});

test('team box scores separate sacks made, sacks allowed and scoreboard points allowed without using player records',async()=>{
 const params={sport:'NFL',teamId:'9',eventId:'401772968'};
 assert.equal(normalizeTeamGame(f.team,{...params,field:'TeamDefensiveSacks'}).value,2);
 assert.equal(normalizeTeamGame(f.team,{...params,field:'TeamSacksAllowed'}).value,4);
 assert.equal(normalizeTeamGame(f.team,{...params,field:'TeamPointsAllowed'}).value,16);
 const d=structuredClone(f.team);d.header.competitions[0].status.type.completed=false;
 assert.equal(normalizeTeamGame(d,{...params,field:'TeamSacksAllowed'}),null);
 let calls=0;
 const r=await fetchTeamResearch({sport:'NFL',playerName:'Jordan Love',contract:marketContract({sport:'NFL',providerMarketKey:'team_sacks'})},
  {teamDirectory:async()=>[{id:'9',displayName:'Green Bay Packers',abbreviation:'GB'}],request:async()=>{calls++;return{};},now:Date.now});
 assert.equal(r.code,'ENTITY_MISMATCH');assert.equal(calls,0);
});


test('real schedule seasonType metadata feeds team logs instead of dropping all games',async()=>{
 const directory=[{id:'9',displayName:'Green Bay Packers',abbreviation:'GB'},{id:'16',displayName:'Minnesota Vikings',abbreviation:'MIN'}];
 const calls=[];
 const result=await fetchTeamResearch({sport:'NFL',playerName:'Green Bay Packers Defense',games:15,opponent:'MIN',contract:marketContract({sport:'NFL',providerMarketKey:'team_sacks'})},{
  now:()=>Date.parse('2026-09-12T23:00Z'),teamDirectory:async()=>directory,
  request:async path=>{calls.push(path);return {data:path.includes('/summary')?f.team:path.includes('season=2024')?{requestedSeason:{year:2024},events:[]}:f.teamSchedule};}
 });
 assert.equal(result.available,true);assert.equal(result.season,'2025');
 assert.equal(result.gameLog.length,1);assert.equal(result.gameLog[0].value,2);
 assert.equal(result.coverage.seasonComplete,true);assert.ok(calls.some(p=>p.includes('/summary?event=401772968')));
});

test('unknown season rows cannot count as a partially verified current season',()=>{
 const r=analyzeResearch({season:2026,gameLog:[{value:5}],coverage:{seasonComplete:false}},4,'OVER');
 assert.equal(r.windows.l5.hitRate,100);assert.equal(r.windows.season.hitRate,null);
 const h2h=analyzeResearch({season:2026,averageWindow:'h2h',matchup:{opponent:'GB'},gameLog:[{value:5,opponent:'GB',season:2026},{value:30,opponent:'MIN',season:2026}]},10,'OVER');
 assert.equal(h2h.diff.basis,'h2h');assert.equal(h2h.diff.average,5);assert.equal(h2h.diff.value,-5);
});
