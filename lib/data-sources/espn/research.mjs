import { normalizePlayerName } from '../contract.mjs';
import { PUBLIC_LEAGUES, canonicalSport, marketContract, normalizeStatColumns, numeric } from './stat-contract.mjs';
import { resolvePublicAthlete, resolveRosterAthlete, teamKey, samePublicTeam as sameTeam, matchesTeamRecord } from './identity.mjs';
import { fetchTeamResearch } from './team-research.mjs';
export { PUBLIC_LEAGUES, resolvePublicAthlete };
const BASE = 'https://site.web.api.espn.com/apis';
const STAT_OUTPUT = {
  Points:'points',Rebounds:'rebounds',Assists:'assists',Steals:'steals',BlockedShots:'blocks',Turnovers:'turnovers',ThreePointersMade:'threes',
  PassingAttempts:'passingAttempts',PassingCompletions:'passingCompletions',PassingYards:'passingYards',PassingTouchdowns:'passingTouchdowns',PassingInterceptions:'passingInterceptions',
  RushingAttempts:'rushingAttempts',RushingYards:'rushingYards',RushingTouchdowns:'rushingTouchdowns',Receptions:'receptions',ReceivingYards:'receivingYards',ReceivingTargets:'targets',ReceivingTouchdowns:'receivingTouchdowns',
  Sacks:'sacks',SacksTaken:'sacksTaken',TotalTackles:'tacklesAssists',SoloTackles:'soloTackles',AssistedTackles:'assistedTackles',FieldGoalsMade:'fieldGoalsMade',KickingPoints:'kickingPoints',ExtraPointsMade:'extraPointsMade',
  Hits:'hits',Runs:'runs',RunsBattedIn:'runsBattedIn',Strikeouts:'strikeouts',Doubles:'doubles',Triples:'triples',HomeRuns:'homeRuns',StolenBases:'stolenBases',Walks:'walks',EarnedRuns:'earnedRuns',HitsAllowed:'hitsAllowed',WalksAllowed:'walksAllowed',PitchingOuts:'pitchingOuts',TotalBases:'totalBases',Singles:'singles',
  Goals:'goals',ShotsOnGoal:'shotsOnGoal',Saves:'saves',GoalsAgainst:'goalsAgainst',PowerPlayPoints:'powerPlayPoints',
  SoccerGoals:'goals',SoccerAssists:'assists',Shots:'shots',ShotsOnTarget:'shotsOnTarget',PassesAttempted:'passesAttempted',PassesCompleted:'passesCompleted',Tackles:'tackles',
};
const MESSAGES = {
 UNSUPPORTED_MARKET:'Historical statistics for this exact market are not available.',
 STAT_NOT_AVAILABLE:'This game-log source does not report the statistic required by this market.',
 PLAYER_NOT_FOUND:'Player identity could not be verified for this league and team.',
 PLAYER_TEAM_MISMATCH:'The player could not be matched to a team in this matchup.',
 NO_GAME_LOG_DATA:'No completed game logs are available for this player.',
 RESEARCH_PROVIDER_ERROR:'Historical results are temporarily unavailable. Please retry.',
};
const unavailable = code => ({ok:true,available:false,code,gameLog:[],message:MESSAGES[code]||'Historical results are unavailable.',
 retryable:code==='RESEARCH_PROVIDER_ERROR'});

