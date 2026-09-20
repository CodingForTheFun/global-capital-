import test from 'node:test';
import assert from 'node:assert/strict';
import { cfbPlayerBoxUrl, cfbScheduleUrl, fetchCfbStatsArchiveResearch } from '../lib/data-sources/sportsdataverse/cfb-game-research.mjs';

const phead='game_id,season,week,team_id,category,athlete_id,athlete_name,completions_passing_attempts,passing_yards,yards_per_pass_attempt,passing_touchdowns,interceptions,adj_qbr,rushing_attempts,rushing_yards,yards_per_rush_attempt,rushing_touchdowns,long_rushing,receptions,receiving_yards,yards_per_reception,receiving_touchdowns,long_reception,fumbles,fumbles_lost,fumbles_recovered,total_tackles,solo_tackles,sacks,tackles_for_loss,passes_defended,hurries,defensive_touchdowns,interception_yards,interception_touchdowns,kick_returns,kick_return_yards,yards_per_kick_return,long_kick_return,kick_return_touchdowns,punt_returns,punt_return_yards,yards_per_punt_return,long_punt_return,punt_return_touchdowns,field_goals_made_field_goal_attempts,field_goal_pct,long_field_goal_made,extra_points_made_extra_point_attempts,total_kicking_points,punts,punt_yards,gross_avg_punt_yards,touchbacks,punts_inside20,long_punt';
const shead='game_id,season,week,season_type,game_date,neutral_site,conference_competition,home_id,home_team,home_location,home_nickname,home_abbreviation,home_conference_id,home_score,home_winner,home_rank,away_id,away_team,away_location,away_nickname,away_abbreviation,away_conference_id,away_score,away_winner,away_rank,status_type_name,status_type_completed,status_type_detail';

function prow({game='401000001',team='1',category,athlete='100',name='Fixture QB',values={}}){
 const cols=phead.split(','),row=Object.fromEntries(cols.map(k=>[k,'']));
 Object.assign(row,{game_id:game,season:'2026',week:'3',team_id:team,category,athlete_id:athlete,athlete_name:name,...values});
 return cols.map(k=>row[k]).join(',');
}
function srow({game='401000001',date='2026-09-12T19:00:00Z',home='1',away='2',hs='31',as='20'}={}){
 const cols=shead.split(','),row=Object.fromEntries(cols.map(k=>[k,'']));
 Object.assign(row,{game_id:game,season:'2026',week:'3',season_type:'2',game_date:date,home_id:home,home_team:'Fixture State',home_location:'Fixture State',home_abbreviation:'FIX',home_score:hs,away_id:away,away_team:'Other State',away_location:'Other State',away_abbreviation:'OTH',away_score:as,status_type_name:'STATUS_FINAL',status_type_completed:'true',status_type_detail:'Final'});
 return cols.map(k=>row[k]).join(',');
}
const playerCsv=[phead,
 prow({category:'passing',values:{completions_passing_attempts:'22/31',passing_yards:'287',passing_touchdowns:'3',interceptions:'1'}}),
 prow({category:'rushing',values:{rushing_attempts:'7',rushing_yards:'42',rushing_touchdowns:'1',long_rushing:'18'}}),
 prow({game:'401000002',category:'passing',values:{completions_passing_attempts:'18/29',passing_yards:'241',passing_touchdowns:'2',interceptions:'0'}}),
 prow({game:'401000002',category:'rushing',values:{rushing_attempts:'5',rushing_yards:'28',rushing_touchdowns:'0',long_rushing:'11'}}),
 prow({category:'receiving',athlete:'200',name:'Fixture WR',values:{receptions:'7',receiving_yards:'112',receiving_touchdowns:'1',long_reception:'36'}}),
 prow({game:'401000002',category:'receiving',athlete:'200',name:'Fixture WR',values:{receptions:'5',receiving_yards:'84',receiving_touchdowns:'0',long_reception:'27'}}),
 prow({category:'defensive',athlete:'300',name:'Fixture LB',values:{total_tackles:'9',solo_tackles:'6',sacks:'1.5'}}),
 prow({game:'401000002',category:'defensive',athlete:'300',name:'Fixture LB',values:{total_tackles:'7',solo_tackles:'4',sacks:'0.5'}}),
 prow({category:'kicking',athlete:'400',name:'Fixture Kicker',values:{field_goals_made_field_goal_attempts:'2/2',extra_points_made_extra_point_attempts:'3/3',total_kicking_points:'9'}}),
 prow({game:'401000002',category:'kicking',athlete:'400',name:'Fixture Kicker',values:{field_goals_made_field_goal_attempts:'1/2',extra_points_made_extra_point_attempts:'4/4',total_kicking_points:'7'}}),
].join('\n');
const scheduleCsv=[shead,srow(),srow({game:'401000002',date:'2026-09-05T19:00:00Z',hs:'27',as:'24'})].join('\n');

