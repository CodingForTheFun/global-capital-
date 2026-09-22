import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {categoryOptions,uniquePlayerCards,playerCardKey,dedupeOffers,propType} from '../lib/ui/prop-board.mjs';
import {createVerifiedArtwork,verifiedPhotoUrl} from '../lib/autoscout/providers/verified-artwork.mjs';
import {marketContract,statValue} from '../lib/data-sources/espn/stat-contract.mjs';
const row=(key,playerId='one',marketId='player_points',eventId='e1')=>({key,playerId,playerName:playerId,sport:'NBA',marketId,eventId,market:'Points'});
test('one player card across markets and events, every exact prop remains selectable',()=>{
 const groups=[row('p'),row('r','one','player_rebounds'),row('e','one','player_points','e2'),row('two','two')];
 const cards=uniquePlayerCards(groups);
 assert.equal(cards.length,2);assert.equal(cards[0].playerChoices.length,3);
 const selected=new Map([[playerCardKey(groups[0]),'e']]);
 assert.equal(uniquePlayerCards(groups,selected)[0].eventId,'e2');
 assert.equal(uniquePlayerCards(groups,selected)[0].marketId,'player_points');
 assert.equal(categoryOptions(groups,'NBA')[0].count,2);
 assert.equal(categoryOptions(groups,'NBA').find(c=>c.label==='Rebounds').count,1);
});
test('player, defensive unit, namesake and league identities cannot merge',()=>{
 // A real namesake collision is two athletes on two teams — Josh Allen the
 // Bills quarterback and Josh Allen the Jaguars linebacker. Differing provider
 // IDs alone do not make two people: on a live board a third of names carried
 // several IDs and every one was a single athlete quoted by several books.
 const p={...row('a'),team:'BUF'};
 const g=[p,{...p,key:'team',entityType:'team'},{...p,key:'other',playerId:'other-id',team:'JAX'},{...p,key:'league',sport:'WNBA'}];
 assert.equal(uniquePlayerCards(g).length,4);
});
test('one athlete quoted by several books is one card, not one card per book',()=>{
 // The duplicate-card case: same athlete, a different internal id from each
 // book, and — as on the real board — a team on only some of the rows. All of
 // it must collapse, or he appears five times. Keying a teamless row on the
 // empty team caused 17 false splits on a live NFL board before this.
 const p={...row('a'),team:'KC'};
 const books=[{...p,key:'q0',playerId:'dk'},{...p,key:'q1',playerId:'fd'},
  {...p,key:'q2',playerId:'mgm',team:''},{...p,key:'q3',playerId:'czr',team:''},
  {...p,key:'q4',playerId:'pn'}];
 assert.equal(uniquePlayerCards(books).length,1);
});
test('provider team aliases and raw market keys collapse to one exact player prop',()=>{
 const base={sport:'NFL',entityType:'player',eventId:'e-alias',playerId:'p-arvell',playerName:'Arvell Reese',gameStartTime:'2026-09-21T20:00:00Z',homeTeam:'Los Angeles Rams',awayTeam:'New York Giants'};
 const groups=[
  {...base,key:'book-a',team:'NYG',market:'Solo Tackles',rows:[{sportsbookKey:'fliff',side:'OVER',line:3.5,price:-145}]},
  {...base,key:'book-b',team:'New York Giants',market:'player_solo_tackles',rows:[{sportsbookKey:'underdog',side:'OVER',line:3.5,price:-141}]},
 ];
 const cards=uniquePlayerCards(groups);
 assert.equal(cards.length,1);
 assert.equal(cards[0].playerChoices.length,1);
 assert.equal(propType(cards[0]),'Solo tackles');
 assert.deepEqual(cards[0].rows.map(quote=>quote.sportsbookKey).sort(),['fliff','underdog']);
});
test('a row that cannot be attributed to either namesake gets its own card',()=>{
 // Two athletes share the name and a third row arrives with no team. Which of
 // them it belongs to is unknowable, so it stays separate rather than having a
 // stranger's props attached to one of their cards.
 const p=row('a');
 const rows=[{...p,key:'buf',playerId:'i1',team:'BUF'},{...p,key:'jax',playerId:'i9',team:'JAX'},{...p,key:'none',playerId:'i7'}];
 assert.equal(uniquePlayerCards(rows).length,3);
});
test('without a team, same-named athletes still merge, and that limit is deliberate',()=>{
 // About a tenth of board rows arrive with no team. There is then nothing that
 // distinguishes a namesake from the same athlete, and inventing a split would
 // be a guess. Asserted so the limit stays visible instead of being rediscovered.
 const p=row('a');
 assert.equal(uniquePlayerCards([p,{...p,key:'other',playerId:'other-id'}]).length,1);
});
test('duplicate book quotes collapse, with most recent real quote kept',()=>{
 const a={side:'OVER',line:20.5,sportsbookKey:'book',price:-110,providerUpdatedAt:'2026-09-12T12:00:00Z'};
 const b={...a,price:-115,providerUpdatedAt:'2026-09-12T12:05:00Z'};
 assert.deepEqual(dedupeOffers([a,b,{...a,side:'UNDER'}]).map(r=>r.price),[-115,-110]);
 assert.equal(propType({sport:'NFL',marketId:'player_assists'}),'Assisted tackles');
 assert.equal(propType({sport:'NBA',marketId:'player_points_q1',market:'First-quarter points'}),'First-quarter points');
});
const fixture=JSON.parse(readFileSync(new URL('./fixtures/espn-nfl-search.json',import.meta.url)));
const png=Buffer.from([137,80,78,71,13,10,26,10]);
function withArtwork(fn){return async()=>{const dir=mkdtempSync(path.join(tmpdir(),'artwork-v2-'));try{await fn(dir);}finally{rmSync(dir,{recursive:true,force:true});}};}
test('verified athlete image bytes are cached and requests coalesced',withArtwork(async dataDir=>{
 let calls=0;const get=createVerifiedArtwork({dataDir,fetchImpl:async url=>{calls++;if(url.includes('/search/'))return Response.json(fixture);assert.equal(url,'https://a.espncdn.com/i/headshots/nfl/players/full/8439.png');return new Response(png,{headers:{'content-type':'image/png'}});}});
 const results=await Promise.all([get('NFL','Aaron Rodgers'),get('NFL','Aaron Rodgers')]);
 assert.equal(results[0].verified,true);assert.equal(results[1].providerPlayerId,'history:NFL:8439');
 assert.equal((await get('NFL','Aaron Rodgers')).verified,true);assert.equal(calls,2);
}));
test('wrong athlete results never become a photograph and missed lookup recovers',withArtwork(async dataDir=>{
 let clock=1000,empty=true;const get=createVerifiedArtwork({dataDir,now:()=>clock,fetchImpl:async url=>url.includes('/search/')?Response.json(empty?{results:[]}:fixture):new Response(png,{headers:{'content-type':'image/png'}})});
 assert.equal((await get('NFL','Different Person')).verified,false);
 assert.equal((await get('NFL','Aaron Rodgers')).verified,false);
 empty=false;clock+=360000;
 assert.equal((await get('NFL','Aaron Rodgers')).verified,true,'identity search negative cache must expire');
}));
test('league mismatch, unsafe URL and invalid image bytes are rejected',withArtwork(async dataDir=>{
 assert.equal(verifiedPhotoUrl('https://evil.test/players/full/8439.png','8439'),null);
 assert.equal(verifiedPhotoUrl('https://a.espncdn.com/i/headshots/nfl/players/full/1.png','8439'),null);
 const get=createVerifiedArtwork({dataDir,fetchImpl:async url=>url.includes('/search/')?Response.json(fixture):new Response('{"error":"missing"}',{headers:{'content-type':'image/png'}})});
 assert.equal((await get('NBA','Aaron Rodgers')).verified,false);
 assert.equal((await get('NFL','Aaron Rodgers')).verified,false);
 const bad=await get('NFL','<& script');assert.ok(!bad.body.toString().includes('><&'));
}));
test('no face is fetched for a defensive unit',withArtwork(async dataDir=>{
 const get=createVerifiedArtwork({dataDir,fetchImpl:async()=>{throw Error('Should not fetch');}});
 assert.equal((await get('NFL','Green Bay Packers',{entityType:'team'})).verified,false);
}));
test('longest football plays and defensive interceptions use their own raw columns',()=>{
 const football=(key)=>marketContract({sport:'NFL',providerMarketKey:key});
 assert.equal(statValue({longPassing:'52'},football('player_pass_longest_completion')),52);
 assert.equal(statValue({longRushing:'19'},football('player_rush_longest')),19);
 assert.equal(statValue({longReceiving:'31'},football('player_reception_longest')),31);
 const interceptions=football('player_defensive_interceptions');
 assert.equal(statValue({soloTackles:'3',assistTackles:'2',interceptions:'1'},interceptions),1);
 assert.equal(statValue({passingAttempts:'25',interceptions:'1'},interceptions),null);
 assert.equal(statValue({rushingYards:'100'},football('player_rush_longest')),null);
});