function seasonType(group, category, soccer = false) {
  const title = String(group.displayName || category?.displayName || "");
  if (/preseason|spring training|all.star|exhibition|friendly/i.test(title)) return 1;
  if (soccer) return /playoff|knockout|round of|quarter.final|semi.final|final$/i.test(title) ? 3 : /regular season|league phase|group stage|group phase|premier league/i.test(title) ? 2 : null;
  const declared = group.seasonType?.id ?? group.seasonType ?? category?.seasonType ?? category?.splitType;
  if (['1','2','3'].includes(String(declared))) return Number(declared);
  const name = String(group.displayName || '');
  return /preseason|spring training|all.star/i.test(name) ? 1
    : /postseason|playoffs|play-in/i.test(name) ? 3 : /regular season/i.test(name) ? 2 : null;
}
function elapsedMinutes(value) {
  const n = numeric(value);
  if (n !== null) return n;
  const m = typeof value === 'string' && value.match(/^(\d+):(\d{2})$/);
  return m && Number(m[2]) < 60 ? Number(m[1]) + Number(m[2])/60 : null;
}
function leagueMatches(event,sport) {
  const league=String(event.leagueAbbreviation||'').toUpperCase();
  const accepted={NCAAB:['NCAAM','NCAAB'],EPL:['ENGLISH PREMIER LEAGUE','PREMIER LEAGUE','EPL'],
    UCL:['UEFA CHAMPIONS LEAGUE','UCL'],MLS:['MLS','MAJOR LEAGUE SOCCER']};
  return (accepted[sport]||[sport]).includes(league);
}
export function inspectGameLog(payload, params = {}) {
  const sport=canonicalSport(params.sport), contract=marketContract({...params,sport});
  const family=PUBLIC_LEAGUES[sport]?.[0], names=payload?.names;
  const season=payload?.filters?.find(f=>f.name==='season')?.value ?? null;
  const empty={rows:[],complete:false,season,seenEvents:0,sackKind:null};
  if(!contract||contract.entityType!=='player')return {...empty,code:'UNSUPPORTED_MARKET'};
  if(!Array.isArray(names)||new Set(names).size!==names.length)return {...empty,code:season!==null?'NO_GAME_LOG_DATA':'RESEARCH_PROVIDER_ERROR'};
  if(contract.category&&payload.filters?.find(f=>f.name==='category')?.value!==contract.category)return {...empty,code:'STAT_NOT_AVAILABLE'};
  const seen=new Set(),expected=new Set(),output=[];let validSeason=false,unresolved=false,sackKind=null,foreignLeagueEvents=0;
  const now=params.now??Date.now();
  for(const group of payload.seasonTypes||[])for(const cat of group.categories||[]) {
    const type=seasonType(group,cat,family==='soccer');
    if(![2,3].includes(type)||cat.type!=='event')continue;
    validSeason=true;
    for(const row of cat.events||[]) {
      const event=payload.events?.[row.eventId];
      if(!event||String(event.id)!==String(row.eventId)){unresolved=true;continue;}
      if(!leagueMatches(event,sport)){foreignLeagueEvents++;continue;}
      const date=Date.parse(event.gameDate),status=event.status?.type||event.status;
      const homeScore=numeric(event.homeTeamScore),awayScore=numeric(event.awayTeamScore);
      const result=event.gameResult==='D'?'T':event.gameResult;
      if(!Number.isFinite(date)||date>now||event.team?.isAllStar||event.opponent?.isAllStar
        ||!['W','L','T'].includes(result)||homeScore===null||awayScore===null
        ||status?.completed===false||(status?.state&&status.state!=='post'))continue;
      const teamId=String(event.team?.id||''),opponentId=String(event.opponent?.id||'');
      const isHome=teamId===String(event.homeTeamId);
      if(!teamId||!opponentId||(isHome?opponentId!==String(event.awayTeamId):teamId!==String(event.awayTeamId)||opponentId!==String(event.homeTeamId)))continue;
      const scoreFor=isHome?homeScore:awayScore,scoreAgainst=isHome?awayScore:homeScore;
      if((scoreFor===scoreAgainst?'T':scoreFor>scoreAgainst?'W':'L')!==result)continue;
      if(row.didNotPlay===true||row.active===false)continue;
      const values=Object.fromEntries(names.map((name,i)=>[name,row.stats?.[i]]));
      const minutes=elapsedMinutes(values.minutes??values.timeOnIcePerGame);
      if(family==='basketball'&&(minutes===null||minutes<=0)||sport==='NHL'&&minutes!==null&&minutes<=0)continue;
      const id=String(event.id);expected.add(id);
      if(!Array.isArray(row.stats)||row.stats.length!==names.length||seen.has(id))continue;
      const mapped=normalizeStatColumns(values,contract);
      if(contract.fields.some(f=>numeric(mapped[f])===null)||contract.requiredSackKind&&mapped.sackKind!==contract.requiredSackKind)continue;
      const stats=Object.fromEntries(Object.entries(STAT_OUTPUT).map(([field,key])=>[key,numeric(mapped[field])]));
      // Sport-specific duplicate output names cannot overwrite another sport.
      if(family!=='soccer'){stats.goals=mapped.Goals;stats.assists=mapped.Assists;}
      if(sport==='MLB'&&contract.category==='pitching'){stats.runs=null;stats.runsAllowed=mapped.Runs;}
      if(sport==='NHL')stats.points=mapped.Goals!==null&&mapped.Assists!==null?mapped.Goals+mapped.Assists:null;
      for(const key of Object.keys(stats))if(stats[key]===null&&!(sport==='MLB'&&contract.category==='pitching'&&['hits','runs'].includes(key)))delete stats[key];
      if(mapped.sackKind)sackKind=mapped.sackKind;
      seen.add(id);
      output.push({gameId:`${sport.toLowerCase()}:${id}`,date:new Date(date).toISOString(),
        opponentId:`${sport}:${opponentId}`,teamId:`${sport}:${teamId}`,
        opponent:event.opponent?.abbreviation||null,opponentName:event.opponent?.displayName||null,
        team:event.team?.abbreviation||null,teamName:event.team?.displayName||null,
        isHome,started:typeof row.started==='boolean'?row.started:null,scoreFor,scoreAgainst,gameResult:result,minutes,...stats,
        value:contract.fields.reduce((sum,f)=>sum+mapped[f],0),season,seasonType:type,
        statKind:contract.fields[0]==='Sacks'?mapped.sackKind:contract.fields.join('+')});
    }
  }
  return {rows:output.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)),season,sackKind,seenEvents:expected.size,foreignLeagueEvents,
    code:expected.size&&!output.length?'STAT_NOT_AVAILABLE':'NO_GAME_LOG_DATA',
    complete:!unresolved&&!foreignLeagueEvents&&validSeason&&season!==null&&expected.size===seen.size&&!payload.nextPage&&!payload.hasMore};
}
export function normalizePublicGameLog(payload,params){return inspectGameLog(payload,params).rows;}

