import { numeric } from './stat-contract.mjs';
import { matchesTeamRecord } from './identity.mjs';
const absent=(code,message)=>({ok:true,available:false,code,entityType:'team',gameLog:[],message});
export function normalizeTeamGame(summary,{sport='NFL',teamId,field,eventId,now=Date.now()}={}) {
 const header=summary?.header,game=header?.competitions?.[0];
 if(!header||String(header.id)!==String(eventId)||!game||game.status?.type?.completed!==true
   ||![2,3].includes(Number(header.season?.type))||!Number.isFinite(Date.parse(game.date))||Date.parse(game.date)>now)return null;
 const teams=game.competitors||[],own=teams.find(t=>String(t.id||t.team?.id)===String(teamId));
 const opponent=teams.find(t=>String(t.id||t.team?.id)!==String(teamId));
 if(!own||!opponent||teams.length!==2)return null;
 const scoreFor=numeric(own.score?.value??own.score),scoreAgainst=numeric(opponent.score?.value??opponent.score);
 if(scoreFor===null||scoreAgainst===null)return null;
 const statsFor=id=>(summary.boxscore?.teams||[]).find(t=>String(t.team?.id)===String(id))?.statistics||[];
 const sacksAllowed=id=>{
  const stat=statsFor(id).find(s=>s.name==='sacksYardsLost');
  const pair=String(stat?.displayValue||'').match(/^(\d+)-(-?\d+)$/);
  return pair?Number(pair[1]):null;
 };
 const value=field==='TeamPointsAllowed'?scoreAgainst:field==='TeamSacksAllowed'?sacksAllowed(teamId)
   :field==='TeamDefensiveSacks'?sacksAllowed(opponent.id||opponent.team?.id):null;
 if(value===null)return null;
 return {gameId:`${sport.toLowerCase()}:${eventId}`,date:new Date(game.date).toISOString(),
   teamId:`${sport}:${teamId}`,team:own.team?.abbreviation||null,teamName:own.team?.displayName||null,
   opponentId:`${sport}:${opponent.id||opponent.team?.id}`,opponent:opponent.team?.abbreviation||null,
   opponentName:opponent.team?.displayName||null,isHome:own.homeAway==='home',scoreFor,scoreAgainst,
   gameResult:scoreFor===scoreAgainst?'T':scoreFor>scoreAgainst?'W':'L',
   season:String(header.season.year),seasonType:Number(header.season.type),value,statKind:field};
}
export async function fetchTeamResearch(params,{request,teamDirectory,now}) {
 const {sport,contract}=params;
 // Unit markets require a unit identity. Never substitute an athlete's team
 // just because the market name happens to contain 'sacks'.
 const directory=await teamDirectory(sport);
 const candidates=directory.filter(t=>matchesTeamRecord(params.playerName,t,sport));
 if(candidates.length!==1)return absent('ENTITY_MISMATCH','This team market must identify the team, not an individual player.');
 const team=candidates[0];
 if(params.team&&!matchesTeamRecord(params.team,team,sport))return absent('ENTITY_MISMATCH','The team identity conflicts with this offer.');
 const prefix=`/site/v2/sports/football/${sport==='NCAAF'?'college-football':'nfl'}`;
 const current=await request(`${prefix}/teams/${team.id}/schedule`,2*60*60_000);
 if(!current.data)return absent('RESEARCH_PROVIDER_ERROR','Team game logs are temporarily unavailable.');
 const year=Number(current.data.requestedSeason?.year??current.data.season?.year);
 if(!Number.isInteger(year))return absent('RESEARCH_PROVIDER_ERROR','The game-log season could not be verified.');
 let events=(current.data.events||[]).filter(e=>Number(e.season?.year)===year);
 const typeOf=e=>Number(e.seasonType?.type??e.seasonType?.id??e.season?.type);
 const eligible=e=>[2,3].includes(typeOf(e))&&e.competitions?.[0]?.status?.type?.completed===true&&Date.parse(e.date)<=now();
 // During postseason the default schedule may contain only playoff games.
 // Fetch the same year's regular schedule separately so SZN is not playoffs.
 let regularFailed=false;
 if(Number(current.data.requestedSeason?.type??current.data.season?.type)===3){
  const regular=await request(`${prefix}/teams/${team.id}/schedule?season=${year}&seasontype=2`,2*60*60_000);
  regularFailed=!regular.data;
  events.push(...(regular.data?.events||[]).filter(e=>Number(e.season?.year)===year&&typeOf(e)===2));
 }
 const currentEvents=[...new Map(events.filter(eligible).map(e=>[e.id,e])).values()];
 let priorFailed=false;
 if(currentEvents.length<Math.min(40,Math.max(15,Number(params.games)||20))){
  const older=await request(`${prefix}/teams/${team.id}/schedule?season=${year-1}`,2*60*60_000);
  priorFailed=!older.data;
  events.push(...(older.data?.events||[]).filter(e=>Number(e.season?.year)===year-1&&typeOf(e)===2));
 }
 events=[...new Map(events.filter(eligible).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).map(e=>[e.id,e])).values()];
 // Football schedules are bounded. All current-season games are retained for
 // SZN; the one prior season fills rolling windows, never the season metric.
 if(events.length>64)return absent('RESEARCH_PROVIDER_ERROR','The team schedule returned an unexpected number of games.');
 const rows=await Promise.all(events.map(async e=>{
  const result=await request(`${prefix}/summary?event=${encodeURIComponent(e.id)}`,2*60*60_000);
  return normalizeTeamGame(result.data,{sport,teamId:team.id,field:contract.fields[0],eventId:e.id,now:now()});
 }));
 const gameLog=rows.filter(Boolean);
 if(!gameLog.length)return absent(events.length?'STAT_NOT_AVAILABLE':'NO_GAME_LOG_DATA',events.length?'The team statistic is not available in completed box scores.':'No completed team game logs are available.');
 const opposite=params.opponent||(matchesTeamRecord(params.homeTeam,team,sport)?params.awayTeam:matchesTeamRecord(params.awayTeam,team,sport)?params.homeTeam:null);
 const opponent=directory.filter(t=>matchesTeamRecord(opposite,t,sport));
 return {ok:true,available:true,source:'Historical stats',entityType:'team',season:String(year),statKind:contract.fields[0],
  player:{playerName:team.displayName+(contract.fields[0]==='TeamDefensiveSacks'?' Defense':''),team:team.abbreviation,sport,entityType:'team',providerTeamId:`history:${sport}:${team.id}`},
  opponent:opponent.length===1?opponent[0].abbreviation:opposite,opponentId:opponent.length===1?`${sport}:${opponent[0].id}`:null,gameLog,
  coverage:{seasonComplete:!regularFailed&&gameLog.filter(r=>Number(r.season)===year&&r.seasonType===2).length===currentEvents.filter(e=>typeOf(e)===2).length,
    backfilled:gameLog.some(r=>Number(r.season)!==year),historyPartial:regularFailed||priorFailed||gameLog.length!==events.length}};
}
