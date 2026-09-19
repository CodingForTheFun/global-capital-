import test from 'node:test';
import assert from 'node:assert/strict';
import {BOOKS,bookId,bookSelection,bookEnabled,filterBookGroups} from '../lib/constants/books.mjs';
import {normalizePrizePicks,normalizeUnderdog,normalizeSleeper,normalizedFeedBoard,activePropsFromBoard} from '../lib/ingestion/normalize.mjs';
import {normalizeKalshi,normalizePolymarket,americanFromAsk} from '../lib/ingestion/exchanges.mjs';
import {createPublicFeeds} from '../lib/ingestion/public-feeds.mjs';
const start='2099-09-14T20:00:00Z',updated='2026-09-13T15:00:00Z';
function pp(){return {data:[{id:'q',type:'projection',attributes:{stat_type:'Points',line_score:24.5,start_time:start,updated_at:updated,odds_type:'standard'},relationships:{new_player:{data:{id:'p',type:'new_player'}},league:{data:{id:'nba',type:'league'}}}}],included:[{id:'p',type:'new_player',attributes:{name:'Test Player',team:'BOS'}},{id:'nba',type:'league',attributes:{name:'NBA'}}]};}
function ud(){return {players:[{id:'p',first_name:'Test',last_name:'Player',sport_id:'NBA',team:'BOS'}],appearances:[{id:'a',player_id:'p',match_id:'g'}],games:[{id:'g',scheduled_at:start}],over_under_lines:[{id:'u',stat_value:'25.5',updated_at:updated,over_under:{appearance_stat:{appearance_id:'a',stat:'Points'}},options:[{choice:'higher',payout_multiplier:'1.0'},{choice:'lower',payout_multiplier:'1.0'}]}]};}
test('registry contains the full supported book catalog, aliases and intentional empty selection',()=>{
 assert.equal(BOOKS.length,35);assert.equal(new Set(BOOKS.map(b=>b.id)).size,35);
 for(const b of BOOKS){assert.match(b.badgeColor,/^#[0-9A-F]{6}$/i);assert.ok(['dfs','exchange','sportsbook','sweepstakes'].includes(b.type));}
 assert.equal(bookId('Bovada'),'bvda');assert.equal(bookId('betonlineag'),'boag');assert.equal(bookId('williamhill_us'),'caesars');assert.equal(bookId('LowVig.ag'),'lowvig');assert.equal(bookId('tab'),'tab_au');assert.equal(bookId('Polymarket US'),'polymarket_us');
 assert.deepEqual(bookSelection(['FanDuel','fanduel']),['fanduel']);assert.ok(bookEnabled({sportsbookKey:'New Book'},null));assert.equal(bookEnabled({sportsbookKey:'fanduel'},[]),false);
 const groups=[{rows:[{sportsbookKey:'fanduel',line:20},{sportsbookKey:'draftkings',line:25}],comparisonOffers:[{sportsbookKey:'draftkings',line:25}]}];
 const filtered=filterBookGroups(groups,['fanduel']);assert.equal(filtered[0].rows.length,1);assert.equal(filtered[0].comparisonOffers.length,0);assert.equal(groups[0].rows.length,2);
});
test('DFS relationships, timestamps, source identity and missing odds survive normalization',()=>{
 const rows=normalizePrizePicks(pp());assert.equal(rows.length,1);const board=normalizedFeedBoard(rows);assert.equal(board.props.length,2);assert.equal(board.active_props[0].target_line,24.5);assert.equal(board.active_props[0].over_odds,null);assert.equal(board.props[0].providerUpdatedAt,new Date(updated).toISOString());
 assert.equal(normalizeUnderdog(ud()).length,1);assert.equal(normalizedFeedBoard(normalizeUnderdog(ud())).props[0].price,null);
 const bad=pp();bad.data[0].attributes.odds_type='goblin';assert.equal(normalizePrizePicks(bad).length,0);
 const dup=pp();dup.included.push(dup.included[0]);assert.equal(normalizePrizePicks(dup).length,0);
 const missing=pp();delete missing.data[0].attributes.line_score;assert.equal(normalizePrizePicks(missing).length,0);
 const bonus=ud();bonus.over_under_lines[0].options[0].payout_multiplier='1.5';assert.equal(normalizeUnderdog(bonus).length,0);
 const missingGame=ud();missingGame.games=[];assert.equal(normalizeUnderdog(missingGame).length,0);
});
test('cross-provider merge needs unique player, start, sport, team and stat',()=>{
 const r=normalizePrizePicks(pp()),reference={props:[{sport:'NBA',eventId:'game',playerId:'player',playerName:'Test Player',team:'BOS',marketId:'player_points',market:'Points',gameStartTime:start}]};
 assert.equal(normalizedFeedBoard(r,reference).props[0].playerId,'player');assert.equal(normalizedFeedBoard(r,reference).props[0].marketId,'player_points');
 reference.props.push({...reference.props[0],playerId:'namesake'});assert.notEqual(normalizedFeedBoard(r,reference).props[0].playerId,'player');
});
test('Sleeper roster endpoint never invents a pickem projection',()=>{
 const rows=normalizeSleeper({'p':{active:true,sport:'nfl',full_name:'Test Player',team:'BUF',position:'QB'},DEF:{active:true,sport:'nfl',full_name:'Bills',position:'DEF'}});assert.equal(rows.length,1);assert.equal(rows[0].line,undefined);
});
test('active_props pairs only same threshold and preserves unknown prices',()=>{
 const row={sport:'NBA',eventId:'e',playerId:'p',marketId:'player_points',sportsbookKey:'draftkings',providerUpdatedAt:updated};
 const paired=activePropsFromBoard({props:[{...row,side:'OVER',line:0,price:-110},{...row,side:'UNDER',line:0,price:105},{...row,side:'UNDER',line:.5,price:''}]});assert.equal(paired.length,2);assert.equal(paired[0].over_odds,-110);assert.equal(paired[0].under_odds,105);assert.equal(paired[1].under_odds,null);
});
test('exchanges retain contracts without guessing settlement or executable Gamma odds',()=>{
 const mapping={verified:true,evidenceUrl:'https://example.invalid/rules',sourceId:'k',book:'kalshi',expectedTitle:'Test prop',expectedRules:'Full game points over 24.5',period:'game',yesSide:'OVER',settlement:'strict-over-no-push',expiresAt:start,gameStartTime:start,line:24.5,nativePlayerId:'p',playerName:'Test Player',sport:'NBA',market:'Points',team:'BOS'};
 const m={ticker:'k',event_ticker:'e',title:mapping.expectedTitle,rules_primary:mapping.expectedRules,market_type:'binary',status:'open',strike_type:'greater',floor_strike:24.5,yes_ask_dollars:'.55',no_ask_dollars:'.49',updated_time:updated};
 assert.equal(normalizeKalshi({markets:[m]}).records.length,0);assert.equal(normalizeKalshi({markets:[m]},{mappings:[mapping]}).records.length,1);
 assert.equal(normalizeKalshi({markets:[{...m,rules_primary:'Different terms'}]},{mappings:[mapping]}).records.length,0);assert.equal(americanFromAsk('0'),null);
 const poly=normalizePolymarket([{id:'e',markets:[{id:'q',question:'Any winner',outcomes:'["Yes","No"]',outcomePrices:'["0.7","0.3"]',active:true,acceptingOrders:true}]}]);assert.equal(poly.contracts.length,1);assert.equal(poly.records.length,0);
});
test('public feeds deduplicate 10 refreshes, preserve cache on 429 and respect Retry-After',async()=>{
 let time=Date.parse(updated),calls=0,fail=false;const service=createPublicFeeds({now:()=>time,feeds:[{id:'prizepicks',url:'https://api.prizepicks.com/projections',ttl:1000}],fetcher:async()=>{calls++;return fail?new Response('',{status:429,headers:{'retry-after':'120'}}):Response.json(pp());}});
 await Promise.all(Array.from({length:10},()=>service.refresh()));assert.equal(calls,1);assert.equal((await service.board('NBA',{props:[]})).props.length,2);
 time+=1001;fail=true;await service.refresh();assert.equal(calls,2);await service.refresh();assert.equal(calls,2);assert.equal((await service.board('NBA',{props:[]})).props.length,2);time+=119999;await service.refresh();assert.equal(calls,2);time+=1;await service.refresh();assert.equal(calls,3);
});
test('negative cache and sequential public feed concurrency are bounded',async()=>{
 let calls=0,active=0,max=0;const service=createPublicFeeds({feeds:[{id:'prizepicks',url:'https://api.prizepicks.com/projections',ttl:1000},{id:'underdog',url:'https://api.underdogfantasy.com/beta/v5/over_under_lines',ttl:1000}],fetcher:async url=>{calls++;max=Math.max(max,++active);await new Promise(r=>setTimeout(r,5));active--;return Response.json(url.includes('prizepicks')?{data:[],included:[]}:{players:[],appearances:[],over_under_lines:[]});}});await service.refresh();await service.refresh();assert.equal(calls,2);assert.equal(max,1);
});
test('unsafe next-page URLs and malformed snapshots cannot replace the last valid board',async()=>{
 let time=0,mode='good',calls=0;const service=createPublicFeeds({now:()=>time,feeds:[{id:'prizepicks',url:'https://api.prizepicks.com/projections',ttl:1}],fetcher:async()=>{calls++;if(mode==='bad')return Response.json({data:[],included:[],links:{next:'https://other.example/projections'}});if(mode==='invalid')return Response.json({error:'busy'});return Response.json(pp());}});
 await service.refresh();time=2;mode='bad';await service.refresh();assert.equal(calls,2);assert.equal((await service.board('NBA',{props:[]})).props.length,2);
 time=1e9;mode='invalid';await service.refresh();assert.equal((await service.board('NBA',{props:[]})).props.length,2);
});
test('DFS keeps source player categories while still excluding team-unit props',()=>{
 const firstHalf=pp();firstHalf.data[0].attributes.stat_type='1H Points';const firstHalfRows=normalizePrizePicks(firstHalf);assert.equal(firstHalfRows.length,1);assert.equal(firstHalfRows[0].period,'h1');
 const fantasy=pp();fantasy.data[0].attributes.stat_type='Fantasy Points';assert.equal(normalizePrizePicks(fantasy).length,1);
 const team=pp();team.data[0].attributes.stat_type='Team sacks allowed';assert.equal(normalizePrizePicks(team).length,0);
});
