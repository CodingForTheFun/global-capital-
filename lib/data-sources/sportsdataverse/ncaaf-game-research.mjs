// Verified NCAAF per-player game history from SportsDataverse's
// stats.ncaa.org-derived NCAA men's football player stats and schedule releases.
// On-demand completed-game research only: never a source of live lines/prices.
import { gunzipSync } from 'node:zlib';
import { normalizePlayerName } from '../contract.mjs';
import { marketContract, numeric } from '../espn/stat-contract.mjs';
import { samePublicTeam } from '../espn/identity.mjs';

const BASE='https://github.com/sportsdataverse/sportsdataverse-data/releases/download';
const TTL_MS=30*60_000;
const MAX_COMPRESSED=5*1024*1024;
const MAX_DECOMPRESSED=40*1024*1024;
const playerCache=new Map(),scheduleCache=new Map();

const FIELD_COLUMN=Object.freeze({
  PassingAttempts:'pass_attempts',
  PassingCompletions:'completions',
  PassingYards:'pass_yards',
  PassingTouchdowns:'pass_tds',
  PassingInterceptions:'interceptions',
  PassingLongestCompletion:'long_pass',
  RushingAttempts:'rush_attempts',
  RushingYards:'yds_rush',
  RushingTouchdowns:'rush_tds',
  RushingLongest:'rush_long',
  Receptions:'rec',
  ReceivingYards:'receiving_yards',
  ReceivingTouchdowns:'rec_td',
  ReceivingLongest:'long_rec',
  Sacks:'sacks',
  SoloTackles:'solo_tack',
  AssistedTackles:'asst_tack',
  TotalTackles:'tackles',
  FieldGoalsMade:'fgm',
});

const text=v=>String(v??'').trim();
const unavailable=(code,message,retryable=false)=>({ok:true,available:false,lineOnly:false,code,message,retryable,gameLog:[]});

export const playerStatsUrl=season=>`${BASE}/ncaa_mfb_player_stats/ncaa_mfb_player_stats_${season}.csv.gz`;
export const scheduleUrl=season=>`${BASE}/ncaa_mfb_schedule/ncaa_mfb_schedule_${season}.csv.gz`;

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
  if(quoted||!rows.length)throw Object.assign(Error('NCAAF_ARCHIVE_CSV_INVALID'),{code:'NCAAF_ARCHIVE_CSV_INVALID'});
  const headers=rows.shift().map(v=>text(v).toLowerCase());
  if(!headers.length||new Set(headers).size!==headers.length)throw Object.assign(Error('NCAAF_ARCHIVE_SCHEMA_INVALID'),{code:'NCAAF_ARCHIVE_SCHEMA_INVALID'});
  return rows.filter(r=>r.some(v=>text(v))).map(values=>Object.fromEntries(headers.map((h,i)=>[h,values[i]??''])));
}

async function fetchGzipCsv(url,{fetcher=globalThis.fetch}={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),10_000);timer.unref?.();
  try{
    const response=await fetcher(url,{method:'GET',redirect:'follow',credentials:'omit',headers:{accept:'application/gzip'},signal:controller.signal});
    if(!response?.ok)throw Object.assign(Error('NCAAF_ARCHIVE_HTTP'),{code:'NCAAF_ARCHIVE_HTTP',status:response?.status||0});
    const length=Number(response.headers?.get?.('content-length'));
    if(Number.isFinite(length)&&length>MAX_COMPRESSED)throw Object.assign(Error('NCAAF_ARCHIVE_TOO_LARGE'),{code:'NCAAF_ARCHIVE_TOO_LARGE'});
    const compressed=Buffer.from(await response.arrayBuffer());
    if(compressed.length>MAX_COMPRESSED)throw Object.assign(Error('NCAAF_ARCHIVE_TOO_LARGE'),{code:'NCAAF_ARCHIVE_TOO_LARGE'});
    const body=gunzipSync(compressed,{maxOutputLength:MAX_DECOMPRESSED}).toString('utf8');
    if(Buffer.byteLength(body,'utf8')>MAX_DECOMPRESSED)throw Object.assign(Error('NCAAF_ARCHIVE_TOO_LARGE'),{code:'NCAAF_ARCHIVE_TOO_LARGE'});
    return parseCsv(body);
  }finally{clearTimeout(timer);}
}

