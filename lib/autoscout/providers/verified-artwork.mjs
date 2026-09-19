import crypto from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,renameSync,readdirSync,statSync,unlinkSync,rmSync} from 'node:fs';
import path from 'node:path';
import {normalizePlayerName} from '../../data-sources/contract.mjs';
import {PUBLIC_LEAGUES,canonicalSport} from '../../data-sources/espn/stat-contract.mjs';
import {resolvePublicAthlete,resolveRosterAthlete,matchesTeamRecord} from '../../data-sources/espn/identity.mjs';
const DAY=86400000, MAX_BYTES=3_000_000;
const ARTWORK_CACHE_BYTES=96*1024*1024;
const MAX_INDEX_ENTRIES=5000;
const safeUnlink=(file)=>{try{unlinkSync(file);return true;}catch{return false;}};
export function pruneVerifiedArtworkCache(directory,index,{nowMs=Date.now(),maxBytes=ARTWORK_CACHE_BYTES,maxEntries=MAX_INDEX_ENTRIES}={}){
 let changed=false,removedFiles=0,freedBytes=0,retainedBytes=0;
 if(!index||typeof index!=='object')return{changed,removedFiles,freedBytes,retainedBytes};
 for(const [key,entry] of Object.entries(index)){
  const expires=Number(entry?.expires);
  if(!entry||typeof entry!=='object'||!Number.isFinite(expires)||expires<=nowMs){delete index[key];changed=true;}
 }
 const referenced=new Map();
 for(const [key,entry] of Object.entries(index))if(entry?.file)referenced.set(path.basename(String(entry.file)),key);
 const present=new Set(),files=[];
 let entries=[];try{entries=readdirSync(directory,{withFileTypes:true});}catch{}
 for(const entry of entries){
  if(!entry.isFile())continue;
  if(entry.name==='index.json.tmp'){if(safeUnlink(path.join(directory,entry.name))){changed=true;removedFiles++;}continue;}
  if(!entry.name.endsWith('.img'))continue;
  const absolute=path.join(directory,entry.name);
  let bytes=0,mtimeMs=0;try{const stat=statSync(absolute);bytes=Number(stat.size)||0;mtimeMs=Number(stat.mtimeMs)||0;}catch{continue;}
  const key=referenced.get(entry.name);
  if(!key){
   if(safeUnlink(absolute)){changed=true;removedFiles++;freedBytes+=bytes;}
   continue;
  }
  present.add(entry.name);retainedBytes+=bytes;
  files.push({key,name:entry.name,absolute,bytes,mtimeMs,expires:Number(index[key]?.expires)||0});
  if(Number(index[key]?.bytes)!==bytes){index[key].bytes=bytes;changed=true;}
 }
 for(const [name,key] of referenced)if(!present.has(name)){delete index[key];changed=true;}
 if(retainedBytes>maxBytes){
  files.sort((a,b)=>(a.expires-b.expires)||(a.mtimeMs-b.mtimeMs));
  for(const row of files){
   if(retainedBytes<=maxBytes)break;
   if(!index[row.key])continue;
   if(safeUnlink(row.absolute)){retainedBytes=Math.max(0,retainedBytes-row.bytes);freedBytes+=row.bytes;removedFiles++;}
   delete index[row.key];changed=true;
  }
 }
 const keys=Object.keys(index);
 if(keys.length>maxEntries){
  const excess=keys.sort((a,b)=>(Number(index[a]?.expires)||0)-(Number(index[b]?.expires)||0)).slice(0,keys.length-maxEntries);
  for(const key of excess){
   const file=index[key]?.file?path.join(directory,path.basename(String(index[key].file))):null;
   if(file){let bytes=Number(index[key]?.bytes)||0;if(!bytes)try{bytes=Number(statSync(file).size)||0;}catch{}if(safeUnlink(file)){retainedBytes=Math.max(0,retainedBytes-bytes);freedBytes+=bytes;removedFiles++;}}
   delete index[key];changed=true;
  }
 }
 return{changed,removedFiles,freedBytes,retainedBytes};
}
const escapeXml=v=>String(v).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
function sportBadge(sport){const code=escapeXml(String(sport||'SPORT').toUpperCase().slice(0,12));const size=code.length>5?18:23;return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><title>${code} logo</title><rect width="128" height="128" rx="64" fill="#0d1928"/><path d="M64 17l34 13v29c0 25-14 42-34 53C44 101 30 84 30 59V30l34-13z" fill="#182c42" stroke="#38506c" stroke-width="3"/><text x="64" y="70" text-anchor="middle" font-family="Arial,sans-serif" font-size="${size}" font-weight="800" fill="#e8f0fb">${code}</text><text x="64" y="91" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" font-weight="700" letter-spacing="1.3" fill="#86a0bc">SPORT</text></svg>`);}
export function verifiedPhotoUrl(value,athleteId){
 try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='a.espncdn.com'&&!u.username&&!u.password&&new RegExp('/players/(?:full|headshot)/'+athleteId+'\\.(?:png|jpg)
export function createVerifiedArtwork({fetchImpl=(...args)=>fetch(...args),now=()=>Date.now(),dataDir=process.env.DATA_DIR||'/app/data'}={}){
 // New namespace invalidates old seven-day placeholder and wrong-athlete caches.
 const directory=path.join(dataDir,'verified-player-artwork-v3'),indexPath=path.join(directory,'index.json');
 let index={};const pending=new Map(),jsonCache=new Map(),jsonPending=new Map(),queue=[];let active=0;
 try{mkdirSync(directory,{recursive:true});index=JSON.parse(readFileSync(indexPath,'utf8'));}catch{}
 const save=()=>{const temp=indexPath+'.tmp';try{writeFileSync(temp,JSON.stringify(index));renameSync(temp,indexPath);}catch{}finally{safeUnlink(temp);}};
 // The old player-artwork namespace contained only seven-day remote image
 // cache entries and was superseded by verified-player-artwork-v2. It is never
 // read by the current /api/apex/player-artwork path, so retaining it only
 // consumes the production volume.
 try{rmSync(path.join(dataDir,'player-artwork'),{recursive:true,force:true});}catch{}
 try{rmSync(path.join(dataDir,'verified-player-artwork-v2'),{recursive:true,force:true});}catch{}
 const startupPrune=pruneVerifiedArtworkCache(directory,index,{nowMs:now()});
 let retainedBytes=startupPrune.retainedBytes;
 if(startupPrune.changed)save();
 async function limit(work){if(active>=4)await new Promise(resolve=>queue.push(resolve));else active++;try{return await work();}finally{const next=queue.shift();if(next)next();else active--;}}
 async function json(url,ttl=3600000){const hit=jsonCache.get(url);if(hit&&hit.expires>now())return hit.data;if(jsonPending.has(url))return jsonPending.get(url);
  const task=(async()=>{const response=await fetchImpl(url,{signal:AbortSignal.timeout(6000),headers:{accept:'application/json'}});if(!response.ok)throw Error('Source unavailable');const data=await response.json();const cacheTtl=url.includes('/search/v2')&&!data?.results?.some(g=>g.type==='player'&&g.contents?.length)?60000:ttl;jsonCache.set(url,{data,expires:now()+cacheTtl});while(jsonCache.size>1000)jsonCache.delete(jsonCache.keys().next().value);return data;})().finally(()=>jsonPending.delete(url));jsonPending.set(url,task);return task;}
 async function imageBytes(url){
  const r=await fetchImpl(url,{signal:AbortSignal.timeout(8000),redirect:'error'});if(!r.ok||Number(r.headers.get('content-length'))>MAX_BYTES)throw Error('No photo');
  const type=(r.headers.get('content-type')||'').split(';')[0];if(!['image/png','image/jpeg','image/webp'].includes(type))throw Error('Invalid photo');
  const chunks=[];let size=0;for await(const chunk of r.body){size+=chunk.length;if(size>MAX_BYTES)throw Error('Oversize photo');chunks.push(chunk);}
  const bytes=Buffer.concat(chunks);
  const valid=type==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):type==='image/jpeg'?bytes[0]===255&&bytes[1]===216:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
  if(!valid)throw Error('Invalid photo');return {bytes,type};
 }
 async function resolveEspn(sport,name,context){
  const [family,league]=PUBLIC_LEAGUES[sport];const base='https://site.web.api.espn.com/apis';
  const search=await json(base+'/search/v2?'+new URLSearchParams({query:normalizePlayerName(name),sport:family}));
  let athlete=resolvePublicAthlete(search,{sport,playerName:name,team:context.team,providerPlayerId:context.providerPlayerId});
  let rosterPhoto=null,position=null;
  if(!athlete&&context.team){
   const directoryData=await json(`https://site.api.espn.com/apis/site/v2/sports/${family}/${league}/teams?limit=1000`,DAY);
   const teams=(directoryData.sports||[]).flatMap(s=>(s.leagues||[]).flatMap(l=>(l.teams||[]).map(t=>t.team))).filter(t=>matchesTeamRecord(context.team,t,sport));
   if(teams.length===1){const t=teams[0],roster=await json(`https://site.api.espn.com/apis/site/v2/sports/${family}/${league}/teams/${t.id}/roster`);athlete=resolveRosterAthlete(roster,{sport,playerName:name,team:t});
    if(athlete){const row=(roster.athletes||[]).flatMap(g=>g.items||[g]).find(r=>String(r.id)===athlete.id);rosterPhoto=row?.headshot?.href;position=row?.position?.abbreviation||null;}}
  }
  if(!athlete)return null;
  const sourceRow=(search.results||[]).filter(g=>g.type==='player').flatMap(g=>g.contents||[]).find(r=>String(r.uid||'').endsWith('~a:'+athlete.id)&&normalizePlayerName(r.displayName)===normalizePlayerName(name));
  let photo=verifiedPhotoUrl(rosterPhoto||sourceRow?.image?.default,athlete.id);
  if(!photo){const profile=await json(`${base}/common/v3/sports/${family}/${league}/athletes/${athlete.id}`),a=profile.athlete;
   if(String(a?.id)===athlete.id&&normalizePlayerName(a?.displayName)===normalizePlayerName(name)){photo=verifiedPhotoUrl(a.headshot?.href,athlete.id);position=a.position?.abbreviation||position;}}
  if(!photo)return null;
  const {bytes,type}=await imageBytes(photo);
  return {body:bytes,contentType:type,source:'ESPN',playerName:athlete.playerName,team:athlete.teamName,position,providerPlayerId:`history:${sport}:${athlete.id}`,verified:true};
 }
 async function resolveSportsDb(sport,name,context){
  const data=await json('https://www.thesportsdb.com/api/v1/json/123/searchplayers.php?'+new URLSearchParams({p:name}),6*3600000);
  const rows=(Array.isArray(data?.player)?data.player:Array.isArray(data?.players)?data.players:[])
   .filter(row=>normalizePlayerName(row?.strPlayer)===normalizePlayerName(name)&&sportsDbSportMatches(sport,row?.strSport));
  if(!rows.length)return null;
  let candidates=rows;
  if(context.team){
   const matched=rows.filter(row=>teamCompatible(context.team,row?.strTeam));
   if(matched.length)candidates=matched;
  }
  // Never choose arbitrarily between same-name athletes.
  if(candidates.length!==1)return null;
  const row=candidates[0],photo=safeHttpsUrl(row?.strCutout||row?.strThumb);
  if(!photo)return null;
  const {bytes,type}=await imageBytes(photo);
  return {body:bytes,contentType:type,source:'TheSportsDB',playerName:String(row?.strPlayer||name),team:row?.strTeam||null,position:row?.strPosition||null,providerPlayerId:context.providerPlayerId||null,verified:true};
 }
 async function get(sport,name,context={}){
  sport=canonicalSport(sport);name=String(name||'').trim().slice(0,90);
  const fallback={status:200,source:'sport-logo',verified:false,contentType:'image/svg+xml',body:sportBadge(sport),cacheControl:'public, max-age=300'};
  if(!name||context.entityType==='team')return fallback;
  const key=[sport,normalizePlayerName(name),context.team||'',context.providerPlayerId||''].join('|'),hit=index[key];
  if(hit&&hit.expires>now()){
   if(!hit.file)return fallback;
   const file=path.join(directory,path.basename(hit.file));try{return {...hit,status:200,body:readFileSync(file),cacheControl:'public, max-age=86400'};}catch{}
  }
  if(pending.has(key))return pending.get(key);
  if(queue.length>=80)return fallback;
  const task=limit(async()=>{
   let result=null,failed=false;
   if(PUBLIC_LEAGUES[sport]?.[1]){try{result=await resolveEspn(sport,name,context);}catch{failed=true;}}
   if(!result){try{result=await resolveSportsDb(sport,name,context);}catch{failed=true;}}
   if(result){const file=crypto.createHash('sha256').update(key).digest('hex')+'.img';const {body,...meta}=result;
    try{writeFileSync(path.join(directory,file),body);index[key]={...meta,file,bytes:body.length,expires:now()+7*DAY};retainedBytes+=body.length;}catch{}
    if(retainedBytes>ARTWORK_CACHE_BYTES||Object.keys(index).length>MAX_INDEX_ENTRIES){const pruned=pruneVerifiedArtworkCache(directory,index,{nowMs:now()});retainedBytes=pruned.retainedBytes;}
    save();return {...result,status:200,cacheControl:'public, max-age=86400'};}
   index[key]={expires:now()+(failed?30000:300000),file:null};save();return fallback;
  }).finally(()=>pending.delete(key));pending.set(key,task);return task;
 }
 return get;
}
export const verifiedPlayerArtworkResponse=createVerifiedArtwork();
,'i').test(u.pathname)?u.href:null;}catch{return null;}
}
function safeHttpsUrl(value){try{const u=new URL(String(value||''));return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
function sportsDbSportMatches(requested,candidate){
 const sport=canonicalSport(requested),value=String(candidate||'').trim().toLowerCase();
 if(!value)return false;
 if(sport==='NFL'||sport==='NCAAF')return value.includes('american football')||value==='football';
 if(sport==='NBA'||sport==='WNBA'||sport==='NCAAB')return value.includes('basketball');
 if(sport==='MLB')return value.includes('baseball');
 if(sport==='NHL')return value.includes('ice hockey')||value==='hockey';
 if(['SOCCER','MLS','EPL','UCL'].includes(sport))return value==='soccer'||value.includes('association football');
 if(sport==='TENNIS')return value.includes('tennis');
 if(sport==='GOLF')return value.includes('golf');
 if(sport==='CRICKET')return value.includes('cricket');
 return value===String(sport||'').trim().toLowerCase();
}
function teamText(value){return normalizePlayerName(String(value||'')).replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();}
function teamCompatible(requested,candidate){
 const a=teamText(requested),b=teamText(candidate);if(!a||!b)return false;
 return a===b||(a.length>=3&&b.startsWith(a))||(b.length>=3&&a.startsWith(b));
}
export function createVerifiedArtwork({fetchImpl=(...args)=>fetch(...args),now=()=>Date.now(),dataDir=process.env.DATA_DIR||'/app/data'}={}){
 // New namespace invalidates old seven-day placeholder and wrong-athlete caches.
 const directory=path.join(dataDir,'verified-player-artwork-v2'),indexPath=path.join(directory,'index.json');
 let index={};const pending=new Map(),jsonCache=new Map(),jsonPending=new Map(),queue=[];let active=0;
 try{mkdirSync(directory,{recursive:true});index=JSON.parse(readFileSync(indexPath,'utf8'));}catch{}
 const save=()=>{const temp=indexPath+'.tmp';try{writeFileSync(temp,JSON.stringify(index));renameSync(temp,indexPath);}catch{}finally{safeUnlink(temp);}};
 // The old player-artwork namespace contained only seven-day remote image
 // cache entries and was superseded by verified-player-artwork-v2. It is never
 // read by the current /api/apex/player-artwork path, so retaining it only
 // consumes the production volume.
 try{rmSync(path.join(dataDir,'player-artwork'),{recursive:true,force:true});}catch{}
 const startupPrune=pruneVerifiedArtworkCache(directory,index,{nowMs:now()});
 let retainedBytes=startupPrune.retainedBytes;
 if(startupPrune.changed)save();
 async function limit(work){if(active>=4)await new Promise(resolve=>queue.push(resolve));else active++;try{return await work();}finally{const next=queue.shift();if(next)next();else active--;}}
 async function json(url,ttl=3600000){const hit=jsonCache.get(url);if(hit&&hit.expires>now())return hit.data;if(jsonPending.has(url))return jsonPending.get(url);
  const task=(async()=>{const response=await fetchImpl(url,{signal:AbortSignal.timeout(6000),headers:{accept:'application/json'}});if(!response.ok)throw Error('Source unavailable');const data=await response.json();const cacheTtl=url.includes('/search/v2')&&!data?.results?.some(g=>g.type==='player'&&g.contents?.length)?60000:ttl;jsonCache.set(url,{data,expires:now()+cacheTtl});while(jsonCache.size>1000)jsonCache.delete(jsonCache.keys().next().value);return data;})().finally(()=>jsonPending.delete(url));jsonPending.set(url,task);return task;}
 async function imageBytes(url){
  const r=await fetchImpl(url,{signal:AbortSignal.timeout(8000),redirect:'error'});if(!r.ok||Number(r.headers.get('content-length'))>MAX_BYTES)throw Error('No photo');
  const type=(r.headers.get('content-type')||'').split(';')[0];if(!['image/png','image/jpeg','image/webp'].includes(type))throw Error('Invalid photo');
  const chunks=[];let size=0;for await(const chunk of r.body){size+=chunk.length;if(size>MAX_BYTES)throw Error('Oversize photo');chunks.push(chunk);}
  const bytes=Buffer.concat(chunks);
  const valid=type==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):type==='image/jpeg'?bytes[0]===255&&bytes[1]===216:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
  if(!valid)throw Error('Invalid photo');return {bytes,type};
 }
 async function resolve(sport,name,context){
  const [family,league]=PUBLIC_LEAGUES[sport];const base='https://site.web.api.espn.com/apis';
  const search=await json(base+'/search/v2?'+new URLSearchParams({query:normalizePlayerName(name),sport:family}));
  let athlete=resolvePublicAthlete(search,{sport,playerName:name,team:context.team,providerPlayerId:context.providerPlayerId});
  let rosterPhoto=null,position=null;
  if(!athlete&&context.team){
   const directoryData=await json(`https://site.api.espn.com/apis/site/v2/sports/${family}/${league}/teams?limit=1000`,DAY);
   const teams=(directoryData.sports||[]).flatMap(s=>(s.leagues||[]).flatMap(l=>(l.teams||[]).map(t=>t.team))).filter(t=>matchesTeamRecord(context.team,t,sport));
   if(teams.length===1){const t=teams[0],roster=await json(`https://site.api.espn.com/apis/site/v2/sports/${family}/${league}/teams/${t.id}/roster`);athlete=resolveRosterAthlete(roster,{sport,playerName:name,team:t});
    if(athlete){const row=(roster.athletes||[]).flatMap(g=>g.items||[g]).find(r=>String(r.id)===athlete.id);rosterPhoto=row?.headshot?.href;position=row?.position?.abbreviation||null;}}
  }
  if(!athlete)return null;
  const sourceRow=(search.results||[]).filter(g=>g.type==='player').flatMap(g=>g.contents||[]).find(r=>String(r.uid||'').endsWith('~a:'+athlete.id)&&normalizePlayerName(r.displayName)===normalizePlayerName(name));
  let photo=verifiedPhotoUrl(rosterPhoto||sourceRow?.image?.default,athlete.id);
  if(!photo){const profile=await json(`${base}/common/v3/sports/${family}/${league}/athletes/${athlete.id}`),a=profile.athlete;
   if(String(a?.id)===athlete.id&&normalizePlayerName(a?.displayName)===normalizePlayerName(name)){photo=verifiedPhotoUrl(a.headshot?.href,athlete.id);position=a.position?.abbreviation||position;}}
  if(!photo)return null;
  const {bytes,type}=await imageBytes(photo);
  return {body:bytes,contentType:type,source:'ESPN',playerName:athlete.playerName,team:athlete.teamName,position,providerPlayerId:`history:${sport}:${athlete.id}`,verified:true};
 }
 async function get(sport,name,context={}){
  sport=canonicalSport(sport);name=String(name||'').trim().slice(0,90);
  const fallback={status:200,source:'placeholder',verified:false,contentType:'image/svg+xml',body:placeholder(name),cacheControl:'public, max-age=30'};
  // A sport with no league slug has no team directory or athlete profile to
 // build a URL for, and ESPN publishes no soccer headshots through either, so
 // there is nothing here but the initials card.
 if(!PUBLIC_LEAGUES[sport]?.[1]||!name||context.entityType==='team')return fallback;
  const key=[sport,normalizePlayerName(name),context.team||'',context.providerPlayerId||''].join('|'),hit=index[key];
  if(hit&&hit.expires>now()){
   if(!hit.file)return fallback;
   const file=path.join(directory,path.basename(hit.file));try{return {...hit,status:200,body:readFileSync(file),cacheControl:'public, max-age=86400'};}catch{}
  }
  if(pending.has(key))return pending.get(key);
  if(queue.length>=80)return fallback;
  const task=limit(async()=>{
   let result=null,failed=false;try{result=await resolve(sport,name,context);}catch{failed=true;}
   if(result){const file=crypto.createHash('sha256').update(key).digest('hex')+'.img';const {body,...meta}=result;
    try{writeFileSync(path.join(directory,file),body);index[key]={...meta,file,bytes:body.length,expires:now()+7*DAY};retainedBytes+=body.length;}catch{}
    if(retainedBytes>ARTWORK_CACHE_BYTES||Object.keys(index).length>MAX_INDEX_ENTRIES){const pruned=pruneVerifiedArtworkCache(directory,index,{nowMs:now()});retainedBytes=pruned.retainedBytes;}
    save();return {...result,status:200,cacheControl:'public, max-age=86400'};}
   index[key]={expires:now()+(failed?30000:300000),file:null};save();return fallback;
  }).finally(()=>pending.delete(key));pending.set(key,task);return task;
 }
 return get;
}
export const verifiedPlayerArtworkResponse=createVerifiedArtwork();
