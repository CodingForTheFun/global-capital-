import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const js=ts.transpileModule(readFileSync(new URL('../lib/player-cards.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {groupPlayerCards,collapsePlayerCards,playerMarketKey,playerCategories,postedSelection,playerResearchHref,restrictBook}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const g=(key,extra={})=>({key,propId:key,player:'Test Player',providerPlayerId:'espn:42',market:'Points',marketId:'player_points',line:20.5,sport:'NBA',team:'TEST',opponent:'OTHER',homeTeam:'TEST',awayTeam:'OTHER',matchup:'OTHER @ TEST',startsAt:'2050-10-01T19:00:00Z',live:false,quotes:[{eventId:'game-one',sportsbook:'Book A',sportsbookKey:'book_a',side:'OVER',line:20.5,price:-110}],bestOver:null,bestUnder:null,...extra});
test('one player/game card retains all stats, alternate lines, books and sides',()=>{
 const groups=[g('a'),g('b',{line:21.5}),g('c',{market:'Rebounds',marketId:'player_rebounds',line:5.5}),g('d',{market:'Points · First half',line:10.5}),g('a')];
 const cards=groupPlayerCards(groups);assert.equal(cards.length,1);assert.equal(cards[0].variants.length,5);
 const rows=collapsePlayerCards(groups,groups);assert.equal(rows.length,1);assert.equal(rows[0].categoryCount,3);assert.equal(rows[0].bookCount,1);
});
test('game time keeps doubleheaders and subsequent dates separate',()=>{
 assert.equal(groupPlayerCards([g('one'),g('two',{startsAt:'2050-10-01T23:00:00Z'}),g('three',{startsAt:'2050-10-02T19:00:00Z'})]).length,3);
});
test('names alone do not combine two verified people, games, or sports',()=>{
 assert.equal(groupPlayerCards([g('one'),g('two',{providerPlayerId:'espn:99'}),g('three',{sport:'WNBA'})]).length,3);
 assert.equal(groupPlayerCards([g('one',{startsAt:null,quotes:[{eventId:'one'}]}),g('two',{startsAt:null,quotes:[{eventId:'two'}]})]).length,2);
});
test('the same event across book identifiers and an ID-less quote resolve once',()=>{
 const groups=[g('one'),g('two',{providerPlayerId:null,player:'  TEST Player ',quotes:[{eventId:'another-book-event-id',sportsbook:'Book B'}]})];
 assert.equal(groupPlayerCards(groups).length,1);assert.equal(collapsePlayerCards(groups,groups)[0].bookCount,2);
});
test('unknown game identity does not merge unrelated events',()=>{
 const groups=[g('one',{startsAt:null,homeTeam:null,awayTeam:null,quotes:[]}),g('two',{startsAt:null,homeTeam:null,awayTeam:null,quotes:[]})];
 assert.equal(groupPlayerCards(groups).length,2);
});
test('filter first, then deduplicate, then paginate without losing selectable stats',()=>{
 const groups=[g('points'),g('rebounds',{market:'Rebounds',marketId:'player_rebounds',line:6.5})];
 const rows=collapsePlayerCards([groups[1]],groups);assert.equal(rows[0].market,'Rebounds');assert.equal(rows[0].categoryCount,2);
 assert.equal(rows[0].playerCardKey,collapsePlayerCards(groups,groups)[0].playerCardKey);
});
test('category choices are unique across lines but exact periods remain separate',()=>{
 const groups=[g('one'),g('two',{line:21.5}),g('three',{market:'Points · First half',line:10.5})];
 assert.equal(playerCategories(groups).length,2);assert.notEqual(playerMarketKey(groups[0]),playerMarketKey(groups[2]));
});
test('changing books chooses that book real line and never borrows an unavailable quote',()=>{
 const groups=[g('one'),g('two',{line:21.5,quotes:[{sportsbook:'Book B',sportsbookKey:'book_b',line:21.5,price:125,side:'OVER'}]})];
 const selected=postedSelection(groups,playerMarketKey(groups[0]),'book_b',20.5);assert.equal(selected.line,21.5);assert.equal(selected.bestOver.price,125);assert.equal(selected.bestUnder,null);
 assert.equal(postedSelection(groups,playerMarketKey(groups[0]),'not-posted',20.5),null);
});
test('repeated ingestion quotes do not repeat prices in the research view',()=>{
 const row={sportsbook:'Book A',sportsbookKey:'book_a',side:'OVER',line:20.5,price:-110};
 assert.equal(restrictBook(g('one',{quotes:[row,{...row}]}),null).quotes.length,1);
});
test('research URL preserves exact game/card and selected category and book',()=>{
 const card=collapsePlayerCards([g('one')],[g('one')])[0];
 const url=new URL(playerResearchHref(card,undefined,'book_a'),'https://example.test');
 assert.equal(url.searchParams.get('card'),card.playerCardKey);assert.equal(url.searchParams.get('category'),playerMarketKey(card));assert.equal(url.searchParams.get('book'),'book_a');
});
test('blank players and invalid lines never form cards',()=>{
 assert.equal(groupPlayerCards([g('empty',{player:' '}),g('bad',{line:NaN})]).length,0);
});
