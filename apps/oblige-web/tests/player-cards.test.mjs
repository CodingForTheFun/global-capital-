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

// Synthetic identity fixtures, not production records or fabricated player history.
const eventGroup = (key, extra = {}) => ({
  key, propId: key, player: 'Alec Pierce', providerPlayerId: 'espn:test-pierce',
  market: 'Receiving Yards', marketId: 'receiving_yards', line: 34.5, sport: 'NFL',
  team: 'Indianapolis Colts', opponent: 'Kansas City Chiefs',
  homeTeam: 'Kansas City Chiefs', awayTeam: 'Indianapolis Colts',
  matchup: 'Indianapolis Colts @ Kansas City Chiefs', startsAt: '2050-10-01T19:00:00Z', live: false,
  quotes: [{ eventId: 'book-game', sportsbook: 'Bovada', sportsbookKey: 'bovada', side: 'OVER', line: 34.5, price: -210 }],
  bestOver: null, bestUnder: null, ...extra,
});
const partialEventGroup = (key, extra = {}) => eventGroup(key, { team: null, opponent: null, homeTeam: null, awayTeam: null, matchup: 'Matchup unavailable', ...extra });
const crossBookPattern = () => [
  partialEventGroup('pp', { team: 'IND', matchup: 'IND', line: 43.5, quotes: [{ eventId: 'pp-game', sportsbook: 'PrizePicks', sportsbookKey: 'prizepicks', side: 'OVER', line: 43.5 }] }),
  partialEventGroup('ud', { providerPlayerId: null, line: 45.5, quotes: [{ eventId: 'ud-game', sportsbook: 'Underdog', sportsbookKey: 'underdog', side: 'OVER', line: 45.5 }] }),
  eventGroup('bovada'),
];
const eventMembership = groups => groupPlayerCards(groups).map(c => [c.key, c.variants.map(v => v.key).sort()]).sort((a, b) => a[0].localeCompare(b[0]));

