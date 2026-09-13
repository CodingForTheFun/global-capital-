import {PUBLIC_LEAGUES,canonicalSport,numeric} from './stat-contract.mjs';
import {matchesTeamRecord} from './identity.mjs';
import {timestamp} from '../../ml/contract.mjs';

const TTL=120_000,MAX_AGE=300_000;
const list=v=>Array.isArray(v)?v:[];
const clean=v=>typeof v==='string'?v.trim().slice(0,150):'';
const id=v=>/^\d+$/.test(String(v??''))?String(v):null;
const absent=(code,message)=>({ok:true,available:false,code,message});
function competitors(competition){
 const rows=competition?.competitors;
 if(!Array.isArray(rows)||rows.length!==2)return null;
 const home=rows.filter(c=>c.homeAway==='home'),away=rows.filter(c=>c.homeAway==='away');
 if(home.length!==1||away.length!==1||!id(home[0].team?.id)||!id(away[0].team?.id)||String(home[0].team.id)===String(away[0].team.id))return null;
 return {home:home[0],away:away[0]};
}
function matches(competition,target){
 const teams=competitors(competition);
 return teams&&timestamp(competition.date)===timestamp(target.gameStartTime)
  &&matchesTeamRecord(target.homeTeam,teams.home.team,target.sport)&&matchesTeamRecord(target.awayTeam,teams.away.team,target.sport);
}
export function resolveMatchupEvent(scoreboard,target){
 const league=PUBLIC_LEAGUES[target.sport]?.[1];
 if(!league||!list(scoreboard?.leagues).some(l=>l.slug===league))return null;
 const matchesFound=[];
 for(const event of list(scoreboard.events)){
  if(!id(event?.id)||!Array.isArray(event.competitions)||event.competitions.length!==1)continue;
  const competition=event.competitions[0];
  if(String(competition.id)!==String(event.id)||event.date&&timestamp(event.date)!==timestamp(target.gameStartTime)||!matches(competition,target))continue;
  matchesFound.push({id:String(event.id),competition});
 }
 // Even duplicate rows must not hide conflicting event metadata.
 return matchesFound.length===1?matchesFound[0]:null;
}
export function normalizeMatchupSummary(summary,target,sourceEventId,{now=Date.now(),retrievedAt}={}){
 const header=summary?.header,competition=header?.competitions?.[0],retrieved=timestamp(retrievedAt),start=timestamp(target.gameStartTime);
 if(String(header?.id)!==sourceEventId||header?.league?.slug!==PUBLIC_LEAGUES[target.sport]?.[1]||header.competitions?.length!==1
  ||String(competition?.id)!==sourceEventId||!matches(competition,target))return absent('MATCHUP_IDENTITY_UNVERIFIED','The game summary could not be matched to this exact game.');
 if(!Number.isFinite(now)||!Number.isFinite(retrieved)||retrieved>now||now-retrieved>=MAX_AGE)return absent('MATCHUP_STALE','The game summary needs a fresh observation.');
 const teams=competitors(competition),pair=['home','away'].map(side=>({side,...teams[side],teamId:String(teams[side].team.id)}));
 const pregame=header.timeValid!==false&&competition.status?.isTBDFlex!==true&&competition.status?.type?.name==='STATUS_SCHEDULED'&&competition.status?.type?.state==='pre'&&competition.status?.type?.completed===false&&start>now;
 const gamePath=PUBLIC_LEAGUES[target.sport][0]==='soccer'?'soccer/match':`${({NCAAF:'college-football',NCAAB:'mens-college-basketball'}[target.sport]||target.sport.toLowerCase())}/game`;
 const sourceUrl=`https://www.espn.com/${gamePath}/_/gameId/${sourceEventId}`;
 const p=summary.predictor,home=numeric(p?.homeTeam?.gameProjection),away=numeric(p?.awayTeam?.gameProjection);
 const predictionOK=pregame&&String(p?.homeTeam?.id)===pair[0].teamId&&String(p?.awayTeam?.id)===pair[1].teamId
  &&home!==null&&away!==null&&home>=0&&away>=0&&home<=100&&away<=100&&home+away>0&&home+away<=100.2;
 const prediction=predictionOK?{available:true,kind:'published-model',source:'ESPN Analytics',homePercent:home,awayPercent:away,
  drawPercent:null,generatedAt:null,retrievedAt,expiresAt:new Date(Math.min(start,retrieved+MAX_AGE)).toISOString(),
  note:'Published pre-game estimates. Auto Scout has not independently measured this model’s calibration. Draw probability is not reported; rounded values may not total 100%.'}
  :{available:false,code:pregame?'PREDICTOR_NOT_PUBLISHED':'PREMATCH_ONLY',message:pregame?'The source has not published a valid win estimate for this game.':'Pre-game estimates are unavailable once the game starts or its status is unconfirmed.'};
 const teamRows=pair.map(({side,teamId,team,record,probables,curatedRank})=>{
  const reports=list(summary.injuries).filter(r=>String(r.team?.id)===teamId);
  const injuries=reports.length===1?list(reports[0].injuries).filter(r=>id(r.athlete?.id)&&clean(r.athlete?.displayName)&&clean(r.status))
   .map(r=>({playerId:`history:${target.sport}:${r.athlete.id}`,playerName:clean(r.athlete.displayName),position:clean(r.athlete.position?.abbreviation),status:clean(r.status),detail:clean(r.details?.type),reportedAt:Number.isFinite(timestamp(r.date))?r.date:null})).slice(0,70):[];
  const roster=list(summary.rosters).filter(r=>String(r.team?.id)===teamId&&r.homeAway===side);
  const starters=roster.length===1?list(roster[0].roster).filter(r=>r.starter===true&&id(r.athlete?.id)&&clean(r.athlete?.displayName))
   .map(r=>({playerId:`history:${target.sport}:${r.athlete.id}`,playerName:clean(r.athlete.displayName),position:clean(r.position?.abbreviation||r.athlete.position?.abbreviation),status:'Listed starter'})).slice(0,30):[];
  const probablePlayers=list(probables).filter(r=>id(r.athlete?.id)&&clean(r.athlete?.displayName)&&clean(r.displayName))
   .map(r=>({playerId:`history:${target.sport}:${r.athlete.id}`,playerName:clean(r.athlete.displayName),position:clean(r.athlete.position?.abbreviation),status:clean(r.displayName)}));
  const totalRecord=list(record).filter(r=>r.type==='total'),rank=numeric(curatedRank?.current);
  return {teamId,side,name:clean(team.displayName),abbreviation:clean(team.abbreviation),
   record:totalRecord.length===1?clean(totalRecord[0].summary)||null:null,
   rank:['NCAAF','NCAAB'].includes(target.sport)&&Number.isInteger(rank)&&rank>=1&&rank<=25?rank:null,
   injuries:{available:reports.length===1&&Array.isArray(reports[0].injuries),rows:injuries},
   lineup:{available:starters.length>0,starters,probables:probablePlayers}};
 });
 const weather=summary.gameInfo?.weather,temperature=numeric(weather?.temperature),venue=summary.gameInfo?.venue;
 return {ok:true,available:true,sport:target.sport,eventId:target.eventId,sourceEventId,gameStartTime:target.gameStartTime,
  source:'ESPN',sourceUrl,retrievedAt,expiresAt:new Date(retrieved+MAX_AGE).toISOString(),pregame,prediction,teams:teamRows,
  venue:{name:clean(venue?.fullName)||null,city:clean(venue?.address?.city)||null,indoor:typeof venue?.indoor==='boolean'?venue.indoor:null},
  weather:temperature!==null&&temperature>=-100&&temperature<=150?{available:true,temperature,unit:'°',note:'Temperature as published in the game weather report. Roof status and on-field conditions may differ.'}:{available:false,message:'No game weather report is published for this matchup.'}};
}
export async function fetchPublicMatchup(input,{request,now=Date.now}={}){
 const target={...input,sport:canonicalSport(input?.sport)},start=timestamp(target.gameStartTime),clock=now();
 if(!PUBLIC_LEAGUES[target.sport]||!clean(target.eventId)||!clean(target.homeTeam)||!clean(target.awayTeam)||!Number.isFinite(start)
  ||!Number.isFinite(clock)||Math.abs(start-clock)>14*86400_000)return absent('INVALID_MATCHUP','A supported game within fourteen days and exact teams and kickoff time are required.');
 const [family,league]=PUBLIC_LEAGUES[target.sport],prefix=`/site/v2/sports/${family}/${league}`;
 const date=t=>new Date(t).toISOString().slice(0,10).replaceAll('-','');
 const dates=`${date(start-86400_000)}-${date(start+86400_000)}`;
 const scoreboard=await request(`${prefix}/scoreboard?dates=${dates}&limit=1000`,TTL);
 if(!scoreboard.data)return absent('MATCHUP_SOURCE_UNAVAILABLE','Game context could not load. Try again shortly.');
 const event=resolveMatchupEvent(scoreboard.data,target);
 if(!event)return absent('MATCHUP_IDENTITY_UNVERIFIED','No unique game matches both teams and the exact kickoff time.');
 const summary=await request(`${prefix}/summary?event=${event.id}`,TTL);
 if(!summary.data)return absent('MATCHUP_SOURCE_UNAVAILABLE','Game context could not load. Try again shortly.');
 return normalizeMatchupSummary(summary.data,target,event.id,{now:now(),retrievedAt:summary.retrievedAt});
}
