import { canonicalSport, PUBLIC_LEAGUES, numeric } from './stat-contract.mjs';

const HOUR = 3600000;
const CONFIG = {
  NBA: { positions: ['PG','SG','SF','PF','C'], metrics: {points:'PTS',rebounds:'REB',assists:'AST',threes:'3PT',steals:'STL',blocks:'BLK'} },
  WNBA: { positions: ['PG','SG','SF','PF','C'], metrics: {points:'PTS',rebounds:'REB',assists:'AST',threes:'3PT',steals:'STL',blocks:'BLK'} },
  NFL: { positions: ['QB','RB','WR','TE'], metrics: {passingYards:'passing:YDS',passingTouchdowns:'passing:TD',rushingYards:'rushing:YDS',receivingYards:'receiving:YDS',receptions:'receiving:REC'} },
};
const list = value => Array.isArray(value) ? value : [];
const absent = message => ({ok:true,available:false,message,teams:[],rows:[]});

/** A position's total allowed per completed game, never a player's hit rate.
 * Ambiguous G/F roles are excluded rather than assigned to PG/SF. */
export function positionGameRows(summary, sport, allowedTeams, rosterPositions = new Map()) {
  const config = CONFIG[sport], header = summary?.header, game = header?.competitions?.[0];
  if (!config || header?.league?.slug !== PUBLIC_LEAGUES[sport]?.[1] || !game?.status?.type?.completed || game.status.type.state !== 'post' || Number(header.season?.type) !== 2) return [];
  const teams = list(game.competitors).map(c=>String(c.team?.id||''));
  if (teams.length !== 2 || teams[0] === teams[1] || teams.some(id=>!allowedTeams.has(id))) return [];
  const rows=[];
  for (const box of list(summary.boxscore?.players)) {
    const offense=String(box.team?.id||''), defense=teams.find(id=>id!==offense);
    if (!teams.includes(offense) || !defense) continue;
    const totals = new Map(), seen = new Set(), invalid = new Set();
    const athletes=list(box.statistics).flatMap(g=>list(g.athletes)).filter(p=>p.didNotPlay!==true);
    const positionOf=p=>p.athlete?.position?.abbreviation||rosterPositions.get(`${offense}:${p.athlete?.id}`);
    // Unknown roles could hide contributions to any position: omit this team's
    // game rather than treating unclassified players as zero production.
    if(athletes.some(p=>!positionOf(p)||['NBA','WNBA'].includes(sport)&&!config.positions.includes(positionOf(p))))continue;
    for (const group of list(box.statistics)) {
      const labels=list(group.labels);
      for (const player of list(group.athletes)) {
        const pos=positionOf(player), pid=String(player.athlete?.id||'');
        if (!config.positions.includes(pos) || !pid || player.didNotPlay === true || !Array.isArray(player.stats) || player.stats.length !== labels.length) continue;
        for (const [metric,column] of Object.entries(config.metrics)) {
          const [category,label]=column.includes(':')?column.split(':'):[null,column];
          if (category && group.name!==category) continue;
          const index=labels.indexOf(label); if(index<0) continue;
          const raw=player.stats[index], value=metric==='threes' && /^\d+-\d+$/.test(String(raw)) ? Number(String(raw).split('-')[0]) : numeric(raw);
          if(value===null){invalid.add(`${pos}|${metric}`);continue;}
          if(seen.has(`${pid}|${metric}`)) continue;
          seen.add(`${pid}|${metric}`);
          const key=`${pos}|${metric}`, old=totals.get(key)||{position:pos,metric,total:0};
          old.total+=value;totals.set(key,old);
        }
      }
    }
    for(const row of totals.values()) if(!invalid.has(`${row.position}|${row.metric}`)) rows.push({...row,teamId:defense,gameId:String(header.id),date:game.date});
  }
  return rows;
}

export function rankPositionRows(input, teams) {
  const groups=new Map(),seen=new Set();
  for(const row of input) {
    const unique=JSON.stringify([row.gameId,row.teamId,row.position,row.metric]);
    if(seen.has(unique))continue;seen.add(unique);
    const key=JSON.stringify([row.teamId,row.position,row.metric]);
    const old=groups.get(key)||{teamId:row.teamId,position:row.position,metric:row.metric,total:0,games:0};
    old.total+=row.total;old.games++;groups.set(key,old);
  }
  const rows=[...groups.values()].map(r=>({...r,average:r.total/r.games}));
  return rows.map(row=>{
    const cohort=rows.filter(r=>r.metric===row.metric&&r.position===row.position&&r.games>=3);
    // A league rank requires the full league, with at least three games each.
    const rank=cohort.length===teams.length&&row.games>=3 ? 1+cohort.filter(r=>r.average<row.average).length : null;
    return {teamId:row.teamId,position:row.position,metric:row.metric,average:Number(row.average.toFixed(2)),games:row.games,rank,leagueSize:teams.length};
  });
}

