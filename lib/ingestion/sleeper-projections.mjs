import { canonicalSport, marketContract, numeric } from '../data-sources/espn/stat-contract.mjs';
const text=v=>String(v??'').trim();
const iso=v=>v&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
const NFL_STATS={pass_yd:'Passing Yards',pass_td:'Passing Touchdowns',pass_att:'Passing Attempts',pass_cmp:'Passing Completions',rush_yd:'Rushing Yards',rush_att:'Rushing Attempts',rec:'Receptions',rec_yd:'Receiving Yards',rec_tgt:'Receiving Targets'};

/** Sleeper projections are projections, not sportsbook offers. They become research context only. */
export function normalizeSleeperProjections(payload,{players={},season,week}={}){
  const rows=Array.isArray(payload)?payload:Object.values(payload||{}),out=[];
  for(const row of rows){const playerId=text(row.player_id||row.playerId||row.id),p=players[playerId]||{},stats=row.stats||row.projections||row;
    if(!playerId||!stats||typeof stats!=='object')continue;
    for(const [key,market] of Object.entries(NFL_STATS)){const value=numeric(stats[key]);if(value===null)continue;const contract=marketContract({sport:'NFL',market});if(!contract)continue;
      out.push({sourceId:`sleeper:${season||''}:${week||''}:${playerId}:${key}`,book:'sleeper',nativePlayerId:playerId,playerName:text(p.full_name||[p.first_name,p.last_name].filter(Boolean).join(' ')),sport:canonicalSport('NFL'),market,line:value,team:text(p.team),opponent:'',nativeEventId:`sleeper:${season||''}:${week||''}:${text(row.game_id||row.gameId||row.opponent||'week')}`,homeTeam:'',awayTeam:'',gameStartTime:iso(row.game_start_time||row.start_time)||new Date(Date.now()+24*3600_000).toISOString(),updatedAt:new Date().toISOString(),position:text(p.position),headshot:'',sides:[],overOdds:null,underOdds:null,contract,isAlternate:false,promotion:null,projectionOnly:true});
    }
  }
  return out.filter(r=>r.playerName);
}
