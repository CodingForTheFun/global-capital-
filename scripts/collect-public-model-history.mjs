import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {PUBLIC_LEAGUES,canonicalSport,marketContract} from '../lib/data-sources/espn/stat-contract.mjs';
import {inspectGameLog} from '../lib/data-sources/espn/research.mjs';

const SPORT=canonicalSport(process.argv[2]);
const OUTPUT=path.resolve(process.argv[3]||`.training-public/${SPORT.toLowerCase()}-history.json`);
const MARKETS=Object.freeze({
  MLB:['batter_hits','batter_total_bases','batter_home_runs','batter_runs','batter_rbis','batter_hits_runs_rbis','batter_doubles','batter_singles','batter_stolen_bases','batter_walks','pitcher_strikeouts','pitcher_hits_allowed','pitcher_earned_runs','pitcher_walks','pitcher_outs'],
  NHL:['player_shots_on_goal','player_goals','player_assists','player_points','player_blocked_shots','player_total_saves','player_goals_against','player_power_play_points'],
  NCAAF:['player_pass_yds','player_pass_tds','player_pass_attempts','player_pass_completions','player_pass_interceptions','player_rush_yds','player_rush_attempts','player_rush_tds','player_reception_yds','player_receptions','player_reception_tds','player_targets','player_rush_reception_yds'],
  NCAAB:['player_points','player_rebounds','player_assists','player_threes','player_blocks','player_steals','player_turnovers','player_points_rebounds_assists','player_points_rebounds','player_points_assists','player_rebounds_assists','player_blocks_steals'],
  MLS:['player_shots','player_shots_on_target','player_goals','player_assists','player_passes_attempted','player_passes_completed','player_tackles'],
  EPL:['player_shots','player_shots_on_target','player_goals','player_assists','player_passes_attempted','player_passes_completed','player_tackles'],
  UCL:['player_shots','player_shots_on_target','player_goals','player_assists','player_passes_attempted','player_passes_completed','player_tackles'],
});
if(!PUBLIC_LEAGUES[SPORT]||!MARKETS[SPORT])throw Error(`Unsupported training sport ${SPORT}`);
const [family,league]=PUBLIC_LEAGUES[SPORT];
const BASE='https://site.api.espn.com/apis/site/v2';
const COMMON='https://site.web.api.espn.com/apis/common/v3';
const teamCap=SPORT==='NCAAF'||SPORT==='NCAAB'?56:SPORT==='UCL'?30:40;
const athleteCap=SPORT==='NCAAF'||SPORT==='NCAAB'?320:SPORT==='MLB'||SPORT==='NHL'?260:220;
const perTeamCap=SPORT==='NCAAF'||SPORT==='NCAAB'?7:12;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function json(url,attempt=0){
  try{
    const res=await fetch(url,{headers:{accept:'application/json','user-agent':'AutoScoutResearchTraining/1.0'},signal:AbortSignal.timeout(12000)});
    if(res.status===429&&attempt<4){await sleep(1000*2**attempt);return json(url,attempt+1);}
    if(!res.ok)return null;return await res.json();
  }catch{if(attempt<2){await sleep(750*2**attempt);return json(url,attempt+1);}return null;}
}
function evenly(items,limit){if(items.length<=limit)return items;const out=[];for(let i=0;i<limit;i++)out.push(items[Math.floor(i*(items.length-1)/(limit-1))]);return out;}
function rosterAthletes(payload){
  const found=new Map();
  function walk(node){
    if(!node||typeof node!=='object')return;
    if(!Array.isArray(node)&&node.id!=null&&typeof node.displayName==='string'&&node.position&&typeof node.position==='object'){
      const id=String(node.id),name=node.displayName.trim(),position=String(node.position.abbreviation||node.position.name||'').toUpperCase();
      if(id&&name)found.set(id,{id,name,position});
    }
    if(Array.isArray(node))for(const value of node)walk(value);else for(const value of Object.values(node))walk(value);
  }
  walk(payload);return [...found.values()];
}
function eligible(a){
  if(SPORT==='NCAAF')return ['QB','RB','WR','TE'].includes(a.position);
  return true;
}
async function pool(limit,items,fn){
  let index=0;const workers=Array.from({length:limit},async()=>{while(index<items.length){const i=index++;await fn(items[i],i);}});await Promise.all(workers);
}
function logUrl(athleteId,category,season){
  const q=new URLSearchParams();if(category)q.set('category',category);if(family==='soccer')q.set('league',league);if(season!=null)q.set('season',String(season));
  return `${COMMON}/sports/${family}/${league}/athletes/${encodeURIComponent(athleteId)}/gamelog${q.size?'?'+q:''}`;
}
function seasonValues(payload){
  const filter=payload?.filters?.find(f=>f.name==='season'),options=Array.isArray(filter?.options)?filter.options:[];
  const current=String(filter?.value??'');
  const values=[current,...options.map(o=>String(o.value??''))].filter(Boolean);
  return [...new Set(values)].slice(0,4);
}
async function main(){
  const teamsPayload=await json(`${BASE}/sports/${family}/${league}/teams?limit=1000`);
  const teams=(teamsPayload?.sports||[]).flatMap(s=>(s.leagues||[]).flatMap(l=>(l.teams||[]).map(x=>x.team))).filter(t=>t?.id);
  if(!teams.length)throw Error('No league teams returned');
  const selectedTeams=evenly(teams,teamCap),athletes=new Map();
  await pool(8,selectedTeams,async team=>{
    const roster=await json(`${BASE}/sports/${family}/${league}/teams/${encodeURIComponent(team.id)}/roster`);
    const list=rosterAthletes(roster).filter(eligible).slice(0,perTeamCap);
    for(const athlete of list)if(athletes.size<athleteCap)athletes.set(athlete.id,{...athlete,teamId:String(team.id),team:team.abbreviation||team.displayName||null});
  });
  const athleteList=[...athletes.values()].slice(0,athleteCap);if(athleteList.length<20)throw Error(`Too few roster athletes: ${athleteList.length}`);
  const byCategory=new Map();
  for(const marketId of MARKETS[SPORT]){const contract=marketContract({sport:SPORT,providerMarketKey:marketId,market:marketId});if(!contract||contract.entityType!=='player')continue;const category=contract.category||'';if(!byCategory.has(category))byCategory.set(category,[]);byCategory.get(category).push({marketId,contract});}
  const records=[],stats={sport:SPORT,league,family,teamsAvailable:teams.length,teamsSampled:selectedTeams.length,athletes:athleteList.length,requests:0,responses:0,recordsByMarket:{},startedAt:new Date().toISOString()};
  await pool(7,athleteList,async athlete=>{
    for(const [category,markets] of byCategory){
      const first=await json(logUrl(athlete.id,category,null));stats.requests++;if(!first)continue;stats.responses++;
      const seasons=seasonValues(first);const payloads=[first];
      for(const season of seasons.slice(1)){const p=await json(logUrl(athlete.id,category,season));stats.requests++;if(p){stats.responses++;payloads.push(p);}}
      for(const payload of payloads)for(const {marketId} of markets){
        const inspected=inspectGameLog(payload,{sport:SPORT,providerMarketKey:marketId,market:marketId,now:Date.now()});
        for(const row of inspected.rows||[]){if(!Number.isFinite(Number(row.value)))continue;records.push({sport:SPORT,marketId,athleteId:athlete.id,athleteName:athlete.name,position:athlete.position,teamId:athlete.teamId,gameId:row.gameId,date:row.date,season:String(row.season??''),seasonType:row.seasonType,value:Number(row.value)});}
      }
    }
  });
  const unique=new Map();for(const r of records)unique.set([r.marketId,r.athleteId,r.gameId].join('|'),r);
  const rows=[...unique.values()].sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)||a.marketId.localeCompare(b.marketId)||a.athleteId.localeCompare(b.athleteId));
  for(const row of rows)stats.recordsByMarket[row.marketId]=(stats.recordsByMarket[row.marketId]||0)+1;
  stats.finishedAt=new Date().toISOString();stats.records=rows.length;
  await mkdir(path.dirname(OUTPUT),{recursive:true});await writeFile(OUTPUT,JSON.stringify({version:1,source:'verified-public-game-logs',stats,records:rows})+'\n');
  console.log(JSON.stringify(stats,null,2));
}
await main();
