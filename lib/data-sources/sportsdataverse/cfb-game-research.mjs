// Verified NCAAF per-player completed-game history from SportsDataverse's
// ESPN college-football player-box + schedule release archives.
//
// Historical research only. This module never supplies current prop lines,
// prices, books, provider freshness or projected values.
import { normalizePlayerName } from '../contract.mjs';
import { marketContract, numeric } from '../espn/stat-contract.mjs';
import { samePublicTeam } from '../espn/identity.mjs';
import { parseCsv } from './wnba-game-research.mjs';

const BASE = 'https://github.com/sportsdataverse/sportsdataverse-data/releases/download';
const PLAYER_TAG = 'espn_cfb_player_box';
const SCHEDULE_TAG = 'espn_cfb_schedules';
const MAX_PLAYER_BYTES = 12 * 1024 * 1024;
const MAX_SCHEDULE_BYTES = 1024 * 1024;
const TTL_MS = 30 * 60_000;
const cache = new Map();
const pending = new Map();

const text = value => String(value ?? '').trim();
const unavailable = (code, message, retryable = false) => ({
  ok:true, available:false, lineOnly:false, code, message, retryable, gameLog:[],
});
const yes = value => ['true','1','yes'].includes(text(value).toLowerCase());

export function cfbPlayerBoxUrl(season) {
  return `${BASE}/${PLAYER_TAG}/player_box_${season}.csv`;
}
export function cfbScheduleUrl(season) {
  return `${BASE}/${SCHEDULE_TAG}/cfb_schedule_${season}.csv`;
}

async function loadCsv(url, maxBytes, { fetcher = globalThis.fetch, now = Date.now, cacheEnabled = true } = {}) {
  const hit = cache.get(url);
  if (cacheEnabled && hit && hit.expires > now()) return { rows:hit.rows, cached:true };
  if (pending.has(url)) return pending.get(url);
  const work = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    timer.unref?.();
    try {
      const response = await fetcher(url, {
        method:'GET', redirect:'follow', credentials:'omit',
        headers:{ accept:'text/csv' }, signal:controller.signal,
      });
      if (!response?.ok) throw Object.assign(Error('CFB_ARCHIVE_HTTP'), { code:'CFB_ARCHIVE_HTTP', status:response?.status || 0 });
      const length = Number(response.headers?.get?.('content-length'));
      if (Number.isFinite(length) && length > maxBytes) throw Object.assign(Error('CFB_ARCHIVE_TOO_LARGE'), { code:'CFB_ARCHIVE_TOO_LARGE' });
      const body = await response.text();
      if (Buffer.byteLength(body, 'utf8') > maxBytes) throw Object.assign(Error('CFB_ARCHIVE_TOO_LARGE'), { code:'CFB_ARCHIVE_TOO_LARGE' });
      const rows = parseCsv(body);
      if (!rows.length) throw Object.assign(Error('CFB_ARCHIVE_EMPTY'), { code:'CFB_ARCHIVE_EMPTY' });
      if (cacheEnabled) {
        cache.set(url, { rows, expires:now() + TTL_MS });
        while (cache.size > 6) cache.delete(cache.keys().next().value);
      }
      return { rows, cached:false };
    } finally {
      clearTimeout(timer);
    }
  })().finally(() => pending.delete(url));
  pending.set(url, work);
  return work;
}

function pair(value) {
  const match = text(value).match(/^(-?\d+(?:\.\d+)?)\s*[/\\-]\s*(-?\d+(?:\.\d+)?)$/);
  return match ? [Number(match[1]), Number(match[2])] : [null,null];
}

function categoryRows(rows) {
  return new Map(rows.map(row => [text(row.category).toLowerCase(), row]));
}

