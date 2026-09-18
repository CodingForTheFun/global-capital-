import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const js=ts.transpileModule(readFileSync(new URL('../lib/player-headshots.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {headshotSources,artworkSport,unavailablePhoto}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const player={sport:'NFL',name:'Fixture Player',team:'TEST'};
const remote=src=>new URL(src,'https://example.test').searchParams.get('url');
test('explicit ESPN identity uses the same-origin restricted image optimizer',()=>{
 const sources=headshotSources({...player,providerPlayerId:'espn:42'});
 assert.ok(sources[0].startsWith('/_next/image?'));
 assert.equal(remote(sources[0]),'https://a.espncdn.com/i/headshots/nfl/players/full/42.png');
 assert.ok(sources[1].startsWith('/api/apex/player-artwork?'));
 assert.equal(sources.at(-1),unavailablePhoto);
 assert.equal(new Set(sources).size,sources.length);
 assert.ok(sources.every(s=>s.startsWith('/')||s===unavailablePhoto),'no browser third-party image request');
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
test('missing identity is a neutral unavailable image and query values are encoded',()=>{
 assert.deepEqual(headshotSources({sport:'NFL',name:''}),[unavailablePhoto]);
 const url=new URL(headshotSources({...player,name:'Name & <Other>'})[0],'https://example.test');
 assert.equal(url.searchParams.get('name'),'Name & <Other>');
 assert.equal(url.searchParams.get('team'),'TEST');
});
test('the mounted board is the previous TerminalBoard, with photos in all three existing slots',()=>{
 const page=readFileSync(new URL('../app/board/page.tsx',import.meta.url),'utf8');
 const board=readFileSync(new URL('../components/terminal-board.tsx',import.meta.url),'utf8');
 assert.ok(page.includes('<TerminalBoard'));
 assert.ok(!page.includes('WorkspaceBoard'));
 assert.equal((board.match(/<PlayerHeadshot\b/g)||[]).length,3);
 assert.ok(!board.includes("event.currentTarget.style.visibility = 'hidden'"));
 assert.ok(board.includes('DesktopMatrix')&&board.includes('MobileMatrix'));
});
