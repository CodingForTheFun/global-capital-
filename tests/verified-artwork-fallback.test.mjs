import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createVerifiedArtwork} from '../lib/autoscout/providers/verified-artwork.mjs';

const png=new Uint8Array([137,80,78,71,13,10,26,10]);
function json(body){return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});}

test('verified artwork uses an exact-name alternate source when ESPN has no player photo',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'verified-artwork-alt-'));
 const calls=[];
 const fetchImpl=async input=>{
  const url=String(input);calls.push(url);
  if(url.includes('/search/v2'))return json({results:[]});
  if(url.includes('/teams?limit=1000'))return json({sports:[]});
  if(url.includes('thesportsdb.com/api/v1/json/123/searchplayers.php'))return json({player:[{
   strPlayer:'Paige Bueckers',strSport:'Basketball',strTeam:'Dallas Wings',
   strPosition:'Guard',strCutout:'https://images.example/paige.png'
  }]});
  if(url==='https://images.example/paige.png')return new Response(png,{status:200,headers:{'content-type':'image/png'}});
  throw new Error('unexpected fetch '+url);
 };
 try{
  const get=createVerifiedArtwork({fetchImpl,dataDir:dir,now:()=>1_800_000_000_000});
  const result=await get('WNBA','Paige Bueckers',{team:'DAL'});
  assert.equal(result.status,200);
  assert.equal(result.source,'TheSportsDB');
  assert.equal(result.verified,true);
  assert.equal(result.contentType,'image/png');
  assert.ok(Buffer.isBuffer(result.body));
  assert.ok(calls.some(url=>url.includes('thesportsdb.com')));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('missing player artwork returns the requested sport badge instead of player initials',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'verified-artwork-logo-'));
 const fetchImpl=async input=>{
  const url=String(input);
  if(url.includes('/search/v2'))return json({results:[]});
  if(url.includes('/teams?limit=1000'))return json({sports:[]});
  if(url.includes('thesportsdb.com/api/v1/json/123/searchplayers.php'))return json({player:[]});
  throw new Error('unexpected fetch '+url);
 };
 try{
  const get=createVerifiedArtwork({fetchImpl,dataDir:dir,now:()=>1_800_000_000_000});
  const result=await get('WNBA','Missing Fixture Player',{team:'DAL'});
  const svg=result.body.toString('utf8');
  assert.equal(result.status,200);
  assert.equal(result.source,'sport-logo');
  assert.equal(result.contentType,'image/svg+xml');
  assert.match(svg,/WNBA logo/);
  assert.doesNotMatch(svg,/MFP/);
  assert.doesNotMatch(svg,/Missing Fixture Player/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('alternate artwork never accepts a same-name athlete from the wrong sport',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'verified-artwork-wrong-sport-'));
 const fetchImpl=async input=>{
  const url=String(input);
  if(url.includes('/search/v2'))return json({results:[]});
  if(url.includes('thesportsdb.com/api/v1/json/123/searchplayers.php'))return json({player:[{
   strPlayer:'Same Name',strSport:'Baseball',strTeam:'Example',strCutout:'https://images.example/wrong.png'
  }]});
  if(url.includes('/teams?limit=1000'))return json({sports:[]});
  if(url==='https://images.example/wrong.png')throw new Error('wrong-sport image must never be requested');
  throw new Error('unexpected fetch '+url);
 };
 try{
  const get=createVerifiedArtwork({fetchImpl,dataDir:dir,now:()=>1_800_000_000_000});
  const result=await get('WNBA','Same Name',{});
  assert.equal(result.source,'sport-logo');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
