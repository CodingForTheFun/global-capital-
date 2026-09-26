import { canonicalSport, PUBLIC_LEAGUES, numeric, inningsToOuts } from './stat-contract.mjs';

const HOUR = 3600000;
const BASKETBALL = { kind: 'position', positions: ['G','F','C'],
  metrics: { points:{label:'PTS'}, rebounds:{label:'REB'}, assists:{label:'AST'}, threes:{label:'3PT',parse:'made'}, steals:{label:'STL'}, blocks:{label:'BLK'} } };
const FOOTBALL = { kind: 'position', positions: ['QB','RB','WR','TE'],
  metrics: { passingYards:{group:'passing',label:'YDS'}, passingTouchdowns:{group:'passing',label:'TD'}, rushingYards:{group:'rushing',label:'YDS'},
    receivingYards:{group:'receiving',label:'YDS'}, receptions:{group:'receiving',label:'REC'} },
  // Weekly schedule: 14 days holds two games per team at most, and a rank needs
  // three, so football reads six weeks of completed games instead.
  windowDays: 42 };
const SOCCER = { kind: 'team', positions: ['ALL'], metrics: { shots:{label:'totalShots'}, shotsOnTarget:{label:'shotsOnTarget'} }, windowDays: 42 };
/**
 * position: players are grouped by their listed role (box score, then roster).
 * group: the box score's own groups are the role (NHL forwards/defense/goalies,
 *   MLB batting/pitching), so no player is ever classified by guesswork.
 * team: the team's own totals (soccer), ranked as what an opponent allows.
 * partial: a college league is too large for every team to reach three games,
 *   so it ranks among the teams that have, and says how many that is.
 */
export const CONFIG = {
  NBA: { ...BASKETBALL, maxEvents: 90 },
  WNBA: { ...BASKETBALL, maxEvents: 60 },
  NCAAB: { ...BASKETBALL, maxEvents: 400, partial: true, query: 'groups=50' },
  NFL: { ...FOOTBALL, maxEvents: 96 },
  NCAAF: { ...FOOTBALL, maxEvents: 260, partial: true, query: 'groups=80' },
  NHL: { kind: 'group', positions: ['F','D','G'], groups: { forwards: 'F', defenses: 'D', goalies: 'G' },
    metrics: { goals:{label:'G',positions:['F','D']}, assists:{label:'A',positions:['F','D']}, shotsOnGoal:{label:'S',positions:['F','D']},
      blockedShots:{label:'BS',positions:['F','D']}, saves:{label:'SV',positions:['G']} },
    derived: { points: ['goals','assists'] }, maxEvents: 110 },
  MLB: { kind: 'group', positions: ['BAT','PIT'], groups: { batting: 'BAT', pitching: 'PIT' },
    metrics: { hits:{group:'batting',label:'H',positions:['BAT']}, runs:{group:'batting',label:'R',positions:['BAT']}, rbis:{group:'batting',label:'RBI',positions:['BAT']},
      homeRuns:{group:'batting',label:'HR',positions:['BAT']}, walks:{group:'batting',label:'BB',positions:['BAT']}, strikeouts:{group:'batting',label:'K',positions:['BAT']},
      pitcherStrikeouts:{group:'pitching',label:'K',positions:['PIT']}, hitsAllowed:{group:'pitching',label:'H',positions:['PIT']},
      earnedRuns:{group:'pitching',label:'ER',positions:['PIT']}, walksAllowed:{group:'pitching',label:'BB',positions:['PIT']}, outs:{group:'pitching',label:'IP',positions:['PIT'],parse:'outs'} },
    windowDays: 10, maxEvents: 100 },
  MLS: { ...SOCCER, maxEvents: 90 },
  EPL: { ...SOCCER, maxEvents: 60 },
  // Clubs change every season, so the cup ranks among clubs with enough games.
  UCL: { ...SOCCER, windowDays: 90, maxEvents: 150, partial: true },
};
const DEFAULT_WINDOW_DAYS = 14, DEFAULT_MAX_EVENTS = 48;
const list = value => Array.isArray(value) ? value : [];
const absent = message => ({ok:true,available:false,message,teams:[],rows:[]});
const SOCCER_SPORTS = new Set(['MLS','EPL','UCL']);

