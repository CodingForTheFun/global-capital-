// Verified NCAAF completed-game player history from SportsDataverse's ESPN CFB releases.
// This fallback never supplies current lines, prices, books, DFS multipliers, or freshness.
import { gunzipSync } from 'node:zlib';
import { normalizePlayerName } from '../contract.mjs';
import { marketContract, numeric } from '../espn/stat-contract.mjs';
import { samePublicTeam } from '../espn/identity.mjs';

const PLAYER_BASE='https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_cfb_player_box';
const SCHEDULE_BASE='https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_cfb_schedules';
const TTL_MS=30*60_000, MAX_COMPRESSED=3*1024*1024, MAX_RAW=16*1024*1024;
const cache=new Map();
const SUPPORTED=new Set([
 'PassingAttempts','PassingCompletions','PassingYards','PassingTouchdowns','PassingInterceptions',
 'RushingAttempts','RushingYards','RushingTouchdowns','RushingLongest',
 'Receptions','ReceivingYards','ReceivingTouchdowns','ReceivingLongest',
 'TotalTackles','SoloTackles','AssistedTackles','Sacks','DefensiveInterceptions',
 'FieldGoalsMade','ExtraPointsMade','KickingPoints','Punts','PuntsInside20',
]);
const text=v=>String(v??'').trim();
const unavailable=(code,message,retryable=false)=>({ok:true,available:false,lineOnly:false,code,message,retryable,gameLog:[]});

