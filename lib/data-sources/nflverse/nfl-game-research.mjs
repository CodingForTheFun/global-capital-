// Verified NFL per-player game history from nflverse weekly player stats.
// nflverse-data is CC BY 4.0 and is updated throughout the NFL season.
// This is an on-demand completed-game research fallback only. It never supplies
// current prop lines, prices, books, DFS multipliers or provider freshness.
import { gunzipSync } from 'node:zlib';
import { normalizePlayerName } from '../contract.mjs';
import { marketContract, numeric } from '../espn/stat-contract.mjs';
import { samePublicTeam } from '../espn/identity.mjs';

const STATS_RELEASE='https://github.com/nflverse/nflverse-data/releases/download/stats_player';
const SCHEDULE_RELEASE='https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv.gz';
const TTL_MS=30*60_000;
const MAX_COMPRESSED=3*1024*1024;
const MAX_DECOMPRESSED=12*1024*1024;
const statsCache=new Map();
let scheduleCache=null;

const FIELD_COLUMN=Object.freeze({
  PassingAttempts:'attempts',
  PassingCompletions:'completions',
  PassingYards:'passing_yards',
  PassingTouchdowns:'passing_tds',
  PassingInterceptions:'passing_interceptions',
  RushingAttempts:'carries',
  RushingYards:'rushing_yards',
  RushingTouchdowns:'rushing_tds',
  Receptions:'receptions',
  ReceivingYards:'receiving_yards',
  ReceivingTargets:'targets',
  ReceivingTouchdowns:'receiving_tds',
  SacksTaken:'sacks_suffered',
  Sacks:'def_sacks',
  SoloTackles:'def_tackles_solo',
  AssistedTackles:'def_tackle_assists',
  FieldGoalsMade:'fg_made',
  ExtraPointsMade:'pat_made',
});

const text=v=>String(v??'').trim();
const unavailable=(code,message,retryable=false)=>({ok:true,available:false,lineOnly:false,code,message,retryable,gameLog:[]});

export function parseCsv(input=''){
  const rows=[];let row=[],field='',quoted=false;
  const source=String(input).replace(/^\uFEFF/,'');
  for(let i=0;i<source.length;i++){
    const ch=source[i];
    if(quoted){
      if(ch==='"'){if(source[i+1]==='"'){field+='"';i++;}else quoted=false;}
      else field+=ch;
      continue;
    }
    if(ch==='"')quoted=true;
    else if(ch===','){row.push(field);field='';}
    else if(ch==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';}
    else field+=ch;
  }
  if(field.length||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}
  if(quoted||!rows.length)throw Object.assign(Error('NFLVERSE_CSV_INVALID'),{code:'NFLVERSE_CSV_INVALID'});
  const headers=rows.shift().map(v=>text(v).toLowerCase());
  if(!headers.length||new Set(headers).size!==headers.length)throw Object.assign(Error('NFLVERSE_SCHEMA_INVALID'),{code:'NFLVERSE_SCHEMA_INVALID'});
  return rows.filter(r=>r.some(v=>text(v))).map(values=>Object.fromEntries(headers.map((h,i)=>[h,values[i]??''])));
}

export const statsUrl=season=>`${STATS_RELEASE}/stats_player_week_${season}.csv.gz`;

async function fetchGzipCsv(url,{fetcher=globalThis.fetch}={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),10_000);timer.unref?.();
  try{
    const response=await fetcher(url,{method:'GET',redirect:'follow',credentials:'omit',headers:{accept:'application/gzip'},signal:controller.signal});
    if(!response?.ok)throw Object.assign(Error('NFLVERSE_HTTP'),{code:'NFLVERSE_HTTP',status:response?.status||0});
    const size=Number(response.headers?.get?.('content-length'));
    if(Number.isFinite(size)&&size>MAX_COMPRESSED)throw Object.assign(Error('NFLVERSE_RESPONSE_TOO_LARGE'),{code:'NFLVERSE_RESPONSE_TOO_LARGE'});
    const compressed=Buffer.from(await response.arrayBuffer());
    if(compressed.length>MAX_COMPRESSED)throw Object.assign(Error('NFLVERSE_RESPONSE_TOO_LARGE'),{code:'NFLVERSE_RESPONSE_TOO_LARGE'});
    const body=gunzipSync(compressed,{maxOutputLength:MAX_DECOMPRESSED}).toString('utf8');
    if(Buffer.byteLength(body,'utf8')>MAX_DECOMPRESSED)throw Object.assign(Error('NFLVERSE_RESPONSE_TOO_LARGE'),{code:'NFLVERSE_RESPONSE_TOO_LARGE'});
    return parseCsv(body);
  }finally{clearTimeout(timer);}
}

