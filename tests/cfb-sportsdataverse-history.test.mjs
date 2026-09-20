import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { cfbPlayerUrl, cfbScheduleUrl, parseCfbCsv, fetchSportsDataverseCfbResearch } from '../lib/data-sources/sportsdataverse/cfb-game-research.mjs';

const PH=['game_id','season','week','team_id','category','athlete_id','athlete_name','completions_passing_attempts','passing_yards','passing_touchdowns','interceptions','rushing_attempts','rushing_yards','rushing_touchdowns','long_rushing','total_tackles','solo_tackles','sacks'];
const SH=['game_id','season','season_type','game_date','home_id','home_team','home_abbreviation','home_score','away_id','away_team','away_abbreviation','away_score','status_type_name','status_type_completed'];
const csv=(h,rows)=>[h.join(','),...rows.map(x=>h.map(k=>String(x[k]??'')).join(','))].join('\n');
const p26=csv(PH,[
 {game_id:'401000002',season:2026,week:2,team_id:59,category:'passing',athlete_id:999001,athlete_name:'Fixture Quarterback',completions_passing_attempts:'22/31',passing_yards:278,passing_touchdowns:2,interceptions:1},
 {game_id:'401000002',season:2026,week:2,team_id:59,category:'rushing',athlete_id:999001,athlete_name:'Fixture Quarterback',rushing_attempts:4,rushing_yards:24,rushing_touchdowns:0,long_rushing:17},
 {game_id:'401000001',season:2026,week:1,team_id:59,category:'passing',athlete_id:999001,athlete_name:'Fixture Quarterback',completions_passing_attempts:'19/27',passing_yards:241,passing_touchdowns:1,interceptions:0},
 {game_id:'401000001',season:2026,week:1,team_id:59,category:'rushing',athlete_id:999001,athlete_name:'Fixture Quarterback',rushing_attempts:5,rushing_yards:31,rushing_touchdowns:1,long_rushing:14},
 {game_id:'401000002',season:2026,week:2,team_id:59,category:'defensive',athlete_id:999002,athlete_name:'Fixture Defender',total_tackles:7,solo_tackles:5,sacks:1.5},
]);
const p25=csv(PH,[
 {game_id:'401900018',season:2025,week:18,team_id:59,category:'passing',athlete_id:999001,athlete_name:'Fixture Quarterback',completions_passing_attempts:'25/34',passing_yards:301,passing_touchdowns:3,interceptions:0},
 {game_id:'401900018',season:2025,week:18,team_id:59,category:'rushing',athlete_id:999001,athlete_name:'Fixture Quarterback',rushing_attempts:2,rushing_yards:8,rushing_touchdowns:0,long_rushing:6},
]);
const s26=csv(SH,[
 {game_id:'401000002',season:2026,season_type:2,game_date:'2026-09-13T19:30:00Z',home_id:59,home_team:'Georgia Tech Yellow Jackets',home_abbreviation:'GT',home_score:27,away_id:228,away_team:'Clemson Tigers',away_abbreviation:'CLEM',away_score:20,status_type_name:'STATUS_FINAL',status_type_completed:'true'},
 {game_id:'401000001',season:2026,season_type:2,game_date:'2026-09-06T19:30:00Z',home_id:228,home_team:'Clemson Tigers',home_abbreviation:'CLEM',home_score:21,away_id:59,away_team:'Georgia Tech Yellow Jackets',away_abbreviation:'GT',away_score:24,status_type_name:'STATUS_FINAL',status_type_completed:'true'},
]);
const s25=csv(SH,[{game_id:'401900018',season:2025,season_type:3,game_date:'2026-01-02T18:00:00Z',home_id:59,home_team:'Georgia Tech Yellow Jackets',home_abbreviation:'GT',home_score:31,away_id:153,away_team:'North Carolina Tar Heels',away_abbreviation:'UNC',away_score:14,status_type_name:'STATUS_FINAL',status_type_completed:'true'}]);
function source(){return async url=>{const u=String(url);if(u.includes('_2026.csv.gz'))return new Response('',{status:404});let body,gz=false;if(u.endsWith('player_box_2026.csv'))body=p26;else if(u.endsWith('cfb_schedule_2026.csv'))body=s26;else if(u.endsWith('player_box_2025.csv.gz')){body=p25;gz=true;}else if(u.endsWith('cfb_schedule_2025.csv.gz')){body=s25;gz=true;}else return new Response('',{status:404});const payload=gz?gzipSync(Buffer.from(body)):Buffer.from(body);return new Response(payload,{status:200,headers:{'content-length':String(payload.length)}});};}
const deps=()=>({fetcher:source(),now:()=>Date.parse('2026-09-19T23:00:00Z'),cacheEnabled:false});
const common={sport:'NCAAF',team:'GT',games:5,gameStartTime:'2026-09-20T20:00:00Z',period:'game'};

test('CFB release URLs fall back from missing current gzip to current CSV',()=>{assert.equal(cfbPlayerUrl(2026,true),'https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_cfb_player_box/player_box_2026.csv.gz');assert.equal(cfbScheduleUrl(2026,false),'https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_cfb_schedules/cfb_schedule_2026.csv');});
test('CFB CSV parser preserves quoted athlete names',()=>{assert.equal(parseCfbCsv('athlete_id,athlete_name\n1,"Fixture, Jr."\n')[0].athlete_name,'Fixture, Jr.');});
test('NCAAF archive returns exact passing yards across current and prior season',async()=>{const r=await fetchSportsDataverseCfbResearch({...common,playerName:'Fixture Quarterback',market:'Passing Yards',providerMarketKey:'player_pass_yds'},deps());assert.equal(r.available,true);assert.deepEqual(r.gameLog.map(x=>x.value),[278,241,301]);assert.equal(r.player.providerPlayerId,'espn:999001');});
test('NCAAF archive sums exact passing plus rushing yards per game',async()=>{const r=await fetchSportsDataverseCfbResearch({...common,playerName:'Fixture Quarterback',market:'Passing + Rushing Yards',providerMarketKey:'player_pass_rush_yds'},deps());assert.equal(r.available,true);assert.deepEqual(r.gameLog.map(x=>x.value),[302,272,309]);});
test('NCAAF defensive assists derive only from total minus solo tackles',async()=>{const r=await fetchSportsDataverseCfbResearch({...common,playerName:'Fixture Defender',market:'Assists',providerMarketKey:'player_assists'},deps());assert.equal(r.available,true);assert.deepEqual(r.gameLog.map(x=>x.value),[2]);});
test('NCAAF unsupported targets and partial-game markets fail closed',async()=>{const a=await fetchSportsDataverseCfbResearch({...common,playerName:'Fixture Quarterback',market:'Receiving Targets',providerMarketKey:'player_targets'},deps());assert.equal(a.available,false);assert.equal(a.code,'UNSUPPORTED_MARKET');const b=await fetchSportsDataverseCfbResearch({...common,playerName:'Fixture Quarterback',market:'Passing Yards',providerMarketKey:'player_pass_yds',period:'q1'},deps());assert.equal(b.available,false);assert.equal(b.code,'UNSUPPORTED_MARKET');});
