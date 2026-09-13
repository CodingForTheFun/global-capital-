import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {normalizePrizePicks,normalizeUnderdog,normalizeSleeper,normalizedFeedBoard} from './normalize.mjs';
import {normalizeKalshi,normalizePolymarket} from './exchanges.mjs';
const THREE_MINUTES=180000;
const TEN_MINUTES=600000;
const PUBLIC_UA=process.env.AUTOSCOUT_PUBLIC_FEED_USER_AGENT||'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1';
export const PUBLIC_FEEDS=Object.freeze([
 {id:'prizepicks',url:'https://api.prizepicks.com/projections?per_page=250',ttl:THREE_MINUTES},
 {id:'underdog',url:'https://api.underdogfantasy.com/beta/v5/over_under_lines',ttl:THREE_MINUTES},
 {id:'sleeper',url:'https://api.sleeper.app/v1/players/nfl',ttl:86400000},
 {id:'kalshi',url:'https://external-api.kalshi.com/trade-api/v2/markets?status=open&mve_filter=exclude&limit=1000',ttl:TEN_MINUTES},
 {id:'polymarket',url:'https://gamma-api.polymarket.com/events?active=true&closed=false&limit=100',ttl:TEN_MINUTES},
]);
const empty=()=>({records:[],contracts:[],players:[]});
/** One cache and single-flight per provider across leagues. Only the existing
 * ingestion owner calls refresh; browser reads never fan out to public feeds. */