export function parseCfbCsv(input=''){
 const rows=[];let row=[],field='',quoted=false;
 const source=String(input).replace(/^\uFEFF/,'');
 for(let i=0;i<source.length;i++){
  const ch=source[i];
  if(quoted){if(ch==='"'){if(source[i+1]==='"'){field+='"';i++;}else quoted=false;}else field+=ch;continue;}
  if(ch==='"')quoted=true;
  else if(ch===','){row.push(field);field='';}
  else if(ch==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';}
  else field+=ch;
 }
 if(field.length||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}
 if(quoted||!rows.length)throw Object.assign(Error('CFB_ARCHIVE_CSV_INVALID'),{code:'CFB_ARCHIVE_CSV_INVALID'});
 const headers=rows.shift().map(v=>text(v).toLowerCase());
 if(!headers.length||new Set(headers).size!==headers.length)throw Object.assign(Error('CFB_ARCHIVE_SCHEMA_INVALID'),{code:'CFB_ARCHIVE_SCHEMA_INVALID'});
 return rows.filter(r=>r.some(v=>text(v))).map(values=>Object.fromEntries(headers.map((h,i)=>[h,values[i]??''])));
}
export const cfbPlayerUrl=(season,gzip=false)=>PLAYER_BASE+'/player_box_'+season+'.csv'+(gzip?'.gz':'');
export const cfbScheduleUrl=(season,gzip=false)=>SCHEDULE_BASE+'/cfb_schedule_'+season+'.csv'+(gzip?'.gz':'');

async function fetchCsv(url,{fetcher=globalThis.fetch,gzip=false}={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);timer.unref?.();
 try{
  const response=await fetcher(url,{method:'GET',redirect:'follow',credentials:'omit',headers:{accept:'application/octet-stream'},signal:controller.signal});
  if(response?.status===404)return null;
  if(!response?.ok)throw Object.assign(Error('CFB_ARCHIVE_HTTP'),{code:'CFB_ARCHIVE_HTTP',status:response?.status||0});
  const max=gzip?MAX_COMPRESSED:MAX_RAW,size=Number(response.headers?.get?.('content-length'));
  if(Number.isFinite(size)&&size>max)throw Object.assign(Error('CFB_ARCHIVE_TOO_LARGE'),{code:'CFB_ARCHIVE_TOO_LARGE'});
  if(gzip){
   const compressed=Buffer.from(await response.arrayBuffer());
   if(compressed.length>MAX_COMPRESSED)throw Object.assign(Error('CFB_ARCHIVE_TOO_LARGE'),{code:'CFB_ARCHIVE_TOO_LARGE'});
   const body=gunzipSync(compressed,{maxOutputLength:MAX_RAW}).toString('utf8');
   return parseCfbCsv(body);
  }
  const body=await response.text();
  if(Buffer.byteLength(body,'utf8')>MAX_RAW)throw Object.assign(Error('CFB_ARCHIVE_TOO_LARGE'),{code:'CFB_ARCHIVE_TOO_LARGE'});
  return parseCfbCsv(body);
 }finally{clearTimeout(timer);}
}
async function fetchSeasonFile(urlFor,season,deps){
 const zipped=await fetchCsv(urlFor(season,true),{...deps,gzip:true});
 if(zipped)return zipped;
 const plain=await fetchCsv(urlFor(season,false),{...deps,gzip:false});
 if(plain)return plain;
 throw Object.assign(Error('CFB_ARCHIVE_NOT_PUBLISHED'),{code:'CFB_ARCHIVE_NOT_PUBLISHED'});
}
async function loadSeason(season,{now=Date.now,cacheEnabled=true,...deps}={}){
 const key=String(season),hit=cache.get(key);
 if(cacheEnabled&&hit&&hit.expires>now())return{...hit,cached:true};
 const [playerRows,scheduleRows]=await Promise.all([fetchSeasonFile(cfbPlayerUrl,season,deps),fetchSeasonFile(cfbScheduleUrl,season,deps)]);
 const playerRequired=['game_id','season','week','team_id','category','athlete_id','athlete_name'];
 const scheduleRequired=['game_id','season','season_type','game_date','home_id','home_team','home_score','away_id','away_team','away_score','status_type_completed'];
 if(!playerRows.length||playerRequired.some(k=>!Object.hasOwn(playerRows[0],k)))throw Object.assign(Error('CFB_PLAYER_SCHEMA_INVALID'),{code:'CFB_PLAYER_SCHEMA_INVALID'});
 if(!scheduleRows.length||scheduleRequired.some(k=>!Object.hasOwn(scheduleRows[0],k)))throw Object.assign(Error('CFB_SCHEDULE_SCHEMA_INVALID'),{code:'CFB_SCHEDULE_SCHEMA_INVALID'});
 const value={playerRows,scheduleRows,expires:now()+TTL_MS};
 if(cacheEnabled){cache.set(key,value);while(cache.size>4)cache.delete(cache.keys().next().value);}
 return{...value,cached:false};
}
function seasonAt(ms){const d=new Date(ms),y=d.getUTCFullYear(),m=d.getUTCMonth()+1;return m<=2?y-1:y;}
function athleteId(v){const m=text(v).match(/^(?:history:NCAAF:|espn:|cfb:)(\d+)$/i);return m?m[1]:null;}
function scheduleMap(rows){return new Map(rows.map(r=>[text(r.game_id),r]).filter(([id])=>id));}
function sideFor(game,teamId){const id=text(teamId);return id&&id===text(game.home_id)?'home':id&&id===text(game.away_id)?'away':null;}
function teamValues(game,side){return side==='home'?[game.home_id,game.home_abbreviation,game.home_location,game.home_nickname,game.home_team]:[game.away_id,game.away_abbreviation,game.away_location,game.away_nickname,game.away_team];}
function chooseIdentity(playerRows,scheduleRows,params){
 const direct=athleteId(params.providerPlayerId);
 if(direct){const exact=playerRows.filter(r=>text(r.athlete_id)===direct);if(exact.length)return{id:direct,rows:exact};}
 const wanted=normalizePlayerName(params.playerName),named=playerRows.filter(r=>r.athlete_id&&normalizePlayerName(r.athlete_name)===wanted);
 if(!named.length)return null;
 const ids=[...new Set(named.map(r=>text(r.athlete_id)).filter(Boolean))];
 if(ids.length===1)return{id:ids[0],rows:named};
 const schedules=scheduleMap(scheduleRows),team=text(params.team);
 const scoped=ids.filter(id=>named.filter(r=>text(r.athlete_id)===id).some(r=>{const g=schedules.get(text(r.game_id)),side=g&&sideFor(g,r.team_id);return side&&teamValues(g,side).some(v=>samePublicTeam(team,v,'NCAAF'));}));
 return scoped.length===1?{id:scoped[0],rows:named.filter(r=>text(r.athlete_id)===scoped[0])}:null;
}
function category(rows,name){const found=rows.filter(r=>text(r.category).toLowerCase()===name);return found.length===1?found[0]:null;}
function pair(v,index){const m=text(v).match(/^(-?\d+(?:\.\d+)?)\s*[\/-]\s*(-?\d+(?:\.\d+)?)$/);return m?Number(m[index+1]):null;}
function fieldValue(rows,field){
 const p=()=>category(rows,'passing'),r=()=>category(rows,'rushing'),rec=()=>category(rows,'receiving'),d=()=>category(rows,'defensive'),i=()=>category(rows,'interceptions'),k=()=>category(rows,'kicking'),pu=()=>category(rows,'punting');
 switch(field){
  case'PassingCompletions':return pair(p()?.completions_passing_attempts,0);case'PassingAttempts':return pair(p()?.completions_passing_attempts,1);
  case'PassingYards':return numeric(p()?.passing_yards);case'PassingTouchdowns':return numeric(p()?.passing_touchdowns);case'PassingInterceptions':return numeric(p()?.interceptions);
  case'RushingAttempts':return numeric(r()?.rushing_attempts);case'RushingYards':return numeric(r()?.rushing_yards);case'RushingTouchdowns':return numeric(r()?.rushing_touchdowns);case'RushingLongest':return numeric(r()?.long_rushing);
  case'Receptions':return numeric(rec()?.receptions);case'ReceivingYards':return numeric(rec()?.receiving_yards);case'ReceivingTouchdowns':return numeric(rec()?.receiving_touchdowns);case'ReceivingLongest':return numeric(rec()?.long_reception);
  case'TotalTackles':return numeric(d()?.total_tackles);case'SoloTackles':return numeric(d()?.solo_tackles);
  case'AssistedTackles':{const total=numeric(d()?.total_tackles),solo=numeric(d()?.solo_tackles);return total===null||solo===null||total<solo?null:Number((total-solo).toFixed(3));}
  case'Sacks':return numeric(d()?.sacks);case'DefensiveInterceptions':return numeric(i()?.interceptions);
  case'FieldGoalsMade':return pair(k()?.field_goals_made_field_goal_attempts,0);case'ExtraPointsMade':return pair(k()?.extra_points_made_extra_point_attempts,0);case'KickingPoints':return numeric(k()?.total_kicking_points);
  case'Punts':return numeric(pu()?.punts);case'PuntsInside20':return numeric(pu()?.punts_inside20);default:return null;
 }
}
function gameValue(rows,fields){let total=0;for(const field of fields){const v=fieldValue(rows,field);if(v===null)return null;total+=v;}return Number(total.toFixed(3));}
function normalizeGames(playerRows,scheduleRows,fields,before){
 const schedules=scheduleMap(scheduleRows),groups=new Map(),out=[];
 for(const row of playerRows){const id=text(row.game_id);if(!id)continue;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(row);}
 for(const [gameId,rows] of groups){
  const game=schedules.get(gameId),at=Date.parse(text(game?.game_date)),completed=/^(?:true|1)$/i.test(text(game?.status_type_completed))||text(game?.status_type_name).toUpperCase()==='STATUS_FINAL';
  if(!game||!completed||!Number.isFinite(at)||at>=before||numeric(game.home_score)===null||numeric(game.away_score)===null)continue;
  const teamIds=[...new Set(rows.map(r=>text(r.team_id)).filter(Boolean))];if(teamIds.length!==1)continue;
  const side=sideFor(game,teamIds[0]),value=gameValue(rows,fields);if(!side||value===null)continue;
  const homeScore=numeric(game.home_score),awayScore=numeric(game.away_score),isHome=side==='home',scoreFor=isHome?homeScore:awayScore,scoreAgainst=isHome?awayScore:homeScore;
  const team=isHome?(text(game.home_abbreviation)||text(game.home_team)):(text(game.away_abbreviation)||text(game.away_team));
  const opponent=isHome?(text(game.away_abbreviation)||text(game.away_team)):(text(game.home_abbreviation)||text(game.home_team));
  out.push({gameId:'ncaaf:'+gameId,date:new Date(at).toISOString(),opponent:opponent||null,opponentId:isHome?text(game.away_id)||null:text(game.home_id)||null,team:team||null,isHome,scoreFor,scoreAgainst,gameResult:scoreFor===scoreAgainst?'T':scoreFor>scoreAgainst?'W':'L',value,season:text(game.season)||null,seasonType:numeric(game.season_type),statKind:fields.join('+')});
 }
 return out.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
}

export async function fetchSportsDataverseCfbResearch(params={},dependencies={}){
 if(String(params.sport||'').toUpperCase()!=='NCAAF')return null;
 const period=text(params.period).toLowerCase();
 if(period&&!['game','full','full_game','match','single_stat'].includes(period))return unavailable('UNSUPPORTED_MARKET','SportsDataverse CFB player boxes verify full-game statistics only.');
 const contract=marketContract({sport:'NCAAF',market:params.market,providerMarketKey:params.providerMarketKey||params.marketId||null});
 if(!contract||contract.entityType!=='player'||contract.fields.some(f=>!SUPPORTED.has(f)))return unavailable('UNSUPPORTED_MARKET','SportsDataverse CFB player boxes do not expose this exact historical statistic.');
 const clock=dependencies.now||Date.now,now=clock(),gameStart=Date.parse(params.gameStartTime||''),before=Number.isFinite(gameStart)?Math.min(now,gameStart):now,season=seasonAt(Number.isFinite(gameStart)?gameStart:now),take=Math.min(40,Math.max(5,Math.floor(Number(params.games)||20)));
 const loaded=[];let cached=true,loadError=null;
 for(const year of [season,season-1]){
  try{const snap=await loadSeason(year,dependencies);cached=cached&&snap.cached;loaded.push(snap);}catch(error){loadError=error;if(year===season&&error?.code==='CFB_ARCHIVE_NOT_PUBLISHED')continue;break;}
  const players=loaded.flatMap(x=>x.playerRows),schedules=loaded.flatMap(x=>x.scheduleRows),identity=chooseIdentity(players,schedules,params);
  if(identity&&normalizeGames(identity.rows,schedules,contract.fields,before).length>=take)break;
 }
 if(!loaded.length&&loadError)return unavailable('RESEARCH_PROVIDER_ERROR','SportsDataverse college-football history is temporarily unavailable. Please retry.',true);
 const players=loaded.flatMap(x=>x.playerRows),schedules=loaded.flatMap(x=>x.scheduleRows),identity=chooseIdentity(players,schedules,params);
 if(!identity)return unavailable(loadError?'RESEARCH_PROVIDER_ERROR':'PLAYER_NOT_FOUND',loadError?'College-football player identity verification is temporarily incomplete. Please retry.':'Player identity could not be verified in the SportsDataverse CFB archive.',Boolean(loadError));
 const gameLog=normalizeGames(identity.rows,schedules,contract.fields,before).slice(0,take);
 if(!gameLog.length)return unavailable('NO_GAME_LOG_DATA','No verified completed college-football games contain this exact statistic.');
 return{ok:true,available:true,source:'SportsDataverse ESPN CFB player box',cached,entityType:'player',statKind:contract.fields.join('+'),player:{playerName:text(identity.rows[0]?.athlete_name)||text(params.playerName),providerPlayerId:'espn:'+identity.id,team:text(params.team)||text(gameLog[0]?.team)||null,sport:'NCAAF'},opponent:text(params.opponent)||null,opponentId:null,isHome:null,season:String(season),gameLog,coverage:{source:'sportsdataverse-espn-cfb-player-box',complete:false,seasonComplete:false,returnedGames:gameLog.length,fields:[...contract.fields],historyPartial:Boolean(loadError),newestGame:gameLog[0]?.date||null,oldestGame:gameLog.at(-1)?.date||null}};
}
