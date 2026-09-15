import test from 'node:test';
import assert from 'node:assert/strict';
import { compareResearchQuotes } from '../lib/ui/line-comparison.mjs';

const now=Date.parse('2026-09-15T07:00:00Z');
const base={sport:'NFL',eventId:'game-1',playerId:'p1',playerName:'Example Player',team:'ABC',marketId:'player_pass_yds',market:'Passing yards',entityType:'player',period:'game',archived:false};
const row=(book,side,line,price,minutesAgo=1)=>({...base,sportsbookKey:book,sportsbook:book,side,line,price,ingestedAt:new Date(now-minutesAgo*60_000).toISOString()});

test('Best Line Finder treats current ingestion time as verified freshness fallback',()=>{
 const group={...base,rows:[row('draftkings','OVER',207.5,-110),row('draftkings','UNDER',207.5,-110)]};
 const result=compareResearchQuotes(group,{line:207.5,side:'OVER',now});
 assert.equal(result.bestLines.OVER,207.5);
 assert.equal(result.bestLines.UNDER,207.5);
 assert.equal(result.offers.every(q=>q.fresh),true);
});

test('best exact-line price can display from one real fresh book without fabricating consensus',()=>{
 const group={...base,rows:[row('draftkings','OVER',207.5,-105)]};
 const result=compareResearchQuotes(group,{line:207.5,side:'OVER',now});
 assert.equal(result.bestPrices.OVER.length,1);
 assert.equal(result.bestPrices.OVER[0].price,-105);
 assert.equal(result.consensus,null);
});

test('consensus requires two distinct fresh books',()=>{
 const group={...base,rows:[row('draftkings','OVER',207.5,-105),row('fanduel','OVER',208.5,-110)]};
 const result=compareResearchQuotes(group,{line:207.5,side:'OVER',now});
 assert.equal(result.consensus,208);
});
