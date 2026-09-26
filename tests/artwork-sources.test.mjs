import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createVerifiedArtwork,mlbPhotoUrl,nhlPhotoUrl} from '../lib/autoscout/providers/verified-artwork.mjs';

const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0]);
const jpg=new Uint8Array([255,216,255,224,0,0]);
const json=body=>new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
const image=(bytes,type)=>new Response(bytes,{status:200,headers:{'content-type':type}});
const roster=rows=>({athletes:[{items:rows}]});
const athlete=(id,name,league='nba')=>({id,displayName:name,headshot:{href:`https://a.espncdn.com/i/headshots/${league}/players/full/${id}.png`},position:{abbreviation:'G'}});

function withDir(fn){return async()=>{const dir=mkdtempSync(path.join(tmpdir(),'artwork-src-'));try{await fn(dir);}finally{rmSync(dir,{recursive:true,force:true});}};}

test('the prop\'s own game rosters come first and resolve the player on the right team',withDir(async dir=>{
 const calls=[];
 const fetchImpl=async input=>{
  const url=String(input);calls.push(url);
  if(url.includes('/summary?event=401902644'))return json({header:{competitions:[{competitors:[{team:{id:'28',displayName:'Toronto Raptors'}},{team:{id:'14',displayName:'Miami Heat'}}]}]}});
  if(url.endsWith('/teams/28/roster'))return json(roster([athlete('4433134','Scottie Barnes')]));
  if(url.endsWith('/teams/14/roster'))return json(roster([athlete('4066261','Bam Adebayo')]));
  if(url.endsWith('/4066261.png'))return image(png,'image/png');
  throw new Error('unexpected fetch '+url);
 };
 const get=createVerifiedArtwork({fetchImpl,dataDir:dir,now:()=>1_800_000_000_000});
 const r=await get('NBA','Bam Adebayo',{espnEventId:'401902644'});
 assert.equal(r.verified,true);
 assert.equal(r.source,'ESPN event roster');
 assert.equal(r.team,'Miami Heat');
 assert.ok(!calls.some(u=>u.includes('/search/v2')),'no league-wide name search was needed');
}));

test('a name on both game rosters is ambiguous and never borrows either photo',withDir(async dir=>{
 const fetchImpl=async input=>{
  const url=String(input);
  if(url.includes('/summary?event='))return json({header:{competitions:[{competitors:[{team:{id:'1'}},{team:{id:'2'}}]}]}});
  if(url.endsWith('/teams/1/roster'))return json(roster([athlete('11','Jalen Williams')]));
  if(url.endsWith('/teams/2/roster'))return json(roster([athlete('22','Jalen Williams')]));
  if(url.includes('/search/v2'))return json({results:[]});
  if(url.includes('/teams?limit=1000'))return json({sports:[]});
  if(url.includes('thesportsdb'))return json({player:[]});
  throw new Error('unexpected fetch '+url);
 };
 const get=createVerifiedArtwork({fetchImpl,dataDir:dir,now:()=>1_800_000_000_000});
 const r=await get('NBA','Jalen Williams',{espnEventId:'123456'});
 assert.equal(r.verified,false);
}));

test('MLB falls back to MLB\'s own headshot for a single active exact-name match',withDir(async dir=>{
 const fetchImpl=async input=>{
  const url=String(input);
  if(url.includes('espn.com'))return new Response('down',{status:503});
  if(url.startsWith('https://statsapi.mlb.com/api/v1/people/search'))return json({people:[
   {id:592450,fullName:'Aaron Judge',active:true,primaryPosition:{abbreviation:'RF'}},
   {id:111,fullName:'Aaron Judge',active:false},
  ]});
  if(url===mlbPhotoUrl(592450))return image(jpg,'image/jpeg');
  throw new Error('unexpected fetch '+url);
 };
 const get=createVerifiedArtwork({fetchImpl,dataDir:dir,now:()=>1_800_000_000_000});
 const r=await get('MLB','Aaron Judge',{team:'NYY'});
 assert.equal(r.verified,true);
 assert.equal(r.source,'MLB');
 assert.equal(r.contentType,'image/jpeg');
}));

test('the NHL source separates same-name players by team and only trusts assets.nhle.com',withDir(async dir=>{
 const fetchImpl=async input=>{
  const url=String(input);
  if(url.includes('espn.com'))return new Response('down',{status:503});
  if(url.startsWith('https://search.d3.nhle.com/'))return json([
   {playerId:'8478427',name:'Sebastian Aho',teamAbbrev:'CAR',positionCode:'C'},
   {playerId:'8480222',name:'Sebastian Aho',teamAbbrev:'NYI',positionCode:'D'},
  ]);
  if(url==='https://api-web.nhle.com/v1/player/8478427/landing')return json({playerId:8478427,headshot:'https://assets.nhle.com/mugs/nhl/20262027/CAR/8478427.png'});
  if(url==='https://assets.nhle.com/mugs/nhl/20262027/CAR/8478427.png')return image(png,'image/png');
  throw new Error('unexpected fetch '+url);
 };
 const get=createVerifiedArtwork({fetchImpl,dataDir:dir,now:()=>1_800_000_000_000});
 const r=await get('NHL','Sebastian Aho',{team:'CAR'});
 assert.equal(r.verified,true);
 assert.equal(r.source,'NHL');
 assert.equal(r.team,'CAR');
 assert.equal(nhlPhotoUrl('https://evil.example/mugs/nhl/20262027/CAR/8478427.png','8478427'),null);
 assert.equal(nhlPhotoUrl('https://assets.nhle.com/mugs/nhl/20262027/CAR/9999999.png','8478427'),null,'another player\'s mug is refused');
 assert.equal(mlbPhotoUrl('abc'),null);
}));