export function createDefensePosition({request,teamDirectory,now=Date.now}) {
  const cache=new Map(),pending=new Map();
  return async input => {
    const sport=canonicalSport(input.sport), config=CONFIG[sport];
    if(!config)return absent('Position defense data is not published by this source for this sport. Use the opponent history and matchup sections.');
    const hit=cache.get(sport);if(hit&&hit.until>now())return hit.value;
    if(pending.has(sport))return pending.get(sport);
    const work=(async()=>{
      const clock=now(),teams=(await teamDirectory(sport)).map(t=>({id:String(t.id),abbreviation:t.abbreviation,name:t.displayName})).filter(t=>t.id&&t.abbreviation&&t.name);
      if(!teams.length)return absent('The league directory could not load.');
      const [family,league]=PUBLIC_LEAGUES[sport],prefix=`/site/v2/sports/${family}/${league}`;
      const date=t=>new Date(t).toISOString().slice(0,10).replaceAll('-','');
      const since=clock-14*86400000;
      // Scoreboard range queries can fail even when daily boards are available.
      // Load a bounded 14-day cohort through the existing cache, not paid feeds.
      const days=Array.from({length:14},(_,i)=>date(clock-i*86400000)), events=[];
      let successfulBoards=0;
      async function dayWorker(){while(days.length){const day=days.shift();const board=await request(`${prefix}/scoreboard?dates=${day}&limit=1000`,HOUR);if(!board.data)continue;successfulBoards++;events.push(...list(board.data.events).filter(e=>Number(e.season?.type)===2&&e.status?.type?.completed===true&&Date.parse(e.date)>=since&&Date.parse(e.date)<clock));}}
      await Promise.all([dayWorker(),dayWorker()]);
      if(!successfulBoards)return {...absent('Completed-game scoreboards could not load. Try again shortly.'),teams,positions:config.positions};
      events.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
      const queue=[...new Set(events.map(e=>String(e.id)).filter(id=>/^\d+$/.test(id)))].slice(0,48), summaries=[],allowed=new Set(teams.map(t=>t.id));
      // Shared request cache and two workers; never run an ingestion scheduler.
      async function worker(){while(queue.length){const id=queue.shift();const summary=await request(`${prefix}/summary?event=${id}`,24*HOUR);if(summary.data&&String(summary.data.header?.id)===id)summaries.push(summary.data);}}
      await Promise.all([worker(),worker()]);
      const rosterQueue=[...new Set(summaries.flatMap(s=>list(s.boxscore?.players).map(t=>String(t.team?.id||''))))].filter(id=>allowed.has(id)), rosterPositions=new Map();
      async function rosterWorker(){while(rosterQueue.length){const team=rosterQueue.shift(),response=await request(`${prefix}/teams/${team}/roster`,24*HOUR);
        const collect=items=>{for(const item of list(items)){if(item.items)collect(item.items);else if(/^\d+$/.test(String(item.id||''))&&item.position?.abbreviation)rosterPositions.set(`${team}:${item.id}`,item.position.abbreviation);}};
        collect(response.data?.athletes);
      }}
      await Promise.all([rosterWorker(),rosterWorker()]);
      const rows=summaries.flatMap(summary=>positionGameRows(summary,sport,allowed,rosterPositions));
      const ranked=rankPositionRows(rows,teams);
      const value={ok:true,available:ranked.length>0,sport,positions:config.positions,teams,rows:ranked,source:'ESPN completed box scores',sourceUrl:`https://www.espn.com/${sport.toLowerCase()}/scoreboard`,retrievedAt:new Date(clock).toISOString(),from:new Date(since).toISOString(),through:new Date(clock).toISOString(),message:ranked.length?null:'No verified position samples were returned for the last 14 days.',basis:'Position totals allowed per completed regular-season game. Latest 48 games within 14 days; rank requires every league team to have at least 3 games at the position. Positions use box scores or the current team roster. Games with unclassified players are excluded.'};
      cache.set(sport,{until:now()+HOUR,value});return value;
    })().finally(()=>pending.delete(sport));
    pending.set(sport,work);return work;
  };
}
