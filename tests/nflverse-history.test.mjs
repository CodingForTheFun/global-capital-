import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { statsUrl, parseCsv, fetchNflverseResearch } from '../lib/data-sources/nflverse/nfl-game-research.mjs';

const statsHeader='player_id,player_name,player_display_name,position,position_group,season,week,season_type,team,opponent_team,completions,attempts,passing_yards,passing_tds,passing_interceptions,carries,rushing_yards,rushing_tds,targets,receptions,receiving_yards,receiving_tds,sacks_suffered,def_tackles_solo,def_tackle_assists,def_sacks,fg_made,pat_made';
const statsRows=[
 ['00-0099999','F.Player','Fixture Player','QB','QB','2026','2','REG','ATL','CAR','22','31','278','2','1','4','24','0','0','0','0','0','2','0','0','0','0','0'],
 ['00-0099999','F.Player','Fixture Player','QB','QB','2026','1','REG','ATL','TB','19','27','241','1','0','5','31','1','0','0','0','0','1','0','0','0','0','0'],
 ['00-0099999','F.Player','Fixture Player','QB','QB','2025','18','REG','ATL','NO','25','34','301','3','0','2','8','0','0','0','0','0','3','0','0','0','0','0'],
];
const scheduleHeader='game_id,season,game_type,week,gameday,away_team,away_score,home_team,home_score';
const scheduleRows=[
 ['2026_02_CAR_ATL','2026','REG','2','2026-09-13','CAR','20','ATL','27'],
 ['2026_01_ATL_TB','2026','REG','1','2026-09-06','ATL','24','TB','21'],
 ['2025_18_NO_ATL','2025','REG','18','2026-01-04','NO','14','ATL','31'],
];
const csv=(header,rows)=>[header,...rows.map(r=>r.join(','))].join('\n');
const stats2026=csv(statsHeader,statsRows.filter(r=>r[5]==='2026'));
const stats2025=csv(statsHeader,statsRows.filter(r=>r[5]==='2025'));
const schedule=csv(scheduleHeader,scheduleRows);

function source(){
 return async url=>{
  const u=String(url);
  let body;
  if(u.includes('stats_player_week_2026'))body=stats2026;
  else if(u.includes('stats_player_week_2025'))body=stats2025;
  else if(u.endsWith('/schedules/games.csv.gz'))body=schedule;
  else return new Response('',{status:404});
  const gz=gzipSync(Buffer.from(body));
  return new Response(gz,{status:200,headers:{'content-type':'application/gzip','content-length':String(gz.length)}});
 };
}

test('nflverse stats URL is season-scoped',()=>{
 assert.equal(statsUrl(2026),'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2026.csv.gz');
});

test('nflverse CSV parser preserves quoted names',()=>{
 const parsed=parseCsv('player_id,player_display_name\n1,"Fixture, Jr."\n');
 assert.equal(parsed[0].player_display_name,'Fixture, Jr.');
});

test('NFL archive returns verified passing yards across current and prior season',async()=>{
 const result=await fetchNflverseResearch({
  sport:'NFL',playerName:'Fixture Player',team:'ATL',market:'Passing Yards',providerMarketKey:'player_pass_yds',
  games:5,gameStartTime:'2026-09-20T20:00:00Z',period:'game',
 },{fetcher:source(),now:()=>Date.parse('2026-09-19T23:00:00Z'),cacheEnabled:false});
 assert.equal(result.available,true);
 assert.equal(result.source,'nflverse weekly player stats');
 assert.deepEqual(result.gameLog.map(x=>x.value),[278,241,301]);
 assert.deepEqual(result.gameLog.map(x=>x.opponent),['CAR','TB','NO']);
 assert.equal(result.player.providerPlayerId,'nflverse:00-0099999');
});

test('NFL archive sums exact combo components without borrowing another market',async()=>{
 const result=await fetchNflverseResearch({
  sport:'NFL',playerName:'Fixture Player',team:'ATL',market:'Passing + Rushing Yards',providerMarketKey:'player_pass_rush_yds',
  games:5,gameStartTime:'2026-09-20T20:00:00Z',period:'game',
 },{fetcher:source(),now:()=>Date.parse('2026-09-19T23:00:00Z'),cacheEnabled:false});
 assert.deepEqual(result.gameLog.map(x=>x.value),[302,272,309]);
});

test('unsupported longest-play and partial-game markets fail closed',async()=>{
 const common={sport:'NFL',playerName:'Fixture Player',team:'ATL',games:5,gameStartTime:'2026-09-20T20:00:00Z'};
 const longest=await fetchNflverseResearch({...common,market:'Longest Completion',providerMarketKey:'player_pass_longest_completion',period:'game'},{fetcher:source(),now:()=>Date.parse('2026-09-19T23:00:00Z'),cacheEnabled:false});
 assert.equal(longest.available,false);
 assert.equal(longest.code,'UNSUPPORTED_MARKET');
 const period=await fetchNflverseResearch({...common,market:'Passing Yards',providerMarketKey:'player_pass_yds',period:'q1'},{fetcher:source(),now:()=>Date.parse('2026-09-19T23:00:00Z'),cacheEnabled:false});
 assert.equal(period.available,false);
 assert.equal(period.code,'UNSUPPORTED_MARKET');
});
