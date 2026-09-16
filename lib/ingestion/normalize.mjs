import {stableId,normalizedEvent,normalizedPlayer,normalizedProp,normalizedBookmakerLine} from '../autoscout/models.mjs';
import {marketContract,canonicalSport,numeric} from '../data-sources/espn/stat-contract.mjs';
import {normalizePlayerName} from '../data-sources/contract.mjs';
import {samePublicTeam} from '../data-sources/espn/identity.mjs';
import {PROVIDER_MARKET_KEYS} from '../data-sources/sportsdataio/markets.mjs';
import {bookId,bookInfo} from '../constants/books.mjs';
const list=v=>Array.isArray(v)?v:[];
const text=v=>typeof v==='string'?v.trim():typeof v==='number'?String(v):'';
const iso=v=>v&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
// Underdog marks normal pregame objects with live_event:false — on v2 and on
// the v1 over_under_lines feed alike. Only a true/object marker means the line
// is actually live; treating any non-null value as live discarded every row.
const liveMarked=o=>o.is_live===true||o.live===true||o.live_event===true||(o.live_event&&typeof o.live_event==='object');
const off=o=>!o||o.active===false||o.is_active===false||liveMarked(o)||/^(suspended|closed|settled|removed|in_progress|unavailable)$/i.test(o.status||'');
const v2Off=off;
const special=o=>o.is_promotional===true||o.is_alternate===true||o.flash_sale_line_score!=null||o.promotion!=null||o.boost!=null||/goblin|demon|boost|discount|promo|alternate/i.test([o.odds_type,o.type,o.label].join(' '));
const v2Special=o=>o?.is_promotional===true||o?.is_alternate===true||o?.promotion!=null||o?.boost!=null||/goblin|demon|boost|discount|promo|alternate/i.test([o?.odds_type,o?.label].join(' '));
const teamUnitMarket=value=>/^(?:team|defense|defensive unit)\b|\bteam\s+(?:sacks?|points?|rebounds?|assists?|hits?|runs?|goals?)\b|\b(?:sacks?|points?)\s+allowed\b/i.test(text(value));
function marketFallbackKey(value,sport){
 const slug=String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,72);
 // PrizePicks commonly labels the canonical basketball threes market as
 // "3-PT Made". Keep the board's market id canonical so the existing ESPN
 // history contract can resolve ThreePointersMade instead of treating it as an
 // unknown fallback id.
 if(['NBA','WNBA','NCAAB'].includes(canonicalSport(sport))&&['3_pt_made','3pt_made','3_pointers_made','three_pointers_made','three_pointers','threes'].includes(slug))return 'player_threes';
 return slug?`player_${slug}`:null;
}
function inferPeriod(sport,market,period){
 const raw=text(period).toLowerCase().replace(/[\s-]+/g,'_');
 if(['game','full_game','fullgame'].includes(raw)||!raw) {
  const label=text(market).toLowerCase();
  if(String(sport).toUpperCase()==='MLB'&&/^(?:1st|first)\s+(?:inning\s+)?(?:ip|pitches?|k'?s?|strikeouts?|ha|hits? allowed|bf|batters? faced|walks?)/i.test(label))return 'first_inning';
  if(/\b(?:1q|1st quarter|first quarter)\b/i.test(label))return 'q1';
  if(/\b(?:2q|2nd quarter|second quarter)\b/i.test(label))return 'q2';
  if(/\b(?:3q|3rd quarter|third quarter)\b/i.test(label))return 'q3';
  if(/\b(?:4q|4th quarter|fourth quarter)\b/i.test(label))return 'q4';
  if(/\b(?:1h|1st half|first half)\b/i.test(label))return 'h1';
  if(/\b(?:2h|2nd half|second half)\b/i.test(label))return 'h2';
  return 'game';
 }
 const aliases={full:'game',match:'game',first_half:'h1',second_half:'h2',first_inning:'first_inning','1st_inning':'first_inning'};
 return aliases[raw]||raw.slice(0,40)||'game';
}
function index(rows,key='id'){const m=new Map();for(const r of list(rows)){const id=text(r[key]);if(id)m.set(id,m.has(id)?null:r);}return m;}
export function record(input){
 const sport=canonicalSport(input.sport),line=numeric(input.line),start=iso(input.gameStartTime),market=text(input.market);
 const contract=marketContract({sport,market,providerMarketKey:input.providerMarketKey||null});
 const fallbackMarketKey=marketFallbackKey(market,sport),period=inferPeriod(sport,market,input.period);
 if(!input.sourceId||!input.nativePlayerId||!input.playerName||!market||line===null||!start||!fallbackMarketKey||teamUnitMarket(market)||contract?.entityType==='team')return null;
 return {...input,sport,line,market,period,gameStartTime:start,contract,fallbackMarketKey,updatedAt:iso(input.updatedAt),overOdds:numeric(input.overOdds),underOdds:numeric(input.underOdds)};
}
export function normalizePrizePicks(payload){
 if(!Array.isArray(payload?.data)||!Array.isArray(payload?.included))throw Error('INVALID_PRIZEPICKS_SCHEMA');
 const entities=index([...payload.data,...payload.included].map(r=>({...r,ref:`${r.type}:${r.id}`})),'ref');
 const rel=(r,...keys)=>{for(const k of keys){const ref=r?.relationships?.[k]?.data;const found=entities.get(`${ref?.type}:${ref?.id}`);if(found)return found;}return {};};
 const out=[];
 for(const row of payload.data){
  if(!['projection','projections'].includes(row.type))continue;
  const a=row.attributes||{},p=rel(row,'new_player','player'),pa=p.attributes||{},g=rel(row,'game'),ga=g.attributes||{};
  if(off(a)||off(pa)||off(ga)||special(a)||special(row))continue;
  const league=rel(row,'league').attributes||rel(p,'league').attributes||{};
  const r=record({sourceId:text(row.id),book:'prizepicks',nativePlayerId:text(p.id),playerName:pa.name||pa.display_name,sport:league.name||league.abbreviation||a.sport||pa.sport,
   market:a.stat_type||rel(row,'stat_type').attributes?.name,line:a.line_score,period:a.period||a.projection_type||null,team:pa.team||'',opponent:a.opponent||pa.opponent||'',
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
 // Tennis, golf and MMA appearances point at solo_games rather than games.
 const soloGames=index(payload.solo_games);
 const out=[];
 for(const row of payload.over_under_lines){
  const ou=row.over_under||{},stat=ou.appearance_stat||{},appearance=appearances.get(text(stat.appearance_id)),p=players.get(text(appearance?.player_id)),eventId=text(appearance?.match_id||appearance?.game_id),g=games.get(eventId)||soloGames.get(eventId);
  const market=stat.display_stat||stat.stat||stat.name||'';
  if(!p||!appearance||!g||(isV2?(v2Off(row)||v2Off(p)):(off(row)||off(p))))continue;
  if(isV2 ? (v2Off(ou)||v2Special(row)||v2Special(ou)) : (off(ou)||special(row)||special(ou)))continue;
  const options=list(row.options).filter(o=>{
    if(isV2?v2Off(o):off(o))return false;
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
   market,line:row.stat_value??row.line??ou.stat_value??ou.line,period:row.period||ou.period||null,team:teams.get(text(appearance.team_id))?.abbr||p.team||'',opponent:'',nativeEventId:text(g?.id||appearance.match_id||appearance.game_id),
   homeTeam:teams.get(text(g?.home_team_id))?.abbr||'',awayTeam:teams.get(text(g?.away_team_id))?.abbr||'',gameStartTime:g?.scheduled_at||g?.starts_at||g?.start_time||ou.starts_at||row.starts_at,updatedAt:row.updated_at||ou.updated_at,headshot:p.image_url,
   // position_id is a UUID; position_name is the abbreviation the card shows.
   position:text(p.position_name)||text(p.position_display_name)||'',
   sides});
  if(r&&r.sides.length)out.push(r);
 }
 return out;
}
export function normalizeSleeper(payload){
 if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('INVALID_SLEEPER_SCHEMA');
 return Object.entries(payload).filter(([,p])=>p&&p.active===true&&p.sport==='nfl'&&p.position!=='DEF').map(([id,p])=>({id:`sleeper:NFL:${id}`,provider:'sleeper',providerPlayerId:id,sport:'NFL',name:p.full_name||[p.first_name,p.last_name].filter(Boolean).join(' '),team:p.team||'',position:p.position||'',entityType:'player'})).filter(p=>p.name);
}
const canonicalKeys=[...new Set([...Object.keys(PROVIDER_MARKET_KEYS),'player_kicking_points','player_tackles_assists','player_solo_tackles','player_sacks_taken','player_defensive_interceptions','pitcher_hits_allowed','pitcher_walks','pitcher_outs','player_blocked_shots','batter_strikeouts','batter_triples'])];
const contractKey=c=>c?JSON.stringify([c.category,[...c.fields].sort()]):'';
const canonicalContract=(sport,key)=>marketContract({sport,market:PROVIDER_MARKET_KEYS[key]||'',providerMarketKey:key});
const liveIdentity=(contract,marketKey,period='game')=>contractKey(contract)||`live:${marketKey||''}:${period||'game'}`;
function referenceIndex(board){
 const index=new Map(),contracts=new Map();
 for(const p of board.props||[]){
  if(p.isAlternate||p.entityType==='team')continue;
  const ck=[p.sport,p.marketId,p.market,p.period].join('|');
  if(!contracts.has(ck))contracts.set(ck,liveIdentity(marketContract({sport:p.sport,market:p.market,providerMarketKey:p.marketId}),p.marketId,p.period));
  const key=JSON.stringify([p.sport,normalizePlayerName(p.playerName),Date.parse(p.gameStartTime),contracts.get(ck)]);
  if(!index.has(key))index.set(key,new Map());index.get(key).set([p.eventId,p.playerId,p.marketId,p.period||'game'].join('|'),p);
 }
 return index;
}
function matchReference(r,index){
 const key=JSON.stringify([r.sport,normalizePlayerName(r.playerName),Date.parse(r.gameStartTime),liveIdentity(r.contract,r.fallbackMarketKey,r.period)]);
 const candidates=[...(index.get(key)?.values()||[])].filter(p=>
  r.team&&p.team&&samePublicTeam(r.team,p.team,r.sport)||
  r.homeTeam&&r.awayTeam&&samePublicTeam(r.homeTeam,p.homeTeam,r.sport)&&samePublicTeam(r.awayTeam,p.awayTeam,r.sport));
 return candidates.length===1?candidates[0]:null;
}
export function normalizedFeedBoard(records,reference={props:[]},at=new Date().toISOString()){
 const events=new Map(),players=new Map(),props=new Map(),lines=new Map(),flat=[],active=[],references=referenceIndex(reference);
 for(const r of records){
  const ref=matchReference(r,references),provider=r.book;
  const event=normalizedEvent({id:ref?.eventId,provider,providerEventId:ref?.eventId||`${provider}:${r.nativeEventId||r.gameStartTime+':'+r.team+':'+r.opponent+':player:'+r.nativePlayerId}`,sport:r.sport,homeTeam:ref?.homeTeam||r.homeTeam,awayTeam:ref?.awayTeam||r.awayTeam,commenceTime:r.gameStartTime,providerUpdatedAt:r.updatedAt,ingestedAt:at});
  const player=normalizedPlayer({id:ref?.playerId||stableId([provider,r.sport,r.nativePlayerId]),provider,providerPlayerId:r.nativePlayerId,sport:r.sport,name:r.playerName,team:ref?.team||r.team,position:r.position,headshotUrl:r.headshot,ingestedAt:at});
  const inferredKey=r.contract?canonicalKeys.find(key=>contractKey(canonicalContract(r.sport,key))===contractKey(r.contract)):null;
  const marketKey=ref?.marketId||inferredKey||r.fallbackMarketKey;
  if(!marketKey)continue;
  const period=ref?.period||r.period||'game';
  const prop=normalizedProp({eventId:event.id,playerId:player.id,playerName:player.name,marketKey,marketName:r.market,sport:r.sport,team:player.team,period,provider,ingestedAt:at});
  events.set(event.id,event);players.set(player.id,player);props.set(prop.id,prop);
  for(const side of r.sides){const line=normalizedBookmakerLine({propId:prop.id,provider,bookmakerKey:provider,bookmakerName:bookInfo(provider).name,side,line:r.line,price:side==='OVER'?r.overOdds:r.underOdds,providerUpdatedAt:r.updatedAt,ingestedAt:at});lines.set(line.id,line);
   flat.push({id:line.id,source:bookInfo(provider).name,provider,sport:r.sport,eventId:event.id,playerId:player.id,playerName:player.name,entityType:'player',team:player.team,marketId:prop.marketKey,market:prop.marketName,period:prop.period,payoutType:['kalshi','polymarket'].includes(provider)?'exchange':'pickem',side,line:line.line,price:line.price,sportsbook:line.bookmakerName,sportsbookKey:provider,gameStartTime:event.commenceTime,homeTeam:event.homeTeam,awayTeam:event.awayTeam,isAlternate:false,providerUpdatedAt:r.updatedAt,updatedAt:r.updatedAt,ingestedAt:at});}
  active.push({id:stableId([prop.id,provider,r.line]),player_id:player.id,book_id:provider,stat_type:prop.marketKey,target_line:r.line,over_odds:r.overOdds,under_odds:r.underOdds,updated_at:r.updatedAt,event_id:event.id,sport:r.sport,source_id:r.sourceId});
 }
 return {props:flat,active_props:active,data:{events:[...events.values()],players:[...players.values()],props:[...props.values()],lines:[...lines.values()]}};
}
/**
 * Rebuild the normalized {events, players, props, lines} for rows that were
 * stored flat.
 *
 * publicRows() in the sportsbook worker keeps only normalizedFeedBoard().props
 * when it persists a snapshot, so the normalized halves are discarded at write
 * time. That is why sportsbook rows reached the customer board but never
 * prop_lines: mapBoard() persists board.data, and board.data never had them.
 *
 * Everything needed survives on each flat row, and every id is either carried
 * straight through or derived exactly as it was derived originally, so this
 * reconstructs the same rows rather than creating duplicates.
 *
 * A row missing a field its model requires is skipped, never guessed at.
 */
export function normalizedDataFromBoardRows(rows=[],at=new Date().toISOString()){
 const events=new Map(),players=new Map(),props=new Map(),lines=new Map();
 for(const row of Array.isArray(rows)?rows:[]){
  try{
   const event=normalizedEvent({id:row.eventId,providerEventId:row.eventId,provider:row.provider,sport:row.sport,homeTeam:row.homeTeam,awayTeam:row.awayTeam,commenceTime:row.gameStartTime,providerUpdatedAt:row.providerUpdatedAt,ingestedAt:at});
   const player=normalizedPlayer({id:row.playerId,provider:row.provider,sport:row.sport,name:row.playerName,team:row.team,ingestedAt:at});
   const prop=normalizedProp({eventId:event.id,playerId:player.id,playerName:player.name,marketKey:row.marketId,marketName:row.market,sport:row.sport,team:player.team,period:row.period,provider:row.provider,ingestedAt:at});
   const line=normalizedBookmakerLine({id:row.id,propId:prop.id,provider:row.provider,bookmakerKey:row.sportsbookKey,bookmakerName:row.sportsbook,side:row.side,line:row.line,price:row.price,providerUpdatedAt:row.providerUpdatedAt,ingestedAt:at});
   events.set(event.id,event);players.set(player.id,player);props.set(prop.id,prop);lines.set(line.id,line);
  }catch{}
 }
 return {events:[...events.values()],players:[...players.values()],props:[...props.values()],lines:[...lines.values()]};
}
export function activePropsFromBoard(board){
 const result=new Map();
 for(const r of board.props||[]){if(r.isAlternate||numeric(r.line)===null||!['OVER','UNDER'].includes(r.side))continue;const book=bookId(r.sportsbookKey),id=stableId([r.sport,r.eventId,r.playerId,r.marketId,r.period||'game',book,r.line]);const updated=iso(r.providerUpdatedAt);
  const p=result.get(id)||{id,player_id:r.playerId,book_id:book,stat_type:r.marketId,target_line:r.line,over_odds:null,under_odds:null,updated_at:updated,event_id:r.eventId,sport:r.sport,period:r.period||'game'};
  const odds=numeric(r.price);p[r.side==='OVER'?'over_odds':'under_odds']=odds!==null&&Math.abs(odds)>=100?odds:null;
  p.updated_at=p.updated_at&&updated?(p.updated_at<updated?p.updated_at:updated):null;result.set(id,p);
 }
 return [...result.values()];
}
