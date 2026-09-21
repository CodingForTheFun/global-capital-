import { assertIngestionActive, ingestionFetch, withIngestionDeadline, INGESTION_BUDGET_MS as B } from './operation-deadline.mjs';
import { fetchPublicFeedJson, publicFeedErrorCode } from './public-feed-transport.mjs';
import { feedObservation, feedFreshness } from './source-freshness.mjs';
import { createSourceCoverageObserver } from './source-coverage-observer.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {normalizePrizePicks,normalizeUnderdog,normalizeSleeper,normalizedFeedBoard} from './normalize.mjs';
import {normalizePrizePicksSpecials,attachPrizePicksSpecialRows} from './prizepicks-specials.mjs';
import {normalizeKalshi,normalizePolymarket} from './exchanges.mjs';
import { isCustomerObservationFresh } from './customer-prop-freshness.mjs';
const THREE_MINUTES=180000;
function publicFeedsEnabledForMode() {
 const mode=String(process.env.OBLIGE_PROP_PROVIDER_MODE||process.env.PROP_PROVIDER_MODE||'auto').trim().toLowerCase();
 return !['sportsgameodds','sgo','sports-game-odds','mesh','ultimate','all'].includes(mode);
}
const STALE_ATOMIC_TEMP_MS=10*60*1000;
// A single feed response is buffered whole before it is parsed, and the parsed
// objects cost several times the bytes on the wire. The replica this runs on
// has a hard memory ceiling, so this is the limit that stops one oversized
// upstream response from taking the whole site down with it. Raising it is a
// memory decision, not a parsing one: check the replica's headroom first.
const maxFeedBytes=()=>Number(process.env.AUTOSCOUT_MAX_FEED_BYTES)>0
 ? Number(process.env.AUTOSCOUT_MAX_FEED_BYTES) : 16*1024*1024;
const SIX_HOURS=21600000;
/** Feeds whose rows can only become props through a reviewed mapping. */
const MAPPED_FEEDS=new Set(['kalshi','polymarket']);
/**
 * How long to sit on a feed before refetching it.
 *
 * Exchange contracts are only ever turned into props by mappingFor(), which
 * requires a reviewed mapping for that exact contract. With no mappings
 * configured it can never match, so refetching ten thousand Kalshi contracts
 * and three thousand Polymarket ones every three minutes is guaranteed to
 * produce nothing. Keep discovering them, just far more slowly, until someone
 * actually configures mappings.
 */
export function effectiveTtl(feed,mappings=[]){
 if(!MAPPED_FEEDS.has(feed?.id))return feed?.ttl;
 return list(mappings).some(m=>m&&m.book===feed.id)?feed.ttl:SIX_HOURS;
}
// Bump whenever a feed's URLs, headers or parsing change. refreshOne() honours
// a persisted backoff only while the stored configVersion still matches, so
// this is what stops a cooldown earned by an endpoint that no longer exists
// from suppressing the replacement that does.
const FEED_CONFIG_VERSION=5;
const list=v=>Array.isArray(v)?v:[];
const PUBLIC_UA=process.env.AUTOSCOUT_PUBLIC_FEED_USER_AGENT||'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const DEVICE_ID=process.env.AUTOSCOUT_PRIZEPICKS_DEVICE_ID||crypto.randomUUID();
const UNDERDOG_CLIENT_VERSION=process.env.AUTOSCOUT_UNDERDOG_CLIENT_VERSION||'2026.09.01';
export const PUBLIC_FEEDS=Object.freeze([
 {id:'prizepicks',urls:['https://partner-api.prizepicks.com/projections?per_page=250','https://api.prizepicks.com/projections?per_page=250'],ttl:THREE_MINUTES,origin:'https://app.prizepicks.com',referer:'https://app.prizepicks.com/',headers:{'x-device-id':DEVICE_ID,'x-device-info':'name=,os=windows,osVersion=Windows NT 10.0; Win64; x64,isSimulator=false,platform=web,appVersion=web'}},
 {id:'underdog',urls:['https://api.underdogfantasy.com/v1/over_under_lines','https://api.underdogfantasy.com/beta/v6/over_under_lines'],ttl:THREE_MINUTES,origin:'https://underdogfantasy.com',referer:'https://underdogfantasy.com/',headers:{'client-type':'web','client-version':UNDERDOG_CLIENT_VERSION}},
 {id:'sleeper',url:'https://api.sleeper.app/v1/players/nfl',ttl:86400000},
 {id:'kalshi',url:'https://external-api.kalshi.com/trade-api/v2/markets?status=open&mve_filter=exclude&limit=1000',ttl:THREE_MINUTES},
 {id:'polymarket',url:'https://gamma-api.polymarket.com/events?active=true&closed=false&limit=100',ttl:THREE_MINUTES},
]);
const empty=()=>({records:[],contracts:[],players:[],specials:[]});
/** One cache and single-flight per provider across leagues. Only the existing
 * ingestion owner calls refresh; browser reads never fan out to public feeds. */