async function loadStats(season,{now=Date.now,cacheEnabled=true,...deps}={}){
  const key=String(season),hit=statsCache.get(key);
  if(cacheEnabled&&hit&&hit.expires>now())return{rows:hit.rows,cached:true};
  const rows=await fetchGzipCsv(statsUrl(season),deps);
  const required=['player_id','player_display_name','season','week','recent_team','opponent_team'];
  if(!rows.length||required.some(k=>!Object.hasOwn(rows[0],k)))throw Object.assign(Error('NFLVERSE_SCHEMA_INVALID'),{code:'NFLVERSE_SCHEMA_INVALID'});
  if(cacheEnabled){statsCache.set(key,{rows,expires:now()+TTL_MS});while(statsCache.size>4)statsCache.delete(statsCache.keys().next().value);}
  return{rows,cached:false};
}

async function loadSchedule({now=Date.now,cacheEnabled=true,...deps}={}){
  if(cacheEnabled&&scheduleCache&&scheduleCache.expires>now())return{rows:scheduleCache.rows,cached:true};
  const rows=await fetchGzipCsv(SCHEDULE_RELEASE,deps);
  const required=['game_id','season','week','gameday','away_team','home_team','away_score','home_score'];
  if(!rows.length||required.some(k=>!Object.hasOwn(rows[0],k)))throw Object.assign(Error('NFLVERSE_SCHEDULE_SCHEMA_INVALID'),{code:'NFLVERSE_SCHEDULE_SCHEMA_INVALID'});
  if(cacheEnabled)scheduleCache={rows,expires:now()+TTL_MS};
  return{rows,cached:false};
}

function nflSeasonAt(ms){
  const d=new Date(ms);
  const year=d.getUTCFullYear(),month=d.getUTCMonth()+1;
  return month<=2?year-1:year;
}
function gsisId(value){const v=text(value);return /^00-\d{7}$/.test(v)?v:null;}

function chooseIdentity(rows,params){
  const direct=gsisId(params.providerPlayerId);
  if(direct){
    const exact=rows.filter(r=>text(r.player_id)===direct);
    if(exact.length)return{id:direct,rows:exact};
  }
  const wanted=normalizePlayerName(params.playerName);
  const named=rows.filter(r=>r.player_id&&normalizePlayerName(r.player_display_name||r.player_name)===wanted);
  if(!named.length)return null;
  const ids=[...new Set(named.map(r=>text(r.player_id)).filter(Boolean))];
  if(ids.length===1)return{id:ids[0],rows:named};
  const team=text(params.team);
  if(!team)return null;
  const teamIds=[...new Set(named.filter(r=>samePublicTeam(r.recent_team,team,'NFL')).map(r=>text(r.player_id)).filter(Boolean))];
  if(teamIds.length!==1)return null;
  return{id:teamIds[0],rows:named.filter(r=>text(r.player_id)===teamIds[0])};
}

function fieldValue(row,field){
  if(field==='TotalTackles'){
    const solo=numeric(row.def_tackles_solo),assist=numeric(row.def_tackle_assists);
    return solo===null||assist===null?null:solo+assist;
  }
  if(field==='KickingPoints'){
    const fg=numeric(row.fg_made),pat=numeric(row.pat_made);
    return fg===null||pat===null?null:3*fg+pat;
  }
  const column=FIELD_COLUMN[field];
  return column?numeric(row[column]):null;
}
function rowValue(row,fields){
  let total=0;
  for(const field of fields){
    const value=fieldValue(row,field);
    if(value===null)return null;
    total+=value;
  }
  return Number(total.toFixed(3));
}

function scheduleIndex(rows){
  const byId=new Map(),byMatch=new Map();
  for(const g of rows){
    const id=text(g.game_id);
    if(id)byId.set(id,g);
    const season=Number(g.season),week=Number(g.week),away=text(g.away_team),home=text(g.home_team);
    if(Number.isFinite(season)&&Number.isFinite(week)&&away&&home){
      byMatch.set(JSON.stringify([season,week,away,home]),g);
      byMatch.set(JSON.stringify([season,week,home,away]),g);
    }
  }
  return{byId,byMatch};
}
function findGame(row,index){
  const id=text(row.game_id);
  if(id&&index.byId.has(id))return index.byId.get(id);
  return index.byMatch.get(JSON.stringify([Number(row.season),Number(row.week),text(row.recent_team),text(row.opponent_team)]))||null;
}