export function createPublicFeeds({fetcher=globalThis.fetch,now=Date.now,storeDir=null,mappings=[],feeds=PUBLIC_FEEDS}={}){
 const state=new Map(),pending=new Map(),boards=new Map();let loadPromise,refreshPromise;
 const file=storeDir?path.join(storeDir,'public-feeds-v1.json'):null;
 let savePromise=Promise.resolve();
 async function persist(){if(!file)return;const snapshot=JSON.stringify({version:1,feeds:Object.fromEntries(state)});savePromise=savePromise.catch(()=>{}).then(async()=>{await fs.mkdir(storeDir,{recursive:true});const temp=file+'.'+crypto.randomUUID()+'.tmp';try{await fs.writeFile(temp,snapshot);await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true}).catch(()=>{});}});await savePromise;}
 async function load(){if(!loadPromise)loadPromise=(async()=>{if(!file)return;try{const data=JSON.parse(await fs.readFile(file,'utf8'));if(data.version===1)for(const feed of feeds){const s=data.feeds?.[feed.id];if(s&&Array.isArray(s.records)&&Array.isArray(s.players)&&Array.isArray(s.contracts))state.set(feed.id,s);}}catch{}})();await loadPromise;}
 async function get(url){
  const response=await fetcher(url,{headers:{accept:'application/json,text/plain,*/*','user-agent':PUBLIC_UA,'accept-language':'en-US,en;q=0.9','cache-control':'no-cache'},signal:AbortSignal.timeout(12000),redirect:'error'});
  if(!response.ok){const retry=response.headers.get('retry-after');const seconds=retry&&/^\d+(?:\.\d+)?$/.test(retry)?Number(retry)*1000:Date.parse(retry||'')-now();throw Object.assign(Error('PUBLIC_FEED_HTTP'),{status:response.status,retryMs:Number.isFinite(seconds)&&seconds>0?seconds:null});}
  const reader=response.body?.getReader();if(!reader)return response.json();let total=0;const chunks=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>16*1024*1024)throw Error('PUBLIC_FEED_TOO_LARGE');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }
 async function fetchPages(feed){
  let url=feed.url,combined=null,partial=false;const seen=new Set();
  for(let page=0;page<10;page++){
   if(seen.has(url))throw Error('PUBLIC_FEED_PAGINATION_LOOP');seen.add(url);
   const data=await get(url);let next=null;
   if(feed.id==='prizepicks'){
    if(!Array.isArray(data.data)||!Array.isArray(data.included))throw Error('INVALID_PRIZEPICKS_SCHEMA');
    combined=combined?{...data,data:[...combined.data,...data.data],included:[...new Map([...combined.included,...data.included].map(r=>[r.type+':'+r.id,r])).values()]}:data;
    next=typeof data.links?.next==='string'?data.links.next:data.links?.next?.href;
   }else if(feed.id==='kalshi'){
    if(!Array.isArray(data.markets))throw Error('INVALID_KALSHI_SCHEMA');combined={markets:[...(combined?.markets||[]),...data.markets]};
    if(data.cursor){const u=new URL(feed.url);u.searchParams.set('cursor',data.cursor);next=u.href;}
   }else if(feed.id==='polymarket'){
    if(!Array.isArray(data))throw Error('INVALID_POLYMARKET_SCHEMA');combined=[...(combined||[]),...data];
    if(data.length===100){const u=new URL(feed.url);u.searchParams.set('offset',String((page+1)*100));next=u.href;}
   }else combined=data;
   if(!next)break;
   const u=new URL(next,feed.url),base=new URL(feed.url);if(u.origin!==base.origin||u.pathname!==base.pathname)throw Error('PUBLIC_FEED_BAD_NEXT');
   url=u.href;if(page===9)partial=true;
  }
  return {data:combined,partial};
 }
 async function refreshOne(feed){
  await load();if(pending.has(feed.id))return pending.get(feed.id);
  const previous=state.get(feed.id);if(previous?.nextAt>now())return previous;
  const task=(async()=>{
   try{
    const {data,partial}=await fetchPages(feed);let parsed=empty();
    if(feed.id==='prizepicks')parsed.records=normalizePrizePicks(data);
    if(feed.id==='underdog')parsed.records=normalizeUnderdog(data);
    if(feed.id==='sleeper')parsed.players=normalizeSleeper(data);
    if(feed.id==='kalshi')Object.assign(parsed,normalizeKalshi(data,{mappings}));
    if(feed.id==='polymarket')Object.assign(parsed,normalizePolymarket(data,{mappings}));
    // Empty valid snapshots remove closed lines; failed snapshots retain the last good board.
    parsed.active_props=normalizedFeedBoard(parsed.records).active_props;
    state.set(feed.id,{...parsed,fetchedAt:new Date(now()).toISOString(),nextAt:now()+feed.ttl,failures:0,status:parsed.records.length?'available':feed.id==='sleeper'?'roster_only':parsed.contracts.length?'unmapped_contracts':'no_props',partial});
   }catch(error){const failures=(previous?.failures||0)+1;const delay=error.retryMs||Math.min(3600000,60000*2**Math.min(6,failures-1))+Math.floor(Math.random()*10000);state.set(feed.id,{...(previous||empty()),failures,nextAt:now()+delay,status:error.status===429?'cooldown':'unavailable',httpStatus:error.status||null});}
   await persist().catch(()=>{});return state.get(feed.id);
  })();pending.set(feed.id,task);try{return await task;}finally{pending.delete(feed.id);}
 }
 function refresh(){if(refreshPromise)return refreshPromise;refreshPromise=(async()=>{await load();
  // Sequential requests: conservative global concurrency of one, including pagination.
  for(const feed of feeds)await refreshOne(feed);
 })().finally(()=>{refreshPromise=null;});return refreshPromise;}
 async function board(sport,reference){await load();const version=[Math.floor(now()/60000),...state.values()].map(s=>typeof s==='number'?s:s.fetchedAt).join('|'),cached=boards.get(sport);
  if(cached?.source===reference.props&&cached.version===version)return cached.value;
  const records=[];for(const s of state.values()){if(!s.fetchedAt)continue;for(const r of s.records)if(r.sport===sport&&Date.parse(r.gameStartTime)>now())records.push(r);}
  const value=normalizedFeedBoard(records,reference);boards.set(sport,{source:reference.props,version,value});return value;
 }
 function health(){return feeds.map(f=>{const s=state.get(f.id);return {id:f.id,status:s?.status||'not_checked',lineCount:s?.records?.length||0,rosterCount:s?.players?.length||0,contractCount:s?.contracts?.length||0,fetchedAt:s?.fetchedAt||null,nextAt:s?.nextAt||null,partial:!!s?.partial};});}
 return {refresh,board,health,load};
}
const dataDir=process.env.DATA_DIR||path.join(process.cwd(),'data');
let mappings=[];
// Optional reviewed contract mappings; no API credentials are involved.
if(process.env.AUTOSCOUT_EXCHANGE_MAPPINGS_FILE){try{mappings=JSON.parse(await fs.readFile(process.env.AUTOSCOUT_EXCHANGE_MAPPINGS_FILE,'utf8'));}catch{}}
export const publicFeeds=createPublicFeeds({storeDir:path.join(dataDir,'autoscout','supplemental'),mappings});
export async function appendPublicFeeds(board,sport,{refresh=false}={}){
 if(refresh)await publicFeeds.refresh();
 const supplemental=await publicFeeds.board(sport,board);
 if(!supplemental.props.length)return {...board,meta:{...board.meta,publicFeeds:publicFeeds.health()}};
 const data={};for(const key of ['events','players','props','lines'])data[key]=[...new Map([...(supplemental.data[key]||[]),...(board.data?.[key]||[])].map(r=>[r.id,r])).values()];
 const props=[...new Map([...supplemental.props,...(board.props||[])].map(r=>[r.id,r])).values()];
 const books=[...new Set(props.map(r=>r.sportsbookKey))];
 return {...board,props,data,meta:{...board.meta,publicFeeds:publicFeeds.health(),sportsbooks:books,sportsbookCount:books.length,lineCount:props.length,propCount:data.props.length,events:data.events.length||board.meta?.events, supplemental:true}};
}
