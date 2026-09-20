import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveUrl, parseCsv, fetchWnbaStatsArchiveResearch } from '../lib/data-sources/sportsdataverse/wnba-game-research.mjs';

const header = 'season_id,team_id,team_abbreviation,team_name,game_id,game_date,matchup,wl,min,fgm,fga,fg_pct,fg3m,fg3a,fg3_pct,ftm,fta,ft_pct,oreb,dreb,reb,ast,stl,blk,tov,pf,pts,plus_minus,video_available,season,season_type,player_id,player_name,fantasy_pts,measure_type';
const rows = [
  ['22026','1','ATL','Atlanta','1022600005','2026-09-17','ATL vs. CON','W','25','11','14','.786','1','1','1','7','9','.778','3','7','10','3','0','2','1','2','30','31','1','2026','regular-season','1642291','Angel Reese','55','p'],
  ['22026','1','ATL','Atlanta','1022600004','2026-08-30','ATL vs. MIN','W','33','5','9','.556','0','0','','5','8','.625','3','8','11','2','2','1','5','5','15','15','1','2026','regular-season','1642291','Angel Reese','39','p'],
  ['22026','1','ATL','Atlanta','1022600003','2026-08-28','ATL vs. PDX','L','37','5','14','.357','0','0','','6','8','.750','8','8','16','6','2','0','4','2','16','-10','1','2026','regular-season','1642291','Angel Reese','48','p'],
  ['22026','1','ATL','Atlanta','1022600002','2026-08-24','ATL @ LAS','W','38','4','14','.286','0','0','','3','4','.750','8','18','26','3','3','0','3','5','11','10','1','2026','regular-season','1642291','Angel Reese','56','p'],
  ['22026','1','ATL','Atlanta','1022600001','2026-08-20','ATL @ NYL','L','35','6','13','.462','0','0','','4','6','.667','5','10','15','4','1','1','2','3','16','2','1','2026','regular-season','1642291','Angel Reese','44','p'],
];
const csv = [header, ...rows.map(r => r.map(v => /[,"\n]/.test(v) ? '"'+v.replaceAll('"','""')+'"' : v).join(','))].join('\n');

function source(body = csv) {
  return async url => {
    assert.match(String(url), /player_game_logs_202[56]\.csv$/);
    return new Response(body, { status:200, headers:{ 'content-type':'text/csv', 'content-length':String(Buffer.byteLength(body)) } });
  };
}

test('SportsDataverse WNBA archive URL is season-scoped and public', () => {
  assert.equal(archiveUrl(2026), 'https://github.com/sportsdataverse/sportsdataverse-data/releases/download/wnba_stats_player_game_logs/player_game_logs_2026.csv');
});

test('CSV parser preserves quoted source fields', () => {
  const parsed = parseCsv('player_name,team_name\n"Fixture, Jr.","Atlanta Dream"\n');
  assert.equal(parsed[0].player_name, 'Fixture, Jr.');
  assert.equal(parsed[0].team_name, 'Atlanta Dream');
});

test('WNBA Stats archive returns exact offensive rebounds rather than total rebounds', async () => {
  const result = await fetchWnbaStatsArchiveResearch({
    sport:'WNBA', playerName:'Angel Reese', team:'ATL', market:'Offensive Rebounds',
    providerMarketKey:'player_offensive_rebounds', line:4.5, side:'OVER', games:5,
    gameStartTime:'2026-09-20T00:00:00Z', period:'game',
  }, { fetcher:source(), now:()=>Date.parse('2026-09-19T23:00:00Z'), cacheEnabled:false });
  assert.equal(result.available, true);
  assert.equal(result.source, 'WNBA Stats archive via SportsDataverse');
  assert.deepEqual(result.gameLog.map(x=>x.value), [3,3,8,8,5]);
  assert.equal(result.gameLog[0].rebounds, 10);
  assert.equal(result.gameLog[0].offensiveRebounds, 3);
  assert.equal(result.player.providerPlayerId, 'wnba-stats:1642291');
});

test('WNBA Stats archive covers the screenshot shooting categories with exact source columns', async () => {
  const common = {
    sport:'WNBA', playerName:'Angel Reese', team:'ATL', line:0.5, side:'OVER', games:5,
    gameStartTime:'2026-09-20T00:00:00Z', period:'game',
  };
  const fta = await fetchWnbaStatsArchiveResearch({...common,market:'Free Throws Attempted',providerMarketKey:'player_free_throws_attempted'},
    { fetcher:source(), now:()=>Date.parse('2026-09-19T23:00:00Z'), cacheEnabled:false });
  const fgm = await fetchWnbaStatsArchiveResearch({...common,market:'FG Made',providerMarketKey:'player_fg_made'},
    { fetcher:source(), now:()=>Date.parse('2026-09-19T23:00:00Z'), cacheEnabled:false });
  assert.deepEqual(fta.gameLog.map(x=>x.value), [9,8,8,4,6]);
  assert.deepEqual(fgm.gameLog.map(x=>x.value), [11,5,5,4,6]);
});

test('missing exact statistic is unavailable, never manufactured as zero', async () => {
  const broken = csv.replace(',3,7,10,3,0,2,1,2,30,31,', ',,7,10,3,0,2,1,2,30,31,');
  const result = await fetchWnbaStatsArchiveResearch({
    sport:'WNBA', playerName:'Angel Reese', team:'ATL', market:'Offensive Rebounds',
    providerMarketKey:'player_offensive_rebounds', games:5, gameStartTime:'2026-09-20T00:00:00Z', period:'game',
  }, { fetcher:source(broken), now:()=>Date.parse('2026-09-19T23:00:00Z'), cacheEnabled:false });
  assert.equal(result.available, true);
  assert.equal(result.gameLog.length, 4);
  assert.ok(result.gameLog.every(x=>x.value !== 0));
});

test('wrong identity and partial-game periods fail closed', async () => {
  const wrong = await fetchWnbaStatsArchiveResearch({
    sport:'WNBA', playerName:'Different Player', market:'Offensive Rebounds',
    providerMarketKey:'player_offensive_rebounds', games:5, gameStartTime:'2026-09-20T00:00:00Z', period:'game',
  }, { fetcher:source(), now:()=>Date.parse('2026-09-19T23:00:00Z'), cacheEnabled:false });
  assert.equal(wrong.available, false);
  assert.equal(wrong.code, 'PLAYER_NOT_FOUND');

  const period = await fetchWnbaStatsArchiveResearch({
    sport:'WNBA', playerName:'Angel Reese', market:'Offensive Rebounds',
    providerMarketKey:'player_offensive_rebounds', period:'q1',
  }, { fetcher:source(), now:()=>Date.parse('2026-09-19T23:00:00Z'), cacheEnabled:false });
  assert.equal(period.available, false);
  assert.equal(period.code, 'UNSUPPORTED_MARKET');
});