export function createPublicFeeds({fetcher=globalThis.fetch,now=Date.now,storeDir=null,mappings=[],feeds=PUBLIC_FEEDS,observeCoverage=null}={}){
 const state=new Map(),pending=new Map(),boards=new Map();let loadPromise,refreshPromise;
 const file=storeDir?path.join(storeDir,'public-feeds-v1.json'):null;
 let savePromise=Promise.resolve();
 async function cleanupStaleTemps(){
  if(!file)return;
  let entries;try{entries=await fs.readdir(storeDir,{withFileTypes:true});}catch{return;}
  const prefix=path.basename(file)+'.',cutoff=now()-STALE_ATOMIC_TEMP_MS;
  for(const entry of entries){
   if(!entry.isFile()||!entry.name.startsWith(prefix)||!entry.name.endsWith('.tmp'))continue;
   const temp=path.join(storeDir,entry.name);let stat;try{stat=await fs.stat(temp);}catch{continue;}
   if(Number(stat.mtimeMs)<=cutoff)await fs.rm(temp,{force:true}).catch(()=>{});
  }
 }
 async function persist(){assertIngestionActive();if(!file)return;const snapshot=JSON.stringify({version:1,feeds:Object.fromEntries(state)});savePromise=savePromise.catch(()=>{}).then(async()=>{assertIngestionActive();await fs.mkdir(storeDir,{recursive:true});await cleanupStaleTemps();const temp=file+'.'+crypto.randomUUID()+'.tmp';try{await fs.writeFile(temp,snapshot);assertIngestionActive();await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true}).catch(()=>{});}});await savePromise;}
 async function load(){if(!loadPromise)loadPromise=(async()=>{if(!file)return;await cleanupStaleTemps();try{const data=JSON.parse(await fs.readFile(file,'utf8'));if(data.version===1)for(const feed of feeds){const s=data.feeds?.[feed.id];if(s&&Array.isArray(s.records)&&Array.isArray(s.players)&&Array.isArray(s.contracts))state.set(feed.id,{...s,specials:Array.isArray(s.specials)?s.specials:[]});}}catch{}})();await loadPromise;}
 function headers(feed){
  const h={accept:'application/json,text/plain,*/*','user-agent':PUBLIC_UA,'accept-language':'en-US,en;q=0.9','cache-control':'no-cache',pragma:'no-cache',...(feed.headers||{})};
  if(feed.origin){h.origin=feed.origin;h.referer=feed.referer||feed.origin+'/';h['sec-fetch-site']='same-site';h['sec-fetch-mode']='cors';h['sec-fetch-dest']='empty';}
  return h;
 }
 async function get(feed,url){
  return fetchPublicFeedJson(url,{headers:headers(feed),now,maxBytes:maxFeedBytes(),
   fetcher:(target,options)=>ingestionFetch(target,options,fetcher)});
 }
 async function fetchFrom(feed,startUrl){
  let url=startUrl,combined=null,partial=false;const seen=new Set();
  for(let page=0;page<10;page++){
   if(seen.has(url))throw Error('PUBLIC_FEED_PAGINATION_LOOP');seen.add(url);
   const data=await get(feed,url);let next=null;
   if(feed.id==='prizepicks'){
    if(!Array.isArray(data.data)||!Array.isArray(data.included))throw Error('INVALID_PRIZEPICKS_SCHEMA');
    combined=combined?{...data,data:[...combined.data,...data.data],included:[...new Map([...combined.included,...data.included].map(r=>[r.type+':'+r.id,r])).values()]}:data;
    next=typeof data.links?.next==='string'?data.links.next:data.links?.next?.href;
   }else if(feed.id==='kalshi'){
    if(!Array.isArray(data.markets))throw Error('INVALID_KALSHI_SCHEMA');combined={markets:[...(combined?.markets||[]),...data.markets]};
    if(data.cursor){const u=new URL(startUrl);u.searchParams.set('cursor',data.cursor);next=u.href;}
   }else if(feed.id==='polymarket'){
    if(!Array.isArray(data))throw Error('INVALID_POLYMARKET_SCHEMA');combined=[...(combined||[]),...data];
    if(data.length===100){const u=new URL(startUrl);u.searchParams.set('offset',String((page+1)*100));next=u.href;}
   }else combined=data;
   if(!next)break;
   const u=new URL(next,startUrl),base=new URL(startUrl);if(u.origin!==base.origin||u.pathname!==base.pathname)throw Error('PUBLIC_FEED_BAD_NEXT');
   url=u.href;if(page===9)partial=true;
  }
  return {data:combined,partial,endpoint:new URL(startUrl).host};
 }
 async function fetchPages(feed){
  const candidates=Array.isArray(feed.urls)&&feed.urls.length?feed.urls:[feed.url];
  let lastError=null,firstError=null;const attempts=[];
  for(const candidate of candidates){
   try{const result=await fetchFrom(feed,candidate);attempts.push({candidate:attempts.length,code:null,httpStatus:200});return {...result,attempts};}
   catch(error){assertIngestionActive();lastError=error;firstError=firstError||error;attempts.push({candidate:attempts.length,code:publicFeedErrorCode(error),httpStatus:error.status||null});}
  }
  // The fallback URL failing for its own unrelated reason must not overwrite
  // why the endpoint that is supposed to work was rejected: a 403 from a dead
  // spare reads as an access problem and hides an oversized primary response.
  const error=lastError||Error('PUBLIC_FEED_UNAVAILABLE');
  if(firstError&&firstError!==error)error.reason=firstError.reason||firstError.message;
  error.primaryCode=publicFeedErrorCode(firstError||error);error.primaryHttpStatus=firstError?.status||null;error.attempts=attempts;
  throw error;
 }
 async function refreshOne(feed){
  await load();if(pending.has(feed.id))return pending.get(feed.id);
  const previous=state.get(feed.id);if(previous?.configVersion===FEED_CONFIG_VERSION&&previous?.nextAt>now())return previous;
  const startedAt=now();
  const task=(async()=>{
   try{
    const {data,partial,endpoint,attempts}=await fetchPages(feed);assertIngestionActive();let parsed=empty();
    if(feed.id==='prizepicks'){parsed.records=normalizePrizePicks(data);parsed.specials=normalizePrizePicksSpecials(data);}
    if(feed.id==='underdog')parsed.records=normalizeUnderdog(data);
    if(feed.id==='sleeper')parsed.players=normalizeSleeper(data);
    if(feed.id==='kalshi')Object.assign(parsed,normalizeKalshi(data,{mappings}));
    if(feed.id==='polymarket')Object.assign(parsed,normalizePolymarket(data,{mappings}));
    parsed.active_props=normalizedFeedBoard(parsed.records).active_props;
    state.set(feed.id,{...parsed,fetchedAt:new Date(now()).toISOString(),nextAt:now()+effectiveTtl(feed,mappings),failures:0,status:parsed.records.length?'available':feed.id==='sleeper'?'roster_only':parsed.contracts.length?'unmapped_contracts':'no_props',partial,httpStatus:200,endpoint,configVersion:FEED_CONFIG_VERSION,observability:feedObservation(previous,{startedAt,endedAt:now(),ok:!partial,attempts})});
   }catch(error){assertIngestionActive();const failures=(previous?.failures||0)+1;const delay=error.retryMs||Math.min(3600000,60000*2**Math.min(6,failures-1))+Math.floor(Math.random()*10000);state.set(feed.id,{...(previous||empty()),failures,nextAt:now()+delay,status:error.status===429?'cooldown':'unavailable',httpStatus:error.status||null,endpoint:error.endpoint||null,reason:error.reason||error.message||null,primaryCode:error.primaryCode||publicFeedErrorCode(error),configVersion:FEED_CONFIG_VERSION,observability:feedObservation(previous,{startedAt,endedAt:now(),ok:false,primaryCode:error.primaryCode||publicFeedErrorCode(error),primaryHttpStatus:error.primaryCode?(error.primaryHttpStatus??null):(error.status??null),attempts:error.attempts||[]})});}
   await persist().catch(()=>{});return state.get(feed.id);
  })();pending.set(feed.id,task);try{return await task;}finally{pending.delete(feed.id);}
 }
 async function refreshFeed(id){const feed=feeds.find(row=>row.id===id);if(!feed)throw Object.assign(new Error('UNKNOWN_PUBLIC_FEED'),{code:'UNKNOWN_PUBLIC_FEED'});return refreshOne(feed);}
 function refresh(){if(!publicFeedsEnabledForMode())return Promise.resolve();if(refreshPromise)return refreshPromise;refreshPromise=(async()=>{await load();for(const feed of feeds){try{await withIngestionDeadline(`feed-refresh:${feed.id}`,()=>refreshOne(feed),B.feeds);}catch(error){assertIngestionActive();console.warn('[AutoScout public feed retained]',JSON.stringify({source:feed.id,code:error?.code||'PUBLIC_FEED_FAILED'}));}}if(observeCoverage){try{await withIngestionDeadline('source-coverage-observe',()=>observeCoverage(health()),B.status);}catch(error){assertIngestionActive();console.warn('[Oblige source coverage]',JSON.stringify({level:'unknown',code:'SOURCE_COVERAGE_READ_FAILED'}));}}})().finally(()=>{refreshPromise=null;});return refreshPromise;}
 async function board(sport,reference){await load();const version=[Math.floor(now()/60000),...state.values()].map(s=>typeof s==='number'?s:s.fetchedAt).join('|'),cached=boards.get(sport);
  if(cached?.source===reference.props&&cached.version===version)return cached.value;
  const records=[];for(const s of state.values()){
   // A failed refresh retains last-good records for recovery, but those records
   // are not automatically current. Only a recent successful observation may
   // enter a customer board.
   if(s?.status!=='available'||!isCustomerObservationFresh(s.fetchedAt,{now}))continue;
   for(const r of s.records)if(r.sport===sport&&Date.parse(r.gameStartTime)>now())records.push(r);
  }
  let value=normalizedFeedBoard(records,reference);
  const prizepicks=state.get('prizepicks');
  if(prizepicks?.status==='available'&&isCustomerObservationFresh(prizepicks.fetchedAt,{now})&&Array.isArray(prizepicks.specials))value=attachPrizePicksSpecialRows(value,prizepicks.specials.filter(r=>r.sport===sport&&Date.parse(r.gameStartTime)>now()),prizepicks.fetchedAt);
  boards.set(sport,{source:reference.props,version,value});return value;
 }
 function health(){return feeds.map(f=>{const s=state.get(f.id);return {id:f.id,status:s?.status||'not_checked',httpStatus:s?.httpStatus??null,endpoint:s?.endpoint||null,reason:s?.status==='available'?null:s?.reason||null,failures:s?.failures||0,lineCount:s?.records?.length||0,specialLineCount:s?.specials?.length||0,rosterCount:s?.players?.length||0,contractCount:s?.contracts?.length||0,fetchedAt:s?.fetchedAt||null,nextAt:s?.nextAt||null,partial:!!s?.partial,freshness:feedFreshness(s,now())};});}
 return {refresh,refreshFeed,board,health,load};
}
const dataDir=process.env.DATA_DIR||path.join(process.cwd(),'data');
let mappings=[];
if(process.env.AUTOSCOUT_EXCHANGE_MAPPINGS_FILE){try{mappings=JSON.parse(await fs.readFile(process.env.AUTOSCOUT_EXCHANGE_MAPPINGS_FILE,'utf8'));}catch{}}
const sourceCoverage=createSourceCoverageObserver({fetcher:(url,options)=>ingestionFetch(url,options)});
export const publicFeeds=createPublicFeeds({storeDir:path.join(dataDir,'autoscout','supplemental'),mappings,observeCoverage:health=>sourceCoverage.observe(health)});
export async function appendPublicFeeds(board,sport,{refresh=false}={}){
 if(!publicFeedsEnabledForMode())return {...board,meta:{...board.meta,publicFeedsActive:false}};
 if(refresh)await publicFeeds.refresh();
 const supplemental=await publicFeeds.board(sport,board);
 if(!supplemental.props.length)return {...board,meta:{...board.meta,publicFeeds:publicFeeds.health()}};
 const data={};for(const key of ['events','players','props','lines'])data[key]=[...new Map([...(supplemental.data[key]||[]),...(board.data?.[key]||[])].map(r=>[r.id,r])).values()];
 const props=[...new Map([...supplemental.props,...(board.props||[])].map(r=>[r.id,r])).values()];
 const books=[...new Set(props.filter(r=>r.isAlternate!==true).map(r=>r.sportsbookKey))];
 return {...board,props,data,meta:{...board.meta,publicFeeds:publicFeeds.health(),sportsbooks:books,sportsbookCount:books.length,lineCount:props.filter(r=>r.isAlternate!==true).length,propCount:data.props.length,events:data.events.length||board.meta?.events,supplemental:true}};
}