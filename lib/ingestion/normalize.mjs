import {stableId,normalizedEvent,normalizedPlayer,normalizedProp,normalizedBookmakerLine} from '../autoscout/models.mjs';
import {marketContract,canonicalSport,numeric} from '../data-sources/espn/stat-contract.mjs';
import {normalizePlayerName} from '../data-sources/contract.mjs';
import {samePublicTeam} from '../data-sources/espn/identity.mjs';
import {PROVIDER_MARKET_KEYS} from '../data-sources/sportsdataio/markets.mjs';
import {bookId,bookInfo} from '../constants/books.mjs';
const list=v=>Array.isArray(v)?v:[];
const text=v=>typeof v==='string'?v.trim():typeof v==='number'?String(v):'';
const iso=v=>v&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
const off=o=>!o||o.active===false||o.is_active===false||o.is_live===true||o.live===true||o.live_event!=null||/^(suspended|closed|settled|removed|in_progress|unavailable)$/i.test(o.status||'');
const special=o=>o.is_promotional===true||o.is_alternate===true||o.flash_sale_line_score!=null||o.promotion!=null||o.boost!=null||/goblin|demon|boost|discount|promo|alternate/i.test([o.odds_type,o.type,o.label].join(' '));
const v2Special=o=>o?.is_promotional===true||o?.is_alternate===true||o?.promotion!=null||o?.boost!=null||/goblin|demon|boost|discount|promo|alternate/i.test([o?.odds_type,o?.label].join(' '));
const periodOK=(o,market)=>!/(?:1h|2h|[1-4]q|first half|second half|quarter|period|1st inning)/i.test(market)&&(!o.period||['game','full_game','full game'].includes(String(o.period).toLowerCase()));
function index(rows,key='id'){const m=new Map();for(const r of list(rows)){const id=text(r[key]);if(id)m.set(id,m.has(id)?null:r);}return m;}
export function record(input){
 const sport=canonicalSport(input.sport),line=numeric(input.line),start=iso(input.gameStartTime);
 const contract=marketContract({sport,market:input.market});
 if(!input.sourceId||!input.nativePlayerId||!input.playerName||line===null||!start||!contract||contract.entityType!=='player')return null;
 return {...input,sport,line,gameStartTime:start,contract,updatedAt:iso(input.updatedAt),overOdds:null,underOdds:null};
}
export function normalizePrizePicks(payload){
 if(!Array.isArray(payload?.data)||!Array.isArray(payload?.included))throw Error('INVALID_PRIZEPICKS_SCHEMA');
 const entities=index([...payload.data,...payload.included].map(r=>({...r,ref:`${r.type}:${r.id}`})),'ref');
 const rel=(r,...keys)=>{for(const k of keys){const ref=r?.relationships?.[k]?.data;const found=entities.get(`${ref?.type}:${ref?.id}`);if(found)return found;}return {};};
 const out=[];
 for(const row of payload.data){
  if(!['projection','projections'].includes(row.type))continue;
  const a=row.attributes||{},p=rel(row,'new_player','player'),pa=p.attributes||{},g=rel(row,'game'),ga=g.attributes||{};
  if(off(a)||off(pa)||off(ga)||special(a)||special(row)||!periodOK(a,a.stat_type||''))continue;
  const league=rel(row,'league').attributes||rel(p,'league').attributes||{};
  const r=record({sourceId:text(row.id),book:'prizepicks',nativePlayerId:text(p.id),playerName:pa.name||pa.display_name,sport:league.name||league.abbreviation||a.sport||pa.sport,
   market:a.stat_type||rel(row,'stat_type').attributes?.name,line:a.line_score,team:pa.team||'',opponent:a.opponent||pa.opponent||'',
   nativeEventId:text(g.id||a.game_id),homeTeam:ga.home_team||'',awayTeam:ga.away_team||'',gameStartTime:ga.start_time||a.start_time,updatedAt:a.updated_at||payload.meta?.updated_at,headshot:pa.image_url,position:pa.position,
   sides:['OVER','UNDER']});
  if(r)out.push(r);
 }
 return out;
}
export function normalizeUnderdog(payload){
 if(!Array.isArray(payload?.over_under_lines)||!Array.isArray(payload?.players)||!Array.isArray(payload?.appearances))throw Error('INVALID_UNDERDOG_SCHEMA');
 const isV2=payload?._autoscout_v2===true;
 const players=index(payload.players),appearances=index(payload.appearances),games=index(payload.games),teams=index(payload.teams);
 const out=[];
 for(const row of payload.over_under_lines){
  const ou=row.over_under||{},stat=ou.appearance_stat||{},appearance=appearances.get(text(stat.appearance_id)),p=players.get(text(appearance?.player_id)),g=games.get(text(appearance?.match_id||appearance?.game_id));
  const market=stat.display_stat||stat.stat||stat.name||'';
  if(!p||!appearance||!g||off(row)||off(p)||!periodOK(isV2?{period:null}:row,market))continue;
  if(isV2 ? (v2Special(row)||v2Special(ou)) : (off(ou)||special(row)||special(ou)))continue;
  const options=list(row.options).filter(o=>{
    if(off(o))return false;
    const choice=text(o.choice).toLowerCase();
    if(!['higher','lower','better','worse'].includes(choice))return false;
    if(isV2){
      if(v2Special(o))return false;
      const multiplier=numeric(o.payout_multiplier);
      return multiplier===null||multiplier===1;
    }
    return !special(o);
  });
  if(!isV2&&options.some(o=>numeric(o.payout_multiplier)!==null&&numeric(o.payout_multiplier)!==1))continue;
  const sides=[...new Set(options.map(o=>{
    const choice=text(o.choice).toLowerCase();
    return choice==='higher'||choice==='better'?'OVER':choice==='lower'||choice==='worse'?'UNDER':null;
  }).filter(Boolean))];
  const r=record({sourceId:text(row.id),book:'underdog',nativePlayerId:text(p.id),playerName:p.full_name||[p.first_name,p.last_name].filter(Boolean).join(' '),sport:p.sport_id||g?.sport_id,
   market,line:row.stat_value??row.line??ou.stat_value??ou.line,team:teams.get(text(appearance.team_id))?.abbr||p.team||'',opponent:'',nativeEventId:text(g?.id||appearance.match_id||appearance.game_id),
   homeTeam:teams.get(text(g?.home_team_id))?.abbr||'',awayTeam:teams.get(text(g?.away_team_id))?.abbr||'',gameStartTime:g?.scheduled_at||g?.starts_at||g?.start_time||ou.starts_at||row.starts_at,updatedAt:row.updated_at||ou.updated_at,headshot:p.image_url,position:appearance.position_id,
   sides});
  if(r&&r.sides.length)out.push(r);
 }
 return out;
}
export function normalizeSleeper(payload){
 if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('INVALID_SLEEPER_SCHEMA');
 return Object.entries(payload).filter(([,p])=>p&&p.active===true&&p.sport==='nfl'&&p.position!=='DEF').map(([id,p])=>({id:`sleeper:NFL:${id}`,provider:'sleeper',providerPlayerId:id,sport:'NFL',name:p.full_name||[p.first_name,p.last_name].filter(Boolean).join(' '),team:p.team||'',position:p.position||'',entityType:'player'})).filter(p=>p.name);
}
const canonicalKeys=[...Object.keys(PROVIDER_MARKET_KEYS),'player_kicking_points','player_tackles_assists','player_solo_tackles','player_sacks_taken','player_defensive_interceptions','pitcher_hits_allowed','pitcher_walks','pitcher_outs','player_blocked_shots'];
const contractKey=c=>c?JSON.stringify([c.category,[...c.fields].sort()]):'';
/** Unique, exact normalized name + sport + scheduled start + team evidence.
 * Ambiguous names or games are never folded into another provider's identity. */
function referenceIndex(board){
 const index=new Map(),contracts=new Map();
 for(const p of board.props||[]){
  if(p.isAlternate||p.entityType==='team')continue;
  const ck=[p.sport,p.marketId,p.market].join('|');
  if(!contracts.has(ck))contracts.set(ck,contractKey(marketContract({sport:p.sport,market:p.market,providerMarketKey:p.marketId})));
  const key=JSON.stringify([p.sport,normalizePlayerName(p.playerName),Date.parse(p.gameStartTime),contracts.get(ck)]);
  if(!index.has(key))index.set(key,new Map());index.get(key).set([p.eventId,p.playerId,p.marketId].join('|'),p);
 }
 return index;
}
function matchReference(r,index){
 const key=JSON.stringify([r.sport,normalizePlayerName(r.playerName),Date.parse(r.gameStartTime),contractKey(r.contract)]);
 const candidates=[...(index.get(key)?.values()||[])].filter(p=>
  r.team&&p.team&&samePublicTeam(r.team,p.team,r.sport)||
  r.homeTeam&&r.awayTeam&&samePublicTeam(r.homeTeam,p.homeTeam,r.sport)&&samePublicTeam(r.awayTeam,p.awayTeam,r.sport));
 return candidates.length===1?candidates[0]:null;
}
/** Persistable native collections plus the requested paired active_props shape. */
export function normalizedFeedBoard(records,reference={props:[]},at=new Date().toISOString()){
 const events=new Map(),players=new Map(),props=new Map(),lines=new Map(),flat=[],active=[],references=referenceIndex(reference);
 for(const r of records){
  const ref=matchReference(r,references),provider=r.book;
  const event=normalizedEvent({id:ref?.eventId,provider,providerEventId:ref?.eventId||`${provider}:${r.nativeEventId||r.gameStartTime+':'+r.team+':'+r.opponent+':player:'+r.nativePlayerId}`,sport:r.sport,homeTeam:ref?.homeTeam||r.homeTeam,awayTeam:ref?.awayTeam||r.awayTeam,commenceTime:r.gameStartTime,providerUpdatedAt:r.updatedAt,ingestedAt:at});
  const player=normalizedPlayer({id:ref?.playerId||stableId([provider,r.sport,r.nativePlayerId]),provider,providerPlayerId:r.nativePlayerId,sport:r.sport,name:r.playerName,team:ref?.team||r.team,position:r.position,headshotUrl:r.headshot,ingestedAt:at});
  const marketKey=ref?.marketId||canonicalKeys.find(key=>contractKey(marketContract({sport:r.sport,market:r.market,providerMarketKey:key}))===contractKey(r.contract));
  if(!marketKey)continue;
  const prop=normalizedProp({eventId:event.id,playerId:player.id,playerName:player.name,marketKey,marketName:r.market,sport:r.sport,team:player.team,provider,ingestedAt:at});
  events.set(event.id,event);players.set(player.id,player);props.set(prop.id,prop);
  for(const side of r.sides){const line=normalizedBookmakerLine({propId:prop.id,provider,bookmakerKey:provider,bookmakerName:bookInfo(provider).name,side,line:r.line,price:side==='OVER'?r.overOdds:r.underOdds,providerUpdatedAt:r.updatedAt,ingestedAt:at});lines.set(line.id,line);
   flat.push({id:line.id,source:bookInfo(provider).name,provider,sport:r.sport,eventId:event.id,playerId:player.id,playerName:player.name,entityType:'player',team:player.team,marketId:prop.marketKey,market:prop.marketName,period:'game',payoutType:['kalshi','polymarket'].includes(provider)?'exchange':'pickem',side,line:line.line,price:line.price,sportsbook:line.bookmakerName,sportsbookKey:provider,gameStartTime:event.commenceTime,homeTeam:event.homeTeam,awayTeam:event.awayTeam,isAlternate:false,providerUpdatedAt:r.updatedAt,updatedAt:r.updatedAt,ingestedAt:at});}
  active.push({id:stableId([prop.id,provider,r.line]),player_id:player.id,book_id:provider,stat_type:prop.marketKey,target_line:r.line,over_odds:r.overOdds,under_odds:r.underOdds,updated_at:r.updatedAt,event_id:event.id,sport:r.sport,source_id:r.sourceId});
 }
 return {props:flat,active_props:active,data:{events:[...events.values()],players:[...players.values()],props:[...props.values()],lines:[...lines.values()]}};
}
/** Pair ONLY the same event, player, book, market and target. Never mix prices
 * across thresholds or fill absent DFS prices using payout multipliers. */
export function activePropsFromBoard(board){
 const result=new Map();
 for(const r of board.props||[]){if(r.isAlternate||numeric(r.line)===null||!['OVER','UNDER'].includes(r.side))continue;const book=bookId(r.sportsbookKey),id=stableId([r.sport,r.eventId,r.playerId,r.marketId,book,r.line]);const updated=iso(r.providerUpdatedAt);
  const p=result.get(id)||{id,player_id:r.playerId,book_id:book,stat_type:r.marketId,target_line:r.line,over_odds:null,under_odds:null,updated_at:updated,event_id:r.eventId,sport:r.sport};
  const odds=numeric(r.price);p[r.side==='OVER'?'over_odds':'under_odds']=odds!==null&&Math.abs(odds)>=100?odds:null;
  p.updated_at=p.updated_at&&updated?(p.updated_at<updated?p.updated_at:updated):null;result.set(id,p);
 }
 return [...result.values()];
}