/** Regular-season test that works for leagues whose season types are ids (soccer). */
export function isRegularSeason(season, sport) {
  if (SOCCER_SPORTS.has(sport)) return !/playoff|knockout|final|qualif/i.test(String(season?.slug || season?.name || ''));
  return Number(season?.type) === 2;
}

/** A listed role reduced to the sport's ranked roles; null when it is not one. */
export function normalizePosition(sport, value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return null;
  if (['NBA','WNBA','NCAAB'].includes(sport)) {
    // ESPN lists basketball roles as G, F, C (or the primary first, "F-C").
    const first = raw.replace(/[^A-Z]/g, ' ').trim().split(/\s+/)[0];
    if (['PG','SG','G'].includes(first)) return 'G';
    if (['SF','PF','F'].includes(first)) return 'F';
    return first === 'C' ? 'C' : null;
  }
  if (['NFL','NCAAF'].includes(sport)) return raw === 'FB' ? 'RB' : (['QB','RB','WR','TE'].includes(raw) ? raw : null);
  return CONFIG[sport]?.positions.includes(raw) ? raw : null;
}

const parseValue = (raw, parse) => {
  if (parse === 'made') return /^\d+-\d+$/.test(String(raw)) ? Number(String(raw).split('-')[0]) : numeric(raw);
  if (parse === 'outs') return inningsToOuts(raw);
  return numeric(raw);
};

/** A position's total allowed per completed game, never a player's hit rate.
 * Players whose role cannot be established exclude that team-game rather than
 * being assigned to one. */