async function loadSeason(kind,season,{now=Date.now,cacheEnabled=true,...deps}={}){
  const cache=kind==='players'?playerCache:scheduleCache,key=String(season),hit=cache.get(key);
  if(cacheEnabled&&hit&&hit.expires>now())return{rows:hit.rows,cached:true};
  const rows=await fetchGzipCsv(kind==='players'?playerStatsUrl(season):scheduleUrl(season),deps);
  const required=kind==='players'
    ?['contest_id','team_id','name','season']
    :['contest_id','team_id','team_name','date','opponent_id','opponent','team_score','opponent_score','season'];
  if(!rows.length||required.some(k=>!Object.hasOwn(rows[0],k)))throw Object.assign(Error('NCAAF_ARCHIVE_SCHEMA_INVALID'),{code:'NCAAF_ARCHIVE_SCHEMA_INVALID'});
  if(cacheEnabled){cache.set(key,{rows,expires:now()+TTL_MS});while(cache.size>4)cache.delete(cache.keys().next().value);}
  return{rows,cached:false};
}

function seasonAt(ms){return new Date(ms).getUTCFullYear();}

function teamNames(scheduleRows,teamId){
  return [...new Set(scheduleRows.filter(r=>text(r.team_id)===text(teamId)).map(r=>text(r.team_name)).filter(Boolean))];
}

function chooseIdentity(rows,schedules,params){
  const wanted=normalizePlayerName(params.playerName);
  const named=rows.filter(r=>text(r.team_id)&&normalizePlayerName(r.name)===wanted);
  if(!named.length)return null;
  const identities=[...new Set(named.map(r=>text(r.team_id)))];
  if(identities.length===1)return{teamId:identities[0],rows:named};
  const candidates=[params.team,params.homeTeam,params.awayTeam].map(text).filter(Boolean);
  const matched=identities.filter(id=>teamNames(schedules,id).some(name=>candidates.some(c=>samePublicTeam(name,c,'NCAAF'))));
  if(matched.length!==1)return null;
  return{teamId:matched[0],rows:named.filter(r=>text(r.team_id)===matched[0])};
}

function oneNumeric(rows,column){
  const values=[...new Set(rows.map(r=>numeric(r[column])).filter(v=>v!==null))];
  return values.length===1?values[0]:null;
}
function fieldValue(rows,field){
  if(field==='TotalTackles'){
    const direct=oneNumeric(rows,'tackles');
    if(direct!==null)return direct;
    const solo=oneNumeric(rows,'solo_tack'),assist=oneNumeric(rows,'asst_tack');
    return solo===null||assist===null?null:solo+assist;
  }
  const column=FIELD_COLUMN[field];
  return column?oneNumeric(rows,column):null;
}
function groupValue(rows,fields){
  let total=0;
  for(const field of fields){
    const value=fieldValue(rows,field);
    if(value===null)return null;
    total+=value;
  }
  return Number(total.toFixed(3));
}

function scheduleIndex(rows){
  const map=new Map();
  for(const r of rows){
    const key=`${text(r.contest_id)}|${text(r.team_id)}`;
    if(text(r.contest_id)&&text(r.team_id))map.set(key,r);
  }
  return map;
}

function normalizeRows(rows,params,fields,schedules,before){
  const byGame=new Map();
  for(const row of rows){
    const contest=text(row.contest_id),team=text(row.team_id);
    if(!contest||!team)continue;
    const key=`${contest}|${team}`;
    if(!byGame.has(key))byGame.set(key,[]);
    byGame.get(key).push(row);
  }
  const schedule=scheduleIndex(schedules),out=[];
  for(const [key,parts] of byGame){
    const game=schedule.get(key);if(!game)continue;
    const value=groupValue(parts,fields);if(value===null)continue;
    const dateMs=Date.parse(text(game.date));
    const teamScore=numeric(game.team_score),opponentScore=numeric(game.opponent_score);
    if(!Number.isFinite(dateMs)||dateMs>=before||teamScore===null||opponentScore===null)continue;
    const contest=text(game.contest_id);
    if(params.eventId&&text(params.eventId)===contest)continue;
    const outcome=text(game.outcome).toUpperCase();
    out.push({
      gameId:`ncaaf:${contest}`,
      date:new Date(dateMs).toISOString(),
      opponent:text(game.opponent)||null,
      opponentId:text(game.opponent_id)?`NCAAF:${text(game.opponent_id)}`:null,
      team:teamNames(schedules,game.team_id)[0]||null,
      teamId:text(game.team_id)?`NCAAF:${text(game.team_id)}`:null,
      isHome:/\bvs\.?\b/i.test(text(game.result))?true:/\b@\b/.test(text(game.result))?false:null,
      scoreFor:teamScore,scoreAgainst:opponentScore,
      gameResult:['W','L','T'].includes(outcome)?outcome:teamScore===opponentScore?'T':teamScore>opponentScore?'W':'L',
      value,season:text(game.season)||text(parts[0]?.season)||null,seasonType:2,statKind:fields.join('+'),
    });
  }
  return out.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
}

