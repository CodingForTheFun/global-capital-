import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {photoSport,validPhotoSport,selectPhotoEntity,commonsLicense,safeDiscoveredPhotoUrl,photoCreditPage,createPhotoDiscovery} from '../lib/autoscout/providers/player-photo-discovery.mjs';
import {createVerifiedArtwork} from '../lib/autoscout/providers/verified-artwork.mjs';
const png=Buffer.from([137,80,78,71,13,10,26,10]);
const stmt=value=>({rank:'normal',mainsnak:{datavalue:{value}}});
const item=id=>stmt({id});
const athlete=(id,name,sport='Q847',image='Fixture.jpg')=>({id,labels:{en:{value:name}},claims:{P31:[item('Q5')],P641:[item(sport)],P18:[stmt(image)]}});
const related={Q847:{labels:{en:{value:'tennis'}}},Q5377:{labels:{en:{value:'golf'}}}};
const info={mime:'image/jpeg',thumburl:'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Fixture.jpg/256px-Fixture.jpg',descriptionurl:'https://commons.wikimedia.org/wiki/File:Fixture.jpg',extmetadata:{Artist:{value:'<a href="javascript:bad">Fixture photographer</a>'},LicenseShortName:{value:'CC BY-SA 4.0'},LicenseUrl:{value:'https://creativecommons.org/licenses/by-sa/4.0/'}}};
const withDirectory=fn=>async()=>{const dataDir=mkdtempSync(path.join(tmpdir(),'all-sport-photos-'));try{await fn(dataDir);}finally{rmSync(dataDir,{recursive:true,force:true});}};
test('all provider sport codes can attempt photos independently of research support',()=>{
 for(const sport of ['NFL','NBA','WNBA','NHL','MLB','NCAAF','NCAAB','EPL','SOCCER','MLS','UCL','TENNIS','ATP','WTA','GOLF','PGA','LPGA','MMA','UFC','CRICKET','RUGBY','CS2','LOL','DOTA2','VALORANT','ROCKETLEAGUE','TABLETENNIS','NEW_PROVIDER_SPORT'])assert.ok(validPhotoSport(sport),sport);
 for(const bad of ['', '../NFL','https://evil.test','A'.repeat(65),'SOCCER\nHeader:bad'])assert.equal(validPhotoSport(bad),false);
 assert.equal(photoSport('MLBLIVE'),'MLB');assert.equal(photoSport('WNBA1H'),'WNBA');assert.equal(photoSport('soccer_any_league'),'SOCCER');assert.equal(photoSport('esports_cs2'),'COUNTER_STRIKE');
});
test('Wikidata identity requires human, exact name and sport; ambiguity cannot be resolved by photo availability',()=>{
 const a=athlete('Q1','Fixture Person'),b=athlete('Q2','Fixture Person');
 assert.equal(selectPhotoEntity({Q1:a},related,{sport:'TENNIS',name:'Fixture Person'}),a);
 assert.equal(selectPhotoEntity({Q1:a},related,{sport:'GOLF',name:'Fixture Person'}),null);
 assert.equal(selectPhotoEntity({Q1:a},related,{sport:'TENNIS',name:'Different Person'}),null);
 b.claims.P18=[];assert.equal(selectPhotoEntity({Q1:a,Q2:b},related,{sport:'TENNIS',name:'Fixture Person'}),null);
 a.claims.P31=[item('Q43229')];assert.equal(selectPhotoEntity({Q1:a},related,{sport:'TENNIS',name:'Fixture Person'}),null);
});
test('Commons reuse requires source, creator and exact permitted licence; HTML is not retained',()=>{
 const credit=commonsLicense(info);assert.equal(credit.creator,'Fixture photographer');assert.equal(credit.license,'CC BY-SA 4.0');
 for(const url of ['https://creativecommons.org/licenses/by-nc/4.0/','https://creativecommons.org/licenses/by-nd/4.0/','https://evil.test/by/4.0/','javascript:bad'])assert.equal(commonsLicense({...info,extmetadata:{...info.extmetadata,LicenseUrl:{value:url}}}),null);
 assert.equal(commonsLicense({...info,extmetadata:{...info.extmetadata,Artist:{value:''}}}),null);
 assert.equal(commonsLicense({...info,descriptionurl:'https://evil.test/file'}),null);
 const html=photoCreditPage({verified:true,playerName:'<script>bad</script>',source:'Wikimedia Commons',...credit});
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('javascript:'));assert.ok(html.includes('creativecommons.org'));
});
test('photo URLs reject arbitrary hosts, credentials, ports, SVG and wrong paths',()=>{
 for(const url of ['http://upload.wikimedia.org/wikipedia/commons/x.jpg','https://user@upload.wikimedia.org/wikipedia/commons/x.jpg','https://127.0.0.1/x.jpg','https://a.espncdn.com:99/i/headshots/nfl/players/full/1.png','https://a.espncdn.com/anything.svg','https://upload.wikimedia.org/elsewhere/x.jpg'])assert.equal(safeDiscoveredPhotoUrl(url),null);
 assert.ok(safeDiscoveredPhotoUrl(info.thumburl));
});
test('new sport photograph is identity-verified, coalesced and persisted across restart',withDirectory(async dataDir=>{
 let calls=0;
 const payload={results:[{type:'player',totalFound:1,contents:[{displayName:'Fixture Player',sport:'tennis',uid:'s:850~a:42',link:{web:'https://www.espn.com/tennis/player/_/id/42/fixture'},image:{default:'https://a.espncdn.com/i/headshots/tennis/players/full/42.png'}}]}]};
 const fetchImpl=async url=>{calls++;return url.includes('/search/')?Response.json(payload):new Response(png,{headers:{'content-type':'image/png'}});};
 const get=createVerifiedArtwork({dataDir,fetchImpl});
 const [a,b]=await Promise.all([get('WTA','Fixture Player'),get('TENNIS','Fixture Player')]);
 assert.equal(a.verified,true);assert.equal(a.persisted,true);assert.equal(b.source,'ESPN');assert.equal(calls,2);
 const afterRestart=createVerifiedArtwork({dataDir,fetchImpl:async()=>{throw Error('Must use saved photo');}});
 const cached=await afterRestart('TENNIS','Fixture Player');assert.equal(cached.verified,true);assert.equal(cached.persisted,true);assert.ok(cached.body.equals(png));
}));
test('ESPN namesakes are not selected because only one has an image',async()=>{
 const contents=[42,43].map(id=>({displayName:'Fixture Player',sport:'tennis',uid:'s:850~a:'+id,link:{web:`https://www.espn.com/tennis/player/_/id/${id}/fixture`},...(id===42?{image:{default:`https://a.espncdn.com/i/headshots/tennis/players/full/${id}.png`}}:{})}));
 let images=0;const get=createPhotoDiscovery({json:async url=>url.includes('espn.com')?{results:[{type:'player',totalFound:2,contents}]}:{search:[]},imageBytes:async()=>{images++;return{bytes:png,type:'image/png'};}});
 assert.equal(await get('TENNIS','Fixture Player'),null);assert.equal(images,0);
});
test('licensed Commons fallback works for a sport outside the historical research allowlist',withDirectory(async dataDir=>{
 const a=athlete('Q1','Fixture Player','Q2');
 const fetchImpl=async raw=>{const url=new URL(raw);if(url.hostname==='upload.wikimedia.org')return new Response(png,{headers:{'content-type':'image/png'}});
 if(url.hostname==='commons.wikimedia.org')return Response.json({query:{pages:{1:{imageinfo:[info]}}}});
 if(url.searchParams.get('action')==='wbsearchentities')return Response.json({search:[{id:'Q1'}]});
 if(url.searchParams.get('ids')==='Q1')return Response.json({entities:{Q1:a}});
 return Response.json({entities:{Q2:{labels:{en:{value:'Rocket League'}}}}});};
 const result=await createVerifiedArtwork({dataDir,fetchImpl})('ROCKETLEAGUE','Fixture Player');
 assert.equal(result.verified,true);assert.equal(result.persisted,true);assert.equal(result.source,'Wikimedia Commons');assert.equal(result.license,'CC BY-SA 4.0');assert.equal(result.providerPlayerId,'wikidata:Q1');
}));
test('truncated web search never selects an unverified first result',async()=>{
 let imageCalls=0;const resolve=createPhotoDiscovery({json:async()=>({search:[{id:'Q1'}],'search-continue':10}),imageBytes:async()=>{imageCalls++;return{bytes:png,type:'image/png'};}});
 assert.equal(await resolve('ROCKETLEAGUE','Fixture Player'),null);assert.equal(imageCalls,0);
});
test('photo route supports new sport, strict missing-photo and credits without altering research allowlist',async()=>{
 const source=readFileSync(new URL('../frontdoor-prod.mjs',import.meta.url),'utf8');const begin=source.indexOf('async function maybeServeArtwork(');const functionSource=source.slice(begin,source.indexOf('\n}',begin)+2);
 let image={status:200,verified:false,body:png,contentType:'image/png'};
 const route=new Function('validPhotoSport','photoCreditPage','playerArtworkResponse','directJson',`${functionSource}; return maybeServeArtwork;`)(validPhotoSport,photoCreditPage,async()=>image,(res,status,body,headers)=>{res.writeHead(status,headers);res.end(JSON.stringify(body));});
 const response=()=>({status:0,headers:null,body:null,writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body;}});
 let res=response();await route({method:'GET',url:'/api/apex/player-artwork?sport=VALORANT&name=Fixture'},res);assert.equal(res.status,200);
 res=response();await route({method:'GET',url:'/api/apex/player-artwork?sport=VALORANT&name=Fixture&requirePhoto=1'},res);assert.equal(res.status,404);assert.match(res.body,/PHOTO_UNAVAILABLE/);
 image={...image,verified:true,persisted:true,playerName:'Fixture',source:'ESPN',sourceUrl:'https://www.espn.com/'};
 res=response();await route({method:'GET',url:'/api/apex/player-artwork?sport=VALORANT&name=Fixture&format=credits'},res);assert.equal(res.status,200);assert.match(res.body,/photo credit/);
 assert.ok(source.includes("const RESEARCH_SPORTS = new Set([...ARTWORK_SPORTS,'MLS','EPL','UCL']);"));
 assert.ok(source.includes('return current.count <= 180;'));
});
