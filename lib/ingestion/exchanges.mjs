import {record} from './normalize.mjs';
import {numeric} from '../data-sources/espn/stat-contract.mjs';
const list=v=>Array.isArray(v)?v:[];
const strings=v=>{try{return list(typeof v==='string'?JSON.parse(v):v);}catch{return [];}};
const price=v=>{const n=numeric(v);return n!==null&&n>0&&n<1?n:null;};
/** Exchange ask -> gross American equivalent, before fees. Never a forecast. */
export function americanFromAsk(value){const p=price(value);return p===null?null:Math.round((p>=.5?-100*p/(1-p):100*(1-p)/p)*100)/100;}
function mappingFor(book,id,title,rules,mappings){
 const matches=list(mappings).filter(m=>m.book===book&&m.sourceId===String(id));
 if(matches.length!==1)return null;const m=matches[0];
 // Mappings are reviewed exact contracts, not name/number guesses from titles.
 if(m.verified!==true||!m.evidenceUrl||m.expectedTitle!==title||m.expectedRules!==rules||m.period!=='game'||m.yesSide!=='OVER'||m.settlement!=='strict-over-no-push'||!m.expiresAt||Date.parse(m.expiresAt)<=Date.now())return null;
 return m;
}
export function normalizeKalshi(payload,{mappings=[]}={}){
 if(!Array.isArray(payload?.markets))throw Error('INVALID_KALSHI_SCHEMA');
 const contracts=[],records=[];
 for(const m of payload.markets){
  if(!['open','active'].includes(m.status)||m.market_type!=='binary'||m.mve_collection_ticker)continue;
  const yes=price(m.yes_ask_dollars),no=price(m.no_ask_dollars);
  contracts.push({id:m.ticker,eventId:m.event_ticker,title:m.title,updatedAt:m.updated_time||null,yesAsk:yes,noAsk:no});
  const map=mappingFor('kalshi',m.ticker,m.title,m.rules_primary,mappings);
  if(!map||m.strike_type!=='greater'||numeric(m.floor_strike)!==numeric(map.line)||m.cap_strike!=null)continue;
  // Integer thresholds have asymmetric equality semantics. Do not silently
  // turn "25 or more" into a sportsbook O/U 25 (which can push).
  if(!Number.isFinite(map.line)||Number.isInteger(map.line))continue;
  const r=record({...map,book:'kalshi',updatedAt:m.updated_time,sides:['OVER','UNDER']});
  if(r){r.overOdds=americanFromAsk(yes);r.underOdds=americanFromAsk(no);records.push(r);}
 }
 return {records,contracts};
}
export function normalizePolymarket(payload,{mappings=[]}={}){
 if(!Array.isArray(payload))throw Error('INVALID_POLYMARKET_SCHEMA');
 const contracts=[],records=[];
 for(const e of payload)for(const m of list(e.markets)){
  if(e.closed===true||m.closed===true||m.active!==true||m.acceptingOrders!==true)continue;
  const outcomes=strings(m.outcomes);if(outcomes.length!==2||outcomes[0]!=='Yes'||outcomes[1]!=='No')continue;
  // Gamma outcomePrices are indicative marks, not executable two-sided odds.
  contracts.push({id:String(m.id),eventId:String(e.id),title:m.question,updatedAt:m.updatedAt||null,indicativePrices:strings(m.outcomePrices).map(price)});
  const map=mappingFor('polymarket',m.id,m.question,m.description,mappings);
  if(!map||numeric(m.line)!==numeric(map.line)||Number.isInteger(map.line)||!Number.isFinite(map.line))continue;
  const r=record({...map,book:'polymarket',updatedAt:m.updatedAt,sides:['OVER','UNDER']});
  if(r)records.push(r); // No invented odds from indicative Gamma marks.
 }
 return {records,contracts};
}