// An athlete who has not played yet may still default to last year's logs.
// Read the league's season once, without advancing into a future season.
export function activePublicSeason(payload, league, now=Date.now()) {
  const season=payload?.leagues?.find(l=>l.slug===league)?.season;
  const year=Number(season?.year), start=Date.parse(season?.startDate);
  return Number.isInteger(year)&&year>1900&&Number.isFinite(start)&&start<=now ? String(year) : null;
}

// Cache policy. Name->athlete-id mappings never expire: an ESPN athlete id is
// permanent, so re-resolving one is a wasted round trip on every board load.
// Completed game logs hold for two hours, which is well inside the gap between
// a game finishing and the next one starting.
export const ID_MAP_TTL = Infinity;
export const GAME_LOG_TTL = 2 * 60 * 60_000;
// Batch hydration resolves a whole slate at once, so the old limit of two
// in-flight requests made the first board load serial. Six keeps the free
// endpoint politely used while letting a slate resolve in parallel.
const MAX_CONCURRENT = 6;

export function createPublicResearch({ fetchImpl = (...args) => fetch(...args), now = () => Date.now() } = {}) {
  const cache = new Map(), pending = new Map(), queue = [];
  let active = 0, backoffUntil = 0;
  async function request(path, ttl) {
    const hit = cache.get(path);
    if (hit && (hit.expires === Infinity || hit.expires > now())) return { ...hit.result, cached: true };
    if (pending.has(path)) return pending.get(path);
    if (now() < backoffUntil || queue.length >= 256) return { data: null };
    const work = (async () => {
      if (active >= MAX_CONCURRENT) await new Promise(resolve => queue.push(resolve));
      else active++;
      let result = { data: null };
      try {
        if (now() < backoffUntil) return result;
        const response = await fetchImpl(path.startsWith('/site/v2/') ? `https://site.api.espn.com/apis${path}` : `${BASE}${path}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
        if (response.status === 429) backoffUntil = now() + 15 * 60_000;
        if (response.ok) result = { data: await response.json(), cached: false };
      } catch { /* Generic absence only; no raw provider error reaches the API. */ }
      finally { const next=queue.shift(); if(next)next(); else active--; }
      const expires = !result.data ? now() + 5 * 60_000 : ttl === Infinity ? Infinity : now() + ttl;
      cache.set(path, { result, expires });
      // Evict expiring entries first so a permanent id mapping is not thrown
      // away to make room for a game log that will go stale in two hours.
      for (const [key, entry] of cache) {
        if (cache.size <= 4000) break;
        if (entry.expires !== Infinity) cache.delete(key);
      }
      while (cache.size > 6000) cache.delete(cache.keys().next().value);
      return result;
    })().finally(() => pending.delete(path));
    pending.set(path, work);
    return work;
  }
  // Requests are shared across markets, lines and users. Only verified public
  // identities are retained forever; team rosters expire because transfers exist.
  async function teamDirectory(sport) {
    const [family,league]=PUBLIC_LEAGUES[sport];
    const response=await request(`/site/v2/sports/${family}/${league}/teams?limit=1000`,24*60*60_000);
    return (response.data?.sports||[]).flatMap(s=>(s.leagues||[]).flatMap(l=>(l.teams||[]).map(t=>t.team)));
  }
  return async function fetchResearch(params = {}) {
    const sport=canonicalSport(params.sport),contract=marketContract({...params,sport});
    if(!PUBLIC_LEAGUES[sport]||!contract)return unavailable('UNSUPPORTED_MARKET');
    if(contract.entityType==='team')return fetchTeamResearch({...params,sport,contract},{request,teamDirectory,now});
    const [sportPath,leaguePath]=PUBLIC_LEAGUES[sport];
    const name=normalizePlayerName(params.playerName);
    if(!name||name.length>100)return unavailable('PLAYER_NOT_FOUND');
    const search=await request(`/search/v2?${new URLSearchParams({query:name,sport:sportPath})}`,ID_MAP_TTL);
    let athlete=resolvePublicAthlete(search.data,{...params,sport}),rosterTeam=null;
    if(!athlete&&(params.team||params.homeTeam||params.awayTeam)) {
      const teams=await teamDirectory(sport);
      const scope=teams.filter(t=>[params.team,params.homeTeam,params.awayTeam].some(v=>v&&matchesTeamRecord(v,t,sport))).slice(0,2);
      const matches=[];
      for(const t of scope){
        const roster=await request(`/site/v2/sports/${sportPath}/${leaguePath}/teams/${t.id}/roster`,60*60_000);
        const match=resolveRosterAthlete(roster.data,{...params,sport,team:t});if(match)matches.push({match,t});
      }
      if(matches.length===1){athlete=matches[0].match;rosterTeam=matches[0].t;}
    }
    if(!athlete)return unavailable(search.data?'PLAYER_NOT_FOUND':'RESEARCH_PROVIDER_ERROR');
    const path=`/common/v3/sports/${sportPath}/${leaguePath}/athletes/${athlete.id}/gamelog`;
    const query=new URLSearchParams();if(contract.category)query.set('category',contract.category);
    // Soccer's URL path alone is not a competition filter; require the explicit
    // league parameter and independently validate every event's league.
    if(sportPath==='soccer')query.set('league',leaguePath);
    const logPath=()=>path+(query.size?'?'+query:'');
    const clock=await request(`/site/v2/sports/${sportPath}/${leaguePath}/scoreboard?limit=1`,GAME_LOG_TTL);
    const activeSeason=activePublicSeason(clock.data,leaguePath,now());
    let response=await request(logPath(),GAME_LOG_TTL);
    if(!response.data)return unavailable('RESEARCH_PROVIDER_ERROR');
    const defaultSeason=response.data.filters?.find(f=>f.name==='season')?.value;
    if(activeSeason&&Number(activeSeason)>Number(defaultSeason)) {
      query.set('season',activeSeason);
      const fresh=await request(logPath(),GAME_LOG_TTL);
      // Keep real older logs if the current-season endpoint is temporarily
      // down, but never label those games as the active season's statistics.
      response=fresh.data ? fresh : {data:{filters:[{name:'season',value:activeSeason}],seasonTypes:[]},cached:false};
      if(String(response.data.filters?.find(f=>f.name==='season')?.value)!==activeSeason)
        response={data:{filters:[{name:'season',value:activeSeason}],seasonTypes:[]},cached:false};
    }
    let cached=Boolean(search.cached&&response.cached);
    const current=inspectGameLog(response.data,{...params,sport,now:now()});
    let logs=current.rows,olderResult=null,olderFailed=false;
    const count=Math.max(15,Math.min(40,Math.floor(Number(params.games)||20)));
    const filter=response.data.filters?.find(f=>f.name==='season');
    const year=Number(filter?.value);
    const previous=filter?.options?.find(o=>Number(o.value)===year-1);
    if(logs.length<count&&Number.isInteger(year)&&year>1900) {
      query.set('season',String(previous?.value||year-1));
      const older=await request(logPath(),GAME_LOG_TTL);cached=cached&&Boolean(older.cached);olderFailed=!older.data;
      olderResult=inspectGameLog(older.data,{...params,sport,now:now()});
      if(older.data&&(String(olderResult.season)!==String(year-1)||olderResult.foreignLeagueEvents>0))olderFailed=true;
      // A provider ignoring the season parameter must not masquerade as backfill.
      if(String(olderResult.season)===String(year-1))logs=[...logs,...olderResult.rows.filter(r=>r.seasonType===2)];
    }
    logs=[...new Map(logs.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).map(r=>[r.gameId,r])).values()];
    if(!logs.length)return unavailable(olderFailed?'RESEARCH_PROVIDER_ERROR':current.code==='STAT_NOT_AVAILABLE'||olderResult?.code==='STAT_NOT_AVAILABLE'?'STAT_NOT_AVAILABLE':'NO_GAME_LOG_DATA');
    // A historical team is not a current roster. Validate a requested mismatch
    // against a fresh profile before rejecting legitimate offseason transfers.
    let currentTeam=rosterTeam;
    const knownTeam=value=>sameTeam(value,logs[0].team,sport)||sameTeam(value,athlete.teamName,sport)||matchesTeamRecord(value,currentTeam,sport);
    const requestedTeams=[params.team,params.homeTeam,params.awayTeam].filter(Boolean);
    if(requestedTeams.length&&!requestedTeams.some(knownTeam)) {
      const profile=await request(`/common/v3/sports/${sportPath}/${leaguePath}/athletes/${athlete.id}`,60*60_000);
      const a=profile.data?.athlete;
      if(String(a?.id)===athlete.id&&normalizePlayerName(a?.displayName)===name)currentTeam=a.team||a.teams?.[0]?.team||null;
    }
    if(params.team&&!knownTeam(params.team))return unavailable('PLAYER_TEAM_MISMATCH');
    const matchupOpponent=params.opponent||(knownTeam(params.homeTeam)?params.awayTeam:knownTeam(params.awayTeam)?params.homeTeam:null);
    let matchedOpponent=logs.find(r=>sameTeam(r.opponent,matchupOpponent,sport)||sameTeam(r.opponentName,matchupOpponent,sport));
    if(matchupOpponent&&!matchedOpponent) {
      const teams=await teamDirectory(sport);const opponentTeam=teams.filter(t=>matchesTeamRecord(matchupOpponent,t,sport));
      if(opponentTeam.length===1)matchedOpponent={opponent:opponentTeam[0].abbreviation,opponentId:`${sport}:${opponentTeam[0].id}`};
    }
    const sackKind=current.sackKind||olderResult?.sackKind;
    return {ok:true,available:true,source:'Historical stats',cached,opponent:matchedOpponent?.opponent||matchupOpponent,opponentId:matchedOpponent?.opponentId||null,
      player:{playerName:athlete.playerName,providerPlayerId:`history:${sport}:${athlete.id}`,team:currentTeam?.abbreviation||logs[0].team,sport},gameLog:logs,
      marketDisplayName:contract.fields[0]==='Sacks'?(sackKind==='sacks_taken'?'Sacks taken':'Defensive sacks'):null,
      entityType:'player',statKind:sackKind||contract.fields.join('+'),
      coverage:{seasonComplete:current.complete,backfilledGames:logs.filter(r=>String(r.season)!==String(year)).length,backfilled:logs.some(r=>String(r.season)!==String(year)),
        currentSeasonGames:current.rows.filter(r=>r.seasonType===2).length,historyPartial:olderFailed},season:filter?.value||null};
  };
}

export const fetchPublicResearch = createPublicResearch();
// Preserve imports used by the already deployed basketball integration/tests.
export const createPublicBasketballResearch = createPublicResearch;
export const fetchPublicBasketballResearch = fetchPublicResearch;
