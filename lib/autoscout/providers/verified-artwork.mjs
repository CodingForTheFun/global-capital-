import crypto from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import path from 'node:path';
import {normalizePlayerName} from '../../data-sources/contract.mjs';
import {PUBLIC_LEAGUES,canonicalSport} from '../../data-sources/espn/stat-contract.mjs';
import {resolvePublicAthlete,resolveRosterAthlete,matchesTeamRecord} from '../../data-sources/espn/identity.mjs';
const DAY=86400000, MAX_BYTES=3_000_000;
const escapeXml=v=>String(v).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
function placeholder(name){const initials=String(name||'').split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase();return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><title>Photo unavailable</title><rect width="128" height="128" rx="64" fill="#18263c"/><circle cx="64" cy="44" r="23" fill="#334761"/><path d="M22 112c0-28 19-43 42-43s42 15 42 43" fill="#334761"/><text x="64" y="116" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#d8e4f3">${escapeXml(initials)}</text></svg>`);}
export function verifiedPhotoUrl(value,athleteId){
 try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='a.espncdn.com'&&!u.username&&!u.password&&new RegExp('/players/(?:full|headshot)/'+athleteId+'\\.(?:png|jpg)$','i').test(u.pathname)?u.href:null;}catch{return null;}
}
export function createVerifiedArtwork({fetchImpl=(...args)=>fetch(...args),now=()=>Date.now(),dataDir=process.env.DATA_DIR||'/app/data'}={}){
 // New namespace invalidates old seven-day placeholder and wrong-athlete caches.
 const directory=path.join(dataDir,'verified-player-artwork-v2'),indexPath=path.join(directory,'index.json');
 let index={};const pending=new Map(),jsonCache=new Map(),jsonPending=new Map(),queue=[];let active=0;
 try{mkdirSync(directory,{recursive:true});index=JSON.parse(readFileSync(indexPath,'utf8'));}catch{}
 const save=()=>{try{writeFileSync(indexPath+'.tmp',JSON.stringify(index));renameSync(indexPath+'.tmp',indexPath);}catch{}};
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
  if(!PUBLIC_LEAGUES[sport]||!name||context.entityType==='team')return fallback;
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
    try{writeFileSync(path.join(directory,file),body);index[key]={...meta,file,expires:now()+7*DAY};}catch{}
    while(Object.keys(index).length>5000)delete index[Object.keys(index)[0]];save();return {...result,status:200,cacheControl:'public, max-age=86400'};}
   index[key]={expires:now()+(failed?30000:300000),file:null};save();return fallback;
  }).finally(()=>pending.delete(key));pending.set(key,task);return task;
 }
 return get;
}
export const verifiedPlayerArtworkResponse=createVerifiedArtwork();