export function positionGameRows(summary, sport, allowedTeams, rosterPositions = new Map(), athletePositions = new Map()) {
  const config = CONFIG[sport], header = summary?.header, game = header?.competitions?.[0];
  if (!config || header?.league?.slug !== PUBLIC_LEAGUES[sport]?.[1] || !game?.status?.type?.completed || game.status.type.state !== 'post' || !isRegularSeason(header.season, sport)) return [];
  const teams = list(game.competitors).map(c=>String(c.team?.id||''));
  if (teams.length !== 2 || teams[0] === teams[1] || teams.some(id=>!allowedTeams.has(id))) return [];
  const meta={gameId:String(header.id),date:game.date};
  const rows=[];

  if (config.kind === 'team') {
    for (const side of list(summary.boxscore?.teams)) {
      const offense=String(side.team?.id||''), defense=teams.find(id=>id!==offense);
      if (!teams.includes(offense) || !defense) continue;
      for (const [metric,spec] of Object.entries(config.metrics)) {
        const stat=list(side.statistics).find(x=>x?.name===spec.label);
        const value=stat?numeric(stat.displayValue ?? stat.value):null;
        if (value!==null) rows.push({position:'ALL',metric,total:value,teamId:defense,offenseTeamId:offense,...meta});
      }
    }
    return rows;
  }

  const trackedGroups = new Set(Object.values(config.metrics).map(m=>m.group).filter(Boolean));
  const nameOf = g => g?.name || g?.type || null;
  for (const box of list(summary.boxscore?.players)) {
    const offense=String(box.team?.id||''), defense=teams.find(id=>id!==offense);
    if (!teams.includes(offense) || !defense) continue;
    const totals = new Map(), seen = new Set(), invalid = new Set();
    const groupRole = group => config.kind === 'group' ? config.groups[nameOf(group)] || null : null;
    const positionOf = (player, group) => config.kind === 'group' ? groupRole(group)
      : normalizePosition(sport, player.athlete?.position?.abbreviation)
        || normalizePosition(sport, rosterPositions.get(`${offense}:${player.athlete?.id}`))
        || normalizePosition(sport, athletePositions.get(String(player.athlete?.id || '')));
    // Only groups that feed a ranked stat matter: an unclassified kicker cannot
    // hide passing yards. Within them, an unknown role could hide production
    // at any position, so this team's game is left out rather than guessed.
    const relevant = list(box.statistics).filter(g => config.kind === 'group' ? Boolean(groupRole(g)) : (!trackedGroups.size || trackedGroups.has(nameOf(g))));
    // Box scores carry a "Team" line (a negative id) for team plays such as
    // kneel-downs; it is no player and belongs to no position.
    const person = p => { const id = String(p.athlete?.id || ''); return id !== '' && !id.startsWith('-'); };
    if (config.kind === 'position' && relevant.some(g => list(g.athletes).some(p => p.didNotPlay !== true && person(p) && !positionOf(p, g)))) continue;
    for (const group of relevant) {
      const labels=list(group.labels);
      // A present, valid category describes the whole team-game, including
      // positions with no entries. An absent category is not a zero.
      if (!Array.isArray(group.athletes) || group.athletes.some(p=>p.didNotPlay!==true&&(!Array.isArray(p.stats)||p.stats.length!==labels.length))) continue;
      const role = groupRole(group);
      for (const [metric,spec] of Object.entries(config.metrics)) {
        if ((spec.group&&nameOf(group)!==spec.group)||!labels.includes(spec.label)) continue;
        for (const position of role ? [role] : config.positions) {
          if (spec.positions && !spec.positions.includes(position)) continue;
          const key=`${position}|${metric}`;
          if(!totals.has(key))totals.set(key,{position,metric,total:0});
        }
      }
      for (const player of list(group.athletes)) {
        const pos=positionOf(player, group), pid=String(player.athlete?.id||'');
        if (!pos || !pid || player.didNotPlay === true || !Array.isArray(player.stats) || player.stats.length !== labels.length) continue;
        for (const [metric,spec] of Object.entries(config.metrics)) {
          if (spec.group && nameOf(group)!==spec.group) continue;
          if (spec.positions && !spec.positions.includes(pos)) continue;
          const index=labels.indexOf(spec.label); if(index<0) continue;
          const value=parseValue(player.stats[index], spec.parse);
          if(value===null){invalid.add(`${pos}|${metric}`);continue;}
          if(seen.has(`${pid}|${metric}`)) continue;
          seen.add(`${pid}|${metric}`);
          const key=`${pos}|${metric}`, old=totals.get(key)||{position:pos,metric,total:0};
          old.total+=value;totals.set(key,old);
        }
      }
    }
    for (const [metric, parts] of Object.entries(config.derived || {})) {
      for (const position of config.positions) {
        const pieces = parts.map(part => totals.get(`${position}|${part}`));
        if (pieces.every(Boolean) && parts.every(part => !invalid.has(`${position}|${part}`))) totals.set(`${position}|${metric}`, { position, metric, total: pieces.reduce((sum, row) => sum + row.total, 0) });
      }
    }
    for(const row of totals.values()) if(!invalid.has(`${row.position}|${row.metric}`)) rows.push({...row,teamId:defense,offenseTeamId:offense,...meta});
  }
  return rows;
}

export function rankPositionRows(input, teams, { partial = false, minCohort = 12 } = {}) {
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
    // A college league ranks among the teams that have three, and says so.
    const full=cohort.length===teams.length;
    const usable=row.games>=3&&(full||(partial&&cohort.length>=minCohort));
    const rank=usable ? 1+cohort.filter(r=>r.average<row.average).length : null;
    return {teamId:row.teamId,position:row.position,metric:row.metric,average:Number(row.average.toFixed(2)),games:row.games,rank,leagueSize:usable&&!full?cohort.length:teams.length,...(usable&&!full?{partial:true}:{})};
  });
}

/** The same team-games from the other side: what each team's players at a
 * position produce per game. Rank 1 = produces the least, as for defense. */
export function rankOffenseRows(input, teams, options) {
  return rankPositionRows(input.filter(row=>row.offenseTeamId).map(row=>({...row,teamId:row.offenseTeamId})),teams,options);
}

/**
 * Pick events newest first so every team reaches `target` games with as few
 * summaries as possible: an event is taken only while one of its teams still
 * needs games. Returns event ids.
 */
export function balancedEvents(events, allowed, target, cap) {
  const count = new Map(), picked = [];
  for (const e of [...events].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))) {
    const ids = list(e.competitions?.[0]?.competitors).map(c => String(c.team?.id || c.id || ''));
    if (ids.length !== 2 || ids.some(id => !allowed.has(id))) continue;
    if (!ids.some(id => (count.get(id) || 0) < target)) continue;
    picked.push(String(e.id));
    for (const id of ids) count.set(id, (count.get(id) || 0) + 1);
    if (picked.length >= cap || [...allowed].every(id => (count.get(id) || 0) >= target)) break;
  }
  return picked;
}

const regularCompleted = (e, sport) => isRegularSeason(e.season, sport) && e.status?.type?.completed === true;
const seasonOf = e => Number(e.season?.year) || null;

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
      const windowDays=config.windowDays||DEFAULT_WINDOW_DAYS, maxEvents=config.maxEvents||DEFAULT_MAX_EVENTS;
      const since=clock-windowDays*86400000;
      const allowed=new Set(teams.map(t=>t.id));

      // Box scores (and the rosters that classify players missing from them)
      // for a set of events, reduced to ranked rows for both sides.
      async function rank(ids){
        const queue=[...ids], summaries=[];
        // Shared request cache and two workers; never run an ingestion scheduler.
        async function worker(){while(queue.length){const id=queue.shift();const summary=await request(`${prefix}/summary?event=${id}`,24*HOUR);if(summary.data&&String(summary.data.header?.id)===id)summaries.push(summary.data);}}
        await Promise.all([worker(),worker(),worker(),worker()]);
        // Rosters are only needed where the box score does not list roles.
        const rosterQueue=config.kind==='position'?[...new Set(summaries.flatMap(s=>list(s.boxscore?.players).map(t=>String(t.team?.id||''))))].filter(id=>allowed.has(id)):[], rosterPositions=new Map(), athletePositions=new Map();
        async function rosterWorker(){while(rosterQueue.length){const team=rosterQueue.shift(),response=await request(`${prefix}/teams/${team}/roster`,24*HOUR);
          const collect=items=>{for(const item of list(items)){if(item.items)collect(item.items);else if(/^\d+$/.test(String(item.id||''))&&item.position?.abbreviation){rosterPositions.set(`${team}:${item.id}`,item.position.abbreviation);athletePositions.set(String(item.id),item.position.abbreviation);}}};
          collect(response.data?.athletes);
        }}
        await Promise.all([rosterWorker(),rosterWorker()]);
        // Players on no current roster (retired, unsigned) still have an ESPN
        // athlete record with their listed role; look those up individually,
        // once, so last season's games are not lost to roster turnover.
        if(config.kind==='position'){
          const tracked=new Set(Object.values(config.metrics).map(m=>m.group).filter(Boolean));
          const unknown=[...new Set(summaries.flatMap(s=>list(s.boxscore?.players).flatMap(box=>list(box.statistics)
            .filter(g=>!tracked.size||tracked.has(g.name||g.type))
            .flatMap(g=>list(g.athletes).filter(p=>p.didNotPlay!==true).map(p=>String(p.athlete?.id||''))
              .filter(id=>/^\d+$/.test(id)&&!athletePositions.has(id)&&!list(g.athletes).find(p=>String(p.athlete?.id)===id)?.athlete?.position?.abbreviation)))))].slice(0,600);
          async function athleteWorker(){while(unknown.length){const id=unknown.shift();const r=await request(`/common/v3/sports/${family}/${league}/athletes/${id}`,7*24*HOUR);const pos=r.data?.athlete?.position?.abbreviation;if(pos&&String(r.data?.athlete?.id)===id)athletePositions.set(id,pos);}}
          await Promise.all([athleteWorker(),athleteWorker(),athleteWorker(),athleteWorker()]);
        }
        // A player's role rarely changes with a trade, so a player listed on any
        // current roster keeps that role for last season's games too.
        const rows=summaries.flatMap(summary=>positionGameRows(summary,sport,allowed,rosterPositions,athletePositions));
        const dates=summaries.map(s=>Date.parse(s.header?.competitions?.[0]?.date)).filter(Number.isFinite);
        const options={partial:config.partial===true};
        return {ranked:rankPositionRows(rows,teams,options),offenseRows:rankOffenseRows(rows,teams,options),from:dates.length?Math.min(...dates):null,through:dates.length?Math.max(...dates):null};
      }
      const complete=r=>r.ranked.some(row=>row.rank!==null);

      // 1) This season: the recent window, as before.
      // Scoreboard range queries can fail even when daily boards are available.
      // Load a bounded cohort through the existing cache, not paid feeds.
      const days=Array.from({length:windowDays},(_,i)=>date(clock-i*86400000)), events=[];
      let successfulBoards=0;
      async function dayWorker(){while(days.length){const day=days.shift();const board=await request(`${prefix}/scoreboard?dates=${day}&limit=1000${config.query?'&'+config.query:''}`,HOUR);if(!board.data)continue;successfulBoards++;events.push(...list(board.data.events).filter(e=>regularCompleted(e,sport)&&Date.parse(e.date)>=since&&Date.parse(e.date)<clock));}}
      await Promise.all([dayWorker(),dayWorker()]);
      if(!successfulBoards)return {...absent('Completed-game scoreboards could not load. Try again shortly.'),teams,positions:config.positions};
      // Newest games first, taken only while a team still needs games, so the
      // summary budget reaches every team instead of the busiest ones.
      const unique=[...new Map(events.filter(e=>/^\d+$/.test(String(e.id))).map(e=>[String(e.id),e])).values()];
      const recentIds=balancedEvents(unique,allowed,5,maxEvents);
      let result=await rank(recentIds), fallback=null;

      // 2) Early or off season, no team-complete ranking yet: the most recent
      // completed regular season's final weeks, never mixed with another season.
      // The latest regular season first (a league whose season just ended);
      // if that cannot rank every team either, the one before it.
      let before=Infinity;
      for(let attempt=0;attempt<2&&!complete(result);attempt++){
        const prior=await priorSeasonEvents({request,prefix,sport,clock,allowed,query:config.query,beforeSeason:before});
        if(!prior.events.length||prior.season===null)break;
        const ids=balancedEvents(prior.events,allowed,5,Math.max(maxEvents,120));
        const candidate=await rank(ids);
        if(complete(candidate)){result=candidate;fallback={season:prior.season,label:prior.label};}
        before=prior.season;
      }

      const {ranked,offenseRows}=result;
      const from=result.from??since, through=result.through??clock;
      const value={ok:true,available:ranked.length>0,sport,positions:config.positions,teams,rows:ranked,offenseRows,source:'ESPN completed box scores',sourceUrl:`https://www.espn.com/${sport.toLowerCase()}/scoreboard`,retrievedAt:new Date(clock).toISOString(),from:new Date(from).toISOString(),through:new Date(through).toISOString(),windowDays,
        fallback:fallback?{season:fallback.season,label:fallback.label}:null,
        message:ranked.length?null:`No verified position samples were returned for the last ${windowDays} days.`,
        basis:fallback
          ? `Not enough games yet this season for every team, so ranks use the ${fallback.label} (regular season, ${new Date(from).toISOString().slice(0,10)} to ${new Date(through).toISOString().slice(0,10)}). Position totals allowed per completed game; every team has at least 3 games at the position.`
          : `Position totals allowed per completed regular-season game. Latest ${maxEvents} games within ${windowDays} days; rank requires every league team to have at least 3 games at the position. Positions use box scores or the current team roster. Games with unclassified players are excluded. Offense ranks read the same team-games from the producing side.`};
      cache.set(sport,{until:now()+HOUR,value});return value;
    })().finally(()=>pending.delete(sport));
    pending.set(sport,work);return work;
  };
}

/**
 * Completed regular-season events from the latest regular season that has
 * them, newest first, all from that one season. Football steps back by week
 * (the previous season's final weeks); basketball steps back through the
 * season's own game-day calendar, skipping postseason days. Past days are
 * immutable, so they are cached for a day.
 */
/**
 * Game days from a league calendar. Day calendars list them; list calendars
 * (European cups) give phases with a date range, which are expanded into the
 * weekdays those competitions play (Tuesday and Wednesday for the UCL).
 */
export function calendarDays(calendar, sport) {
  const out = [];
  for (const entry of list(calendar)) {
    if (typeof entry === 'string') { const t = Date.parse(entry); if (Number.isFinite(t)) out.push(t); continue; }
    const phases = list(entry?.entries).length ? entry.entries : [entry];
    for (const phase of phases) {
      if (/playoff|knockout|final/i.test(String(phase?.label || ''))) continue;
      const start = Date.parse(phase?.startDate), end = Date.parse(phase?.endDate);
      if (!Number.isFinite(start)) continue;
      if (!Number.isFinite(end) || end - start < 86400000) { out.push(start); continue; }
      const weekdays = sport === 'UCL' ? new Set([2, 3]) : null;
      for (let t = Date.UTC(new Date(start).getUTCFullYear(), new Date(start).getUTCMonth(), new Date(start).getUTCDate()); t <= end; t += 86400000) {
        if (!weekdays || weekdays.has(new Date(t).getUTCDay())) out.push(t);
      }
    }
  }
  return [...new Set(out)];
}