function source(){
 return async url=>{
  const value=String(url);
  if(value.includes('player_box_2026.csv'))return new Response(playerCsv,{status:200,headers:{'content-length':String(Buffer.byteLength(playerCsv))}});
  if(value.includes('cfb_schedule_2026.csv'))return new Response(scheduleCsv,{status:200,headers:{'content-length':String(Buffer.byteLength(scheduleCsv))}});
  if(value.includes('player_box_2025.csv'))return new Response(phead+'\n',{status:200});
  if(value.includes('cfb_schedule_2025.csv'))return new Response(shead+'\n',{status:200});
  throw Error('unexpected '+url);
 };
}
const deps={fetcher:source(),now:()=>Date.parse('2026-09-19T23:00:00Z'),cacheEnabled:false};

test('NCAAF archive uses current SportsDataverse season URLs',()=>{
 assert.match(cfbPlayerBoxUrl(2026),/espn_cfb_player_box\/player_box_2026\.csv$/);
 assert.match(cfbScheduleUrl(2026),/espn_cfb_schedules\/cfb_schedule_2026\.csv$/);
});

test('NCAAF archive returns exact per-game passing values and pair-derived attempts',async()=>{
 const common={sport:'NCAAF',playerName:'Fixture QB',team:'FIX',games:5,gameStartTime:'2026-09-20T12:00:00Z',period:'game'};
 const yards=await fetchCfbStatsArchiveResearch({...common,market:'Passing Yards',providerMarketKey:'player_pass_yds'},deps);
 const attempts=await fetchCfbStatsArchiveResearch({...common,market:'Pass Attempts',providerMarketKey:'player_pass_attempts'},deps);
 assert.equal(yards.available,true);assert.deepEqual(yards.gameLog.map(x=>x.value),[287,241]);
 assert.equal(attempts.available,true);assert.deepEqual(attempts.gameLog.map(x=>x.value),[31,29]);
 assert.equal(yards.gameLog[0].opponent,'OTH');assert.equal(yards.gameLog[0].gameResult,'W');
});

test('NCAAF archive covers receiving, tackles, sacks and kicking without borrowing another stat',async()=>{
 const base={sport:'NCAAF',team:'FIX',games:5,gameStartTime:'2026-09-20T12:00:00Z',period:'game'};
 const rec=await fetchCfbStatsArchiveResearch({...base,playerName:'Fixture WR',market:'Receiving Yards',providerMarketKey:'player_reception_yds'},deps);
 const solo=await fetchCfbStatsArchiveResearch({...base,playerName:'Fixture LB',market:'Solo Tackles',providerMarketKey:'player_solo_tackles'},deps);
 const sacks=await fetchCfbStatsArchiveResearch({...base,playerName:'Fixture LB',market:'Sacks',providerMarketKey:'player_sacks'},deps);
 const kicks=await fetchCfbStatsArchiveResearch({...base,playerName:'Fixture Kicker',market:'Kicking Points',providerMarketKey:'player_kicking_points'},deps);
 assert.deepEqual(rec.gameLog.map(x=>x.value),[112,84]);
 assert.deepEqual(solo.gameLog.map(x=>x.value),[6,4]);
 assert.deepEqual(sacks.gameLog.map(x=>x.value),[1.5,0.5]);
 assert.deepEqual(kicks.gameLog.map(x=>x.value),[9,7]);
});

test('unsupported target history and partial-game periods fail closed',async()=>{
 const base={sport:'NCAAF',playerName:'Fixture WR',team:'FIX',games:5,gameStartTime:'2026-09-20T12:00:00Z'};
 const targets=await fetchCfbStatsArchiveResearch({...base,market:'Targets',providerMarketKey:'player_targets',period:'game'},deps);
 const quarter=await fetchCfbStatsArchiveResearch({...base,market:'Receiving Yards',providerMarketKey:'player_reception_yds',period:'q1'},deps);
 assert.equal(targets.available,false);assert.equal(targets.code,'UNSUPPORTED_MARKET');
 assert.equal(quarter.available,false);assert.equal(quarter.code,'UNSUPPORTED_MARKET');
});