function fieldValue(fields, field) {
  const passing=fields.get('passing'), rushing=fields.get('rushing'), receiving=fields.get('receiving');
  const defensive=fields.get('defensive'), interceptions=fields.get('interceptions');
  const kicking=fields.get('kicking'), punting=fields.get('punting');
  const n = (row,key) => row ? numeric(row[key]) : null;
  switch (field) {
    case 'PassingCompletions': return pair(passing?.completions_passing_attempts)[0];
    case 'PassingAttempts': return pair(passing?.completions_passing_attempts)[1];
    case 'PassingYards': return n(passing,'passing_yards');
    case 'PassingTouchdowns': return n(passing,'passing_touchdowns');
    case 'PassingInterceptions': return n(passing,'interceptions');
    case 'RushingAttempts': return n(rushing,'rushing_attempts');
    case 'RushingYards': return n(rushing,'rushing_yards');
    case 'RushingTouchdowns': return n(rushing,'rushing_touchdowns');
    case 'RushingLongest': return n(rushing,'long_rushing');
    case 'Receptions': return n(receiving,'receptions');
    case 'ReceivingYards': return n(receiving,'receiving_yards');
    case 'ReceivingTouchdowns': return n(receiving,'receiving_touchdowns');
    case 'ReceivingLongest': return n(receiving,'long_reception');
    case 'TotalTackles': return n(defensive,'total_tackles');
    case 'SoloTackles': return n(defensive,'solo_tackles');
    case 'AssistedTackles': {
      const total=n(defensive,'total_tackles'), solo=n(defensive,'solo_tackles');
      return total!==null&&solo!==null&&total>=solo ? Number((total-solo).toFixed(3)) : null;
    }
    case 'Sacks': return n(defensive,'sacks');
    case 'DefensiveInterceptions': return n(interceptions,'interceptions') ?? n(defensive,'interceptions');
    case 'FieldGoalsMade': return pair(kicking?.field_goals_made_field_goal_attempts)[0];
    case 'ExtraPointsMade': return pair(kicking?.extra_points_made_extra_point_attempts)[0];
    case 'KickingPoints': return n(kicking,'total_kicking_points');
    case 'Punts': return n(punting,'punts');
    case 'PuntsInside20': return n(punting,'punts_inside20');
    default: return null;
  }
}

function scheduleMap(rows) {
  const out=new Map();
  for(const row of rows) {
    const id=text(row.game_id);
    if(id && !out.has(id)) out.set(id,row);
  }
  return out;
}

function teamMatchesForRow(row, schedule, wanted) {
  if (!wanted || !schedule) return false;
  const teamId=text(row.team_id);
  if (teamId === text(schedule.home_id)) {
    return [schedule.home_abbreviation,schedule.home_location,schedule.home_team].some(v => samePublicTeam(v,wanted,'NCAAF'));
  }
  if (teamId === text(schedule.away_id)) {
    return [schedule.away_abbreviation,schedule.away_location,schedule.away_team].some(v => samePublicTeam(v,wanted,'NCAAF'));
  }
  return false;
}

function chooseIdentity(rows, schedules, params) {
  const wanted=normalizePlayerName(params.playerName);
  const named=rows.filter(row => row.athlete_id && normalizePlayerName(row.athlete_name)===wanted);
  if(!named.length)return null;
  const ids=[...new Set(named.map(row=>text(row.athlete_id)).filter(Boolean))];
  if(ids.length===1)return {id:ids[0],rows:named};
  const team=text(params.team);
  if(!team)return null;
  const matchedIds=[...new Set(named.filter(row=>teamMatchesForRow(row,schedules.get(text(row.game_id)),team)).map(row=>text(row.athlete_id)).filter(Boolean))];
  if(matchedIds.length!==1)return null;
  return {id:matchedIds[0],rows:named.filter(row=>text(row.athlete_id)===matchedIds[0])};
}

function normalizeGames(identity, schedules, params, fields, before) {
  const grouped=new Map();
  for(const row of identity.rows) {
    const gameId=text(row.game_id);
    if(!gameId)continue;
    const bucket=grouped.get(gameId)||[];
    bucket.push(row);grouped.set(gameId,bucket);
  }
  const output=[];
  for(const [gameId,rows] of grouped) {
    const schedule=schedules.get(gameId);
    if(!schedule)continue;
    const completed=yes(schedule.status_type_completed)||text(schedule.status_type_name).toUpperCase()==='STATUS_FINAL'||/^final$/i.test(text(schedule.status_type_detail));
    const dateMs=Date.parse(schedule.game_date);
    const seasonType=Number(schedule.season_type);
    if(!completed||!Number.isFinite(dateMs)||dateMs>=before||![2,3].includes(seasonType))continue;
    if(params.eventId&&text(params.eventId)===gameId)continue;
    const categories=categoryRows(rows);
    const values=fields.map(field=>fieldValue(categories,field));
    if(values.some(value=>value===null))continue;
    const value=Number(values.reduce((sum,n)=>sum+n,0).toFixed(3));
    const teamId=text(rows[0]?.team_id);
    const home=teamId===text(schedule.home_id), away=teamId===text(schedule.away_id);
    if(!home&&!away)continue;
    const team=home?text(schedule.home_abbreviation):text(schedule.away_abbreviation);
    const opponent=home?text(schedule.away_abbreviation):text(schedule.home_abbreviation);
    const scoreFor=numeric(home?schedule.home_score:schedule.away_score);
    const scoreAgainst=numeric(home?schedule.away_score:schedule.home_score);
    const gameResult=scoreFor!==null&&scoreAgainst!==null ? (scoreFor===scoreAgainst?'T':scoreFor>scoreAgainst?'W':'L') : null;
    const statValues=Object.fromEntries(fields.map((field,i)=>[field,values[i]]));
    output.push({
      gameId:`ncaaf:${gameId}`,date:new Date(dateMs).toISOString(),
      opponent:opponent||null,opponentId:home&&schedule.away_id?`NCAAF:${text(schedule.away_id)}`:away&&schedule.home_id?`NCAAF:${text(schedule.home_id)}`:null,
      team:team||null,teamId:teamId?`NCAAF:${teamId}`:null,isHome:home,
      scoreFor,scoreAgainst,gameResult,value,season:text(schedule.season)||text(rows[0]?.season)||null,
      seasonType,statKind:fields.join('+'),...statValues,
    });
  }
  return output.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
}

export async function fetchCfbStatsArchiveResearch(params = {}, dependencies = {}) {
  if(!['NCAAF','CFB'].includes(String(params.sport||'').toUpperCase()))return null;
  const period=text(params.period).toLowerCase();
  if(period&&!['game','full','full_game','match','single_stat'].includes(period)) {
    return unavailable('UNSUPPORTED_MARKET','College-football archive only verifies full-game player statistics.');
  }
  const contract=marketContract({sport:'NCAAF',market:params.market,providerMarketKey:params.providerMarketKey||params.marketId||null});
  const supported=new Set(['PassingCompletions','PassingAttempts','PassingYards','PassingTouchdowns','PassingInterceptions','RushingAttempts','RushingYards','RushingTouchdowns','RushingLongest','Receptions','ReceivingYards','ReceivingTouchdowns','ReceivingLongest','TotalTackles','SoloTackles','AssistedTackles','Sacks','DefensiveInterceptions','FieldGoalsMade','ExtraPointsMade','KickingPoints','Punts','PuntsInside20']);
  if(!contract||contract.entityType!=='player'||contract.fields.some(field=>!supported.has(field))) {
    return unavailable('UNSUPPORTED_MARKET','College-football archive does not expose this exact historical statistic.');
  }
  const clock=dependencies.now||Date.now, now=clock();
  const gameStart=Date.parse(params.gameStartTime||'');
  const before=Number.isFinite(gameStart)?Math.min(now,gameStart):now;
  const season=Number.isFinite(gameStart)?new Date(gameStart).getUTCFullYear():new Date(now).getUTCFullYear();
  const take=Math.min(40,Math.max(5,Math.floor(Number(params.games)||20)));
  const players=[],schedules=new Map();let cached=true,loadError=null;
  for(const year of [season,season-1]) {
    try {
      const [p,s]=await Promise.all([
        loadCsv(cfbPlayerBoxUrl(year),MAX_PLAYER_BYTES,dependencies),
        loadCsv(cfbScheduleUrl(year),MAX_SCHEDULE_BYTES,dependencies),
      ]);
      cached=cached&&p.cached&&s.cached;
      players.push(...p.rows);
      for(const [id,row] of scheduleMap(s.rows))if(!schedules.has(id))schedules.set(id,row);
    } catch(error) {
      loadError=error;
      break;
    }
    const identity=chooseIdentity(players,schedules,params);
    if(identity&&normalizeGames(identity,schedules,params,contract.fields,before).length>=take)break;
  }
  if(!players.length&&loadError)return unavailable('RESEARCH_PROVIDER_ERROR','College-football historical archive is temporarily unavailable. Please retry.',true);
  const identity=chooseIdentity(players,schedules,params);
  if(!identity)return unavailable(loadError?'RESEARCH_PROVIDER_ERROR':'PLAYER_NOT_FOUND',
    loadError?'College-football identity verification is temporarily incomplete. Please retry.':'Player identity could not be verified in the college-football archive.',
    Boolean(loadError));
  const gameLog=normalizeGames(identity,schedules,params,contract.fields,before).slice(0,take);
  if(!gameLog.length)return unavailable('NO_GAME_LOG_DATA','No verified completed college-football games contain this exact statistic.');
  return {
    ok:true,available:true,source:'ESPN CFB archive via SportsDataverse',cached,entityType:'player',
    statKind:contract.fields.join('+'),
    player:{playerName:text(identity.rows[0]?.athlete_name)||text(params.playerName),providerPlayerId:`espn-cfb:${identity.id}`,team:text(params.team)||text(gameLog[0]?.team)||null,sport:'NCAAF'},
    opponent:text(params.opponent)||null,opponentId:null,isHome:null,season:String(season),gameLog,
    coverage:{source:'espn-cfb-player-box+schedules',complete:false,seasonComplete:false,returnedGames:gameLog.length,fields:[...contract.fields],historyPartial:Boolean(loadError),newestGame:gameLog[0]?.date||null,oldestGame:gameLog.at(-1)?.date||null},
  };
}
