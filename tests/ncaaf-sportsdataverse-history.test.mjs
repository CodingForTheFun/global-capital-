import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { playerStatsUrl, scheduleUrl, parseCsv, fetchNcaaMfbResearch } from '../lib/data-sources/sportsdataverse/ncaaf-game-research.mjs';

const pHeader='contest_id,team_id,number,name,position,rush_attempts,rush_yds_gained,rush_yds_lost,yds_rush,rush_tds,rush_long,category,espn_game_id,pass_attempts,completions,pass_yards,interceptions,pass_tds,pass_eff,yds_per_completion,pct,long_pass,rec,receiving_yards,yards_per_reception,rec_td,long_rec,yds,plays,pbu,int,intyds,int_ret_tds,pdef,ko_ret,ko_ret_yds,kick_ret_tds,long_kor,sacks,solo_tack,asst_tack,tackles,fgm,fga,fg_blocks_allowed,punt_ret,punt_ret_yds,punt_ret_tds,long_pr,season';
const pRows=[
 ['c3','101','7','Fixture Player','QB','4','21','0','21','0','12','rushing','e3','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','2026'],
 ['c3','101','7','Fixture Player','QB','','','','','','','passing','e3','31','22','278','1','2','','','','42','','','','','','','','','','','','','','','','','','','','','','','','','','','','2026'],
 ['c2','101','7','Fixture Player','QB','5','31','0','31','1','15','rushing','e2','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','2026'],
 ['c2','101','7','Fixture Player','QB','','','','','','','passing','e2','27','19','241','0','1','','','','35','','','','','','','','','','','','','','','','','','','','','','','','','','','','2026'],
 ['c1','101','7','Fixture Player','QB','2','8','0','8','0','7','rushing','e1','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','2026'],
 ['c1','101','7','Fixture Player','QB','','','','','','','passing','e1','34','25','301','0','3','','','','51','','','','','','','','','','','','','','','','','','','','','','','','','','','','2026'],
];
const sHeader='team_id,team_name,date,opponent_id,opponent,result,outcome,team_score,opponent_score,contest_id,attendance,academic_year,espn_game_id,season';
const sRows=[
 ['101','Fixture State','2026-09-12','202','Carolina','W 27-20','W','27','20','c3','','2026','e3','2026'],
 ['101','Fixture State','2026-09-05','203','Tampa College','W 24-21','W','24','21','c2','','2026','e2','2026'],
 ['101','Fixture State','2026-08-29','204','New Orleans U','W 31-14','W','31','14','c1','','2026','e1','2026'],
];
const csv=(h,rows)=>[h,...rows.map(r=>r.join(','))].join('\n');
const pCsv=csv(pHeader,pRows),sCsv=csv(sHeader,sRows);
function source(){
 return async url=>{
  const u=String(url),body=u.includes('ncaa_mfb_player_stats_2026')?pCsv:u.includes('ncaa_mfb_schedule_2026')?sCsv:
    u.includes('2025')?(u.includes('player_stats')?pHeader:sHeader):null;
  if(body==null)return new Response('',{status:404});
  const gz=gzipSync(Buffer.from(body));
  return new Response(gz,{status:200,headers:{'content-type':'application/gzip','content-length':String(gz.length)}});
 };
}

test('NCAA SportsDataverse URLs are season-scoped',()=>{
 assert.equal(playerStatsUrl(2026),'https://github.com/sportsdataverse/sportsdataverse-data/releases/download/ncaa_mfb_player_stats/ncaa_mfb_player_stats_2026.csv.gz');
 assert.equal(scheduleUrl(2026),'https://github.com/sportsdataverse/sportsdataverse-data/releases/download/ncaa_mfb_schedule/ncaa_mfb_schedule_2026.csv.gz');
});

test('NCAA CSV parser preserves quoted names',()=>{
 const parsed=parseCsv('name,team_id\n"Fixture, Jr.",101\n');
 assert.equal(parsed[0].name,'Fixture, Jr.');
});

test('NCAAF archive returns verified passing yards by completed game',async()=>{
 const result=await fetchNcaaMfbResearch({
  sport:'NCAAF',playerName:'Fixture Player',team:'Fixture State',market:'Passing Yards',providerMarketKey:'player_pass_yds',
  games:5,gameStartTime:'2026-09-20T20:00:00Z',period:'game',
 },{fetcher:source(),now:()=>Date.parse('2026-09-19T23:00:00Z'),cacheEnabled:false});
 assert.equal(result.available,true);
 assert.equal(result.source,'NCAA stats archive via SportsDataverse');
 assert.deepEqual(result.gameLog.map(x=>x.value),[278,241,301]);
 assert.deepEqual(result.gameLog.map(x=>x.opponent),['Carolina','Tampa College','New Orleans U']);
});

test('NCAAF archive computes exact passing+rushing combo from category rows',async()=>{
 const result=await fetchNcaaMfbResearch({
  sport:'NCAAF',playerName:'Fixture Player',team:'Fixture State',market:'Passing + Rushing Yards',providerMarketKey:'player_pass_rush_yds',
  games:5,gameStartTime:'2026-09-20T20:00:00Z',period:'game',
 },{fetcher:source(),now:()=>Date.parse('2026-09-19T23:00:00Z'),cacheEnabled:false});
 assert.deepEqual(result.gameLog.map(x=>x.value),[299,272,309]);
});

test('NCAAF archive supports exact longest passing play but refuses unsupported period scope',async()=>{
 const common={sport:'NCAAF',playerName:'Fixture Player',team:'Fixture State',games:5,gameStartTime:'2026-09-20T20:00:00Z'};
 const longest=await fetchNcaaMfbResearch({...common,market:'Longest Completion',providerMarketKey:'player_pass_longest_completion',period:'game'},{fetcher:source(),now:()=>Date.parse('2026-09-19T23:00:00Z'),cacheEnabled:false});
 assert.equal(longest.available,true);assert.deepEqual(longest.gameLog.map(x=>x.value),[42,35,51]);
 const q1=await fetchNcaaMfbResearch({...common,market:'Passing Yards',providerMarketKey:'player_pass_yds',period:'q1'},{fetcher:source(),now:()=>Date.parse('2026-09-19T23:00:00Z'),cacheEnabled:false});
 assert.equal(q1.available,false);assert.equal(q1.code,'UNSUPPORTED_MARKET');
});