function normalizeRows(rows,params,fields,schedule,before){
  const out=new Map(),conflicts=new Set(),index=scheduleIndex(schedule);
  for(const row of rows){
    const value=rowValue(row,fields);
    if(value===null)continue;
    const game=findGame(row,index);
    if(!game)continue;
    const awayScore=numeric(game.away_score),homeScore=numeric(game.home_score);
    const dateMs=Date.parse(`${text(game.gameday)}T12:00:00Z`);
    if(!text(game.game_id)||!Number.isFinite(dateMs)||dateMs>=before||awayScore===null||homeScore===null)continue;
    if(params.eventId&&text(params.eventId)===text(game.game_id))continue;
    const team=text(row.recent_team),away=text(game.away_team),home=text(game.home_team);
    const isHome=samePublicTeam(team,home,'NFL')?true:samePublicTeam(team,away,'NFL')?false:null;
    if(isHome===null)continue;
    const scoreFor=isHome?homeScore:awayScore,scoreAgainst=isHome?awayScore:homeScore;
    const normalized={
      gameId:`nfl:${text(game.game_id)}`,
      date:new Date(dateMs).toISOString(),
      opponent:text(row.opponent_team)||null,
      opponentId:null,
      team:team||null,
      isHome,
      scoreFor,scoreAgainst,
      gameResult:scoreFor===scoreAgainst?'T':scoreFor>scoreAgainst?'W':'L',
      value,
      season:text(row.season)||null,
      seasonType:text(row.season_type).toUpperCase()==='POST'||text(game.game_type).toUpperCase()!=='REG'?3:2,
      statKind:fields.join('+'),
    };
    if(conflicts.has(normalized.gameId))continue;
    const prior=out.get(normalized.gameId);
    if(!prior||prior.value===normalized.value)out.set(normalized.gameId,normalized);
    else{conflicts.add(normalized.gameId);out.delete(normalized.gameId);}
  }
  return[...out.values()].sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
}

export async function fetchNflverseResearch(params={},dependencies={}){
  if(String(params.sport||'').toUpperCase()!=='NFL')return null;
  const period=text(params.period).toLowerCase();
  if(period&&!['game','full','full_game','match','single_stat'].includes(period))return unavailable('UNSUPPORTED_MARKET','nflverse weekly stats verify full-game player statistics only.');
  const contract=marketContract({sport:'NFL',market:params.market,providerMarketKey:params.providerMarketKey||params.marketId||null});
  if(!contract||contract.entityType!=='player'||contract.fields.some(f=>f!=='TotalTackles'&&f!=='KickingPoints'&&!FIELD_COLUMN[f])){
    return unavailable('UNSUPPORTED_MARKET','nflverse weekly stats do not expose this exact historical statistic.');
  }
  const clock=dependencies.now||Date.now,now=clock();
  const gameStart=Date.parse(params.gameStartTime||'');
  const before=Number.isFinite(gameStart)?Math.min(now,gameStart):now;
  const season=nflSeasonAt(Number.isFinite(gameStart)?gameStart:now);
  const take=Math.min(40,Math.max(5,Math.floor(Number(params.games)||20)));
  const loaded=[];let cached=true,loadError=null,schedule;
  try{schedule=await loadSchedule(dependencies);cached=cached&&schedule.cached;}
  catch(error){return unavailable('RESEARCH_PROVIDER_ERROR','NFL weekly schedule archive is temporarily unavailable. Please retry.',true);}
  for(const year of [season,season-1]){
    try{
      const snapshot=await loadStats(year,dependencies);
      cached=cached&&snapshot.cached;loaded.push(...snapshot.rows);
    }catch(error){loadError ||= error;continue;}
    const identity=chooseIdentity(loaded,params);
    if(identity&&normalizeRows(identity.rows,params,contract.fields,schedule.rows,before).length>=take)break;
  }
  if(!loaded.length&&loadError)return unavailable('RESEARCH_PROVIDER_ERROR','NFL weekly player-stat archive is temporarily unavailable. Please retry.',true);
  const identity=chooseIdentity(loaded,params);
  if(!identity)return unavailable(loadError?'RESEARCH_PROVIDER_ERROR':'PLAYER_NOT_FOUND',loadError?'NFL player identity verification is temporarily incomplete. Please retry.':'Player identity could not be verified in nflverse.',Boolean(loadError));
  const gameLog=normalizeRows(identity.rows,params,contract.fields,schedule.rows,before).slice(0,take);
  if(!gameLog.length)return unavailable('NO_GAME_LOG_DATA','No verified completed NFL games contain this exact statistic.');
  return{
    ok:true,available:true,source:'nflverse weekly player stats',cached,entityType:'player',statKind:contract.fields.join('+'),
    player:{playerName:text(identity.rows[0]?.player_display_name||identity.rows[0]?.player_name)||text(params.playerName),providerPlayerId:`nflverse:${identity.id}`,team:text(params.team)||text(gameLog[0]?.team)||null,sport:'NFL'},
    opponent:text(params.opponent)||null,opponentId:null,isHome:null,season:String(season),gameLog,
    coverage:{source:'nflverse-stats-player-week',complete:false,seasonComplete:false,returnedGames:gameLog.length,fields:[...contract.fields],historyPartial:Boolean(loadError),newestGame:gameLog[0]?.date||null,oldestGame:gameLog.at(-1)?.date||null},
  };
}