export async function priorSeasonEvents({request,prefix,sport,clock,allowed,query='',beforeSeason=Infinity,maxDays=16,maxBoards=80}){
  const out=[];let season=null,boards=0;
  const extra=query?'&'+query:'';
  const take=list=>{for(const e of list){if(!regularCompleted(e,sport)||Date.parse(e.date)>=clock)continue;const y=seasonOf(e);if(!(y<beforeSeason))continue;if(season===null)season=y;if(y===season)out.push(e);}};
  const current=await request(`${prefix}/scoreboard?limit=1${extra}`,HOUR);
  const meta=current.data?.leagues?.[0];
  const year=Number(meta?.season?.year)||new Date(clock).getUTCFullYear();
  if(sport==='NFL'||sport==='NCAAF'){
    // The previous season's final six regular-season weeks that had games.
    let weeks=0;
    for(let week=18;week>=6&&weeks<6&&boards<maxBoards;week--){
      const board=await request(`${prefix}/scoreboard?dates=${year-1}&seasontype=2&week=${week}&limit=1000${extra}`,24*HOUR);boards++;
      const before=out.length;take(list(board.data?.events));
      if(out.length>before)weeks++;
    }
  }else{
    // Walk this season's game days back, then last season's, until the
    // regular season yields maxDays days (postseason days are skipped).
    const seasons=[meta,(await request(`${prefix}/scoreboard?dates=${year-1}&limit=1${extra}`,24*HOUR)).data?.leagues?.[0]];
    let regularDays=0;
    for(const lg of seasons){
      const days=calendarDays(lg?.calendar,sport).filter(t=>t<clock).sort((a,b)=>b-a);
      for(const t of days){
        if(regularDays>=maxDays||boards>=maxBoards)break;
        const day=new Date(t).toISOString().slice(0,10).replaceAll('-','');
        const board=await request(`${prefix}/scoreboard?dates=${day}&limit=1000${extra}`,clock-t>3*86400000?24*HOUR:HOUR);boards++;
        const before=out.length;take(list(board.data?.events));
        if(out.length>before)regularDays++;
      }
      if(season!==null)break;
    }
  }
  const label=season===null?null:season<year?'last season\'s final weeks':'final weeks of the regular season';
  return {events:out.filter(e=>list(e.competitions?.[0]?.competitors).every(c=>allowed.has(String(c.team?.id||c.id||'')))),season,label};
}