test('full, team-only and missing matchups share one card with a verified player and exact start', () => {
  const groups = crossBookPattern(), before = JSON.stringify(groups);
  const cards = groupPlayerCards(groups);
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].variants.map(v => v.line), [43.5, 45.5, 34.5]);
  const board = collapsePlayerCards(groups, groups);
  assert.equal(board.length, 1); assert.equal(board[0].bookCount, 3);
  assert.equal(JSON.stringify(groups), before, 'never rewrite the supplied lines, quotes or metadata');
});
test('cross-book reconciliation is deterministic in every input order', () => {
  const [a, b, c] = crossBookPattern(), expected = eventMembership([a, b, c]);
  for (const rows of [[c, b, a], [b, a, c], [a, c, b], [b, c, a], [c, a, b]]) assert.deepEqual(eventMembership(rows), expected);
});
test('equivalent UTC offsets match, different scheduled games do not', () => {
  const groups = [eventGroup('full'), partialEventGroup('offset', { startsAt: '2050-10-01T15:00:00-04:00' }), partialEventGroup('later', { startsAt: '2050-10-01T23:00:00Z' })];
  assert.equal(groupPlayerCards(groups).length, 2);
});
test('an explicit shared event links an undated partial quote without assuming the next game', () => {
  const rows = [eventGroup('full'), partialEventGroup('partial', { startsAt: null, providerPlayerId: null })];
  assert.equal(groupPlayerCards(rows).length, 1);
});
test('different undated events and completely unknown games stay separate', () => {
  const rows = [eventGroup('full'), partialEventGroup('other', { startsAt: null, quotes: [{ eventId: 'unrelated' }] }), partialEventGroup('unknown', { startsAt: null, quotes: [] })];
  assert.equal(groupPlayerCards(rows).length, 3);
});
test('conflicting times override shared event IDs and undated rows cannot bridge them', () => {
  const rows = [eventGroup('first'), eventGroup('second', { startsAt: '2050-10-01T23:00:00Z' }), partialEventGroup('ambiguous', { startsAt: null })];
  assert.equal(groupPlayerCards(rows).length, 3);
  assert.deepEqual(eventMembership(rows), eventMembership([...rows].reverse()));
});
test('conflicting opponents at one start stay separate; a partialEventGroup offer cannot bridge them', () => {
  const rows = [eventGroup('one'), eventGroup('two', { opponent: 'Buffalo Bills', homeTeam: 'Buffalo Bills', matchup: 'Indianapolis Colts @ Buffalo Bills', quotes: [{ eventId: 'another-game' }] }), partialEventGroup('unresolved', { quotes: [{ eventId: 'third-id' }] })];
  assert.equal(groupPlayerCards(rows).length, 3);
  assert.deepEqual(eventMembership(rows), eventMembership([...rows].reverse()));
});
test('same-name verified people are not combined and ID-less evidence stays ambiguous', () => {
  const rows = [eventGroup('one'), eventGroup('two', { providerPlayerId: 'espn:someone-else' }), partialEventGroup('no-id', { providerPlayerId: null })];
  assert.equal(groupPlayerCards(rows).length, 3);
});
test('placeholder team values do not become authoritative game anchors', () => {
  const rows = [eventGroup('full'), partialEventGroup('placeholder', { homeTeam: 'TBD', awayTeam: 'Unknown', quotes: [{ eventId: 'partial-game' }] })];
  assert.equal(groupPlayerCards(rows).length, 1);
});
test('the identity rule is sport-agnostic, but sport boundaries are never crossed', () => {
  for (const sport of ['NFL', 'WNBA', 'MLB', 'CRICKET', 'TENNIS', 'ROCKETLEAGUE', 'NEW_PROVIDER_SPORT']) {
    const rows = crossBookPattern().map(v => ({ ...v, sport }));
    assert.equal(groupPlayerCards(rows).length, 1, sport);
  }
  assert.equal(groupPlayerCards([eventGroup('nfl'), partialEventGroup('wnba', { sport: 'WNBA' })]).length, 2);
});
test('filtered board and research use the same card and retain actual books, lines, categories and periods', () => {
  const groups = crossBookPattern();
  groups.push(eventGroup('receptions', { market: 'Receptions', marketId: 'receptions', line: 3.5 }));
  groups.push(eventGroup('half', { market: 'Receiving Yards · First half', line: 17.5 }));
  const board = collapsePlayerCards([groups[0]], groups), card = groupPlayerCards(groups)[0];
  assert.equal(board.length, 1); assert.equal(board[0].categoryCount, 3); assert.equal(board[0].bookCount, 3);
  assert.equal(playerCategories(card.variants).length, 3);
  const selection = postedSelection(card.variants, playerMarketKey(groups[0]), 'underdog', 43.5);
  assert.equal(selection.line, 45.5); assert.equal(selection.bestOver, null);
  assert.equal(postedSelection(card.variants, playerMarketKey(groups[0]), 'not-posted', 43.5), null);
  const href = new URL(playerResearchHref(board[0]), 'https://example.test');
  assert.equal(href.searchParams.get('card'), card.key);
});

test('sports without team metadata reconcile by a stable player ID and exact start', () => {
 const rows = [partialEventGroup('one'), partialEventGroup('two', { quotes: [{ eventId: 'other-book' }] }), partialEventGroup('no-id', { providerPlayerId: null, quotes: [{ eventId: 'third-book' }] })];
 assert.equal(groupPlayerCards(rows).length, 1);
});
test('a same-name incomplete verified identity cannot make an ID-less offer adopt the wrong person', () => {
 const rows = [eventGroup('one'), partialEventGroup('two', { providerPlayerId: 'espn:someone-else' }), partialEventGroup('no-id', { providerPlayerId: null, quotes: [{ eventId: 'no-identity-event' }] })];
 assert.equal(groupPlayerCards(rows).length, 3);
 assert.deepEqual(eventMembership(rows), eventMembership([...rows].reverse()));
});
test('a name and kickoff without any verified identity or matchup are not enough to merge different events', () => {
 const rows = [partialEventGroup('one', { providerPlayerId: null }), partialEventGroup('two', { providerPlayerId: null, quotes: [{ eventId: 'other-event' }] })];
 assert.equal(groupPlayerCards(rows).length, 2);
});