export async function fetchNcaaMfbResearch(params={},dependencies={}){
  if(String(params.sport||'').toUpperCase()!=='NCAAF')return null;
  const period=text(params.period).toLowerCase();
  if(period&&!['game','full','full_game','match','single_stat'].includes(period))return unavailable('UNSUPPORTED_MARKET','NCAA archive fallback verifies full-game player statistics only.');
  const contract=marketContract({sport:'NCAAF',market:params.market,providerMarketKey:params.providerMarketKey||params.marketId||null});
  if(!contract||contract.entityType!=='player'||contract.fields.some(f=>!FIELD_COLUMN[f]&&f!=='TotalTackles')){
    return unavailable('UNSUPPORTED_MARKET','NCAA player-stat archive does not expose this exact historical statistic.');
  }
  const clock=dependencies.now||Date.now,now=clock();
  const start=Date.parse(params.gameStartTime||''),before=Number.isFinite(start)?Math.min(now,start):now;
  const season=seasonAt(Number.isFinite(start)?start:now),take=Math.min(40,Math.max(5,Math.floor(Number(params.games)||20)));
  let cached=true,loadError=null;
  const playerRows=[],scheduleRows=[];
  for(const year of [season,season-1]){
    try{
      const [players,schedule]=await Promise.all([loadSeason('players',year,dependencies),loadSeason('schedule',year,dependencies)]);
      cached=cached&&players.cached&&schedule.cached;
      playerRows.push(...players.rows);scheduleRows.push(...schedule.rows);
    }catch(error){loadError=error;break;}
    const identity=chooseIdentity(playerRows,scheduleRows,params);
    if(identity){
      const currentTeam=identity.teamId;
      // Prior-season rows are used only when the same NCAA team identity persists;
      // transfers are not guessed across team IDs.
      const safeRows=identity.rows.filter(r=>text(r.team_id)===currentTeam);
      if(normalizeRows(safeRows,params,contract.fields,scheduleRows,before).length>=take)break;
    }
  }
  if(!playerRows.length&&loadError)return unavailable('RESEARCH_PROVIDER_ERROR','NCAA historical archive is temporarily unavailable. Please retry.',true);
  const identity=chooseIdentity(playerRows,scheduleRows,params);
  if(!identity)return unavailable(loadError?'RESEARCH_PROVIDER_ERROR':'PLAYER_NOT_FOUND',loadError?'NCAA player identity verification is temporarily incomplete. Please retry.':'Player identity could not be verified in the NCAA archive.',Boolean(loadError));
  const safeRows=identity.rows.filter(r=>text(r.team_id)===identity.teamId);
  const gameLog=normalizeRows(safeRows,params,contract.fields,scheduleRows,before).slice(0,take);
  if(!gameLog.length)return unavailable('NO_GAME_LOG_DATA','No verified completed NCAA games contain this exact statistic.');
  return{
    ok:true,available:true,source:'NCAA stats archive via SportsDataverse',cached,entityType:'player',statKind:contract.fields.join('+'),
    player:{playerName:text(identity.rows[0]?.name)||text(params.playerName),providerPlayerId:`ncaa-mfb:${identity.teamId}:${normalizePlayerName(params.playerName)}`,team:text(params.team)||gameLog[0]?.team||null,sport:'NCAAF'},
    opponent:text(params.opponent)||null,opponentId:null,isHome:null,season:String(season),gameLog,
    coverage:{source:'ncaa-mfb-player-stats',complete:false,seasonComplete:false,returnedGames:gameLog.length,fields:[...contract.fields],historyPartial:Boolean(loadError),newestGame:gameLog[0]?.date||null,oldestGame:gameLog.at(-1)?.date||null},
  };
}
