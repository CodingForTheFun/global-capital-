import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const js=ts.transpileModule(readFileSync(new URL('../lib/player-headshots.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {headshotSources,artworkSport,sportFallbackPhoto}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const player={sport:'NFL',name:'Fixture Player',team:'TEST'};
const remote=src=>new URL(src,'https://example.test').searchParams.get('url');
test('explicit ESPN identity uses the same-origin restricted image optimizer',()=>{
 const sources=headshotSources({...player,providerPlayerId:'espn:42'});
 assert.ok(sources[0].startsWith('/_next/image?'));
 assert.equal(remote(sources[0]),'https://a.espncdn.com/i/headshots/nfl/players/full/42.png');
 assert.ok(sources[1].startsWith('/api/apex/player-artwork?'));
 assert.equal(sources.at(-1),sportFallbackPhoto('NFL'));
 assert.equal(new Set(sources).size,sources.length);
 assert.ok(sources.every(s=>s.startsWith('/')||s===sportFallbackPhoto('NFL')));
});
test('verified history identities stay in their own sport',()=>{
 assert.ok(headshotSources({...player,providerPlayerId:'history:NFL:42'})[0].startsWith('/_next/image?'));
 assert.ok(headshotSources({...player,providerPlayerId:'history:NBA:42'})[0].startsWith('/api/apex/'));
});
test('raw provider IDs and URLs never become guessed athlete photos',()=>{
 for(const providerPlayerId of ['42','provider:42','https://example.com/image.png','espn:../42','espn:42?other=1']) assert.ok(headshotSources({...player,providerPlayerId})[0].startsWith('/api/apex/'));
});
test('native provider sport codes map only within the artwork helper',()=>{
 assert.equal(artworkSport('football_nfl'),'NFL');
 assert.equal(artworkSport('soccer_uefa_nations_league'),'SOCCER');
 assert.ok(remote(headshotSources({...player,sport:'soccer_uefa_nations_league',providerPlayerId:'espn:42'})[0]).includes('/soccer/players/full/42.png'));
 assert.equal(artworkSport('UNKNOWN_SPORT'),'UNKNOWN_SPORT');
});
test('missing identity is neutral and query values are encoded',()=>{
 assert.deepEqual(headshotSources({sport:'NFL',name:''}),[sportFallbackPhoto('NFL')]);
 const url=new URL(headshotSources({...player,name:'Name & <Other>'})[0],'https://example.test');
 assert.equal(url.searchParams.get('name'),'Name & <Other>');assert.equal(url.searchParams.get('team'),'TEST');
});
test('premium board keeps shared player photos and direct research navigation',()=>{
 const page=readFileSync(new URL('../app/board/page.tsx',import.meta.url),'utf8');
 const board=readFileSync(new URL('../components/premium-board.tsx',import.meta.url),'utf8');
 assert.ok(page.includes('<PremiumBoard'));assert.ok(!page.includes('WorkspaceBoard'));
 assert.ok(board.includes('<PlayerHeadshot'));
 assert.ok(board.includes('router.push(playerResearchHref'));
 assert.ok(board.includes('Opponent')&&board.includes('Home/Away')&&board.includes('Book')&&board.includes('Line'));
 assert.ok(!board.includes('Apply')&&!board.includes('Clear'));
});
test('period aliases use their parent sport only for pictures',()=>{
 for(const [sport,expected] of [['MLBLIVE','MLB'],['WNBA1H','WNBA'],['NFLQ1','NFL'],['CFB','NCAAF']])assert.equal(artworkSport(sport),expected);
 const url=new URL(headshotSources({sport:'soccer_uefa_nations_league',name:'Test Player'})[0],'https://example.test');assert.equal(url.searchParams.get('sport'),'EPL');
});
test('native MLB and NBA IDs stay in their explicitly named provider and sport',()=>{
 assert.ok(remote(headshotSources({sport:'MLB',name:'Test Player',providerPlayerId:'mlb:660271'})[0]).includes('/people/660271/'));
 assert.ok(remote(headshotSources({sport:'NBA',name:'Test Player',providerPlayerId:'nba:201939'})[0]).includes('/201939.png'));
 assert.ok(headshotSources({sport:'NFL',name:'Test Player',providerPlayerId:'nba:201939'})[0].startsWith('/api/apex'));
});


test('missing player artwork falls back to the correct sport badge, never player initials',()=>{
 const wnba=headshotSources({sport:'WNBA',name:'Unknown Fixture Player'}).at(-1);
 const mlb=headshotSources({sport:'MLB',name:'Unknown Fixture Player'}).at(-1);
 assert.equal(wnba,sportFallbackPhoto('WNBA'));
 assert.equal(mlb,sportFallbackPhoto('MLB'));
 assert.notEqual(wnba,mlb);
 assert.ok(decodeURIComponent(wnba).includes('WNBA'));
 assert.ok(!decodeURIComponent(wnba).includes('Unknown Fixture Player'));
});
