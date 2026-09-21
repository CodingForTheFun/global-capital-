import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { loadLib } from './load-lib.mjs';
const {chooseOffer,toResearchGroup,expectedValue,booksFor}=await loadLib('workspace');
const offer=(book,line,side='OVER',price=-110)=>({key:`${book}:${line}:${side}`,outcomeId:null,book,bookName:book,line,choice:side,side,price,multiplier:null,updatedAt:null,dfs:false,conflict:false});
const market={key:'rush',marketKey:'player_rush_yds',label:'Rushing yards',period:null,variant:'standard',offers:[offer('a',50.5),offer('a',50.5,'UNDER'),offer('b',55.5),offer('b',60.5)]};
test('book change selects that book real line without cloning the player',()=>{assert.equal(chooseOffer(market,'b',50.5).line,55.5);assert.equal(chooseOffer(market,'b',60.5).line,60.5);assert.equal(booksFor(market).length,2);});
test('research adapter keeps only quotes at the exact selected line and missing prices missing',()=>{const player={key:'p',name:'Test',playerId:'1',eventId:'e',sport:'football_nfl',startsAt:null,homeTeam:'A',awayTeam:'B'};const m={...market,offers:[...market.offers,offer('c',55.5,'OVER',null)]};const group=toResearchGroup(player,m,m.offers[2]);assert.equal(group.line,55.5);assert.equal(group.quotes.length,2);assert.equal(group.quotes.find(q=>q.sportsbookKey==='c').price,undefined);assert.throws(()=>toResearchGroup(player,m,{...m.offers[0],line:null}));});
const now=Date.parse('2026-09-18T12:00:00Z');
const model={available:true,code:'READY',modelVersion:'test-only',validation:{method:'chronological-heldout-real-lines'},expiresAt:'2026-09-18T12:10:00Z',probabilityOver:.5,probabilityUnder:.4,probabilityPush:.1};
test('push-adjusted expected profit uses the selected quote',()=>{assert.ok(Math.abs(expectedValue(model,offer('a',10,'OVER',100),now)-10)<1e-8);assert.ok(Math.abs(expectedValue(model,offer('b',10,'OVER',150),now)-35)<1e-8);});
test('DFS, missing/conflicting prices, expiry and unvalidated models never show invented EV',()=>{for(const o of [{...offer('a',1),dfs:true},{...offer('a',1),price:null},{...offer('a',1),conflict:true}])assert.equal(expectedValue(model,o,now),null);assert.equal(expectedValue({...model,expiresAt:'bad'},offer('a',1),now),null);assert.equal(expectedValue({...model,validation:{}},offer('a',1),now),null);assert.equal(expectedValue({...model,probabilityPush:.9},offer('a',1),now),null);});

test("research adapter retains an explicitly supplied player position",()=>{const p={key:"p",name:"Center",playerId:"1",position:"C",eventId:"e",sport:"basketball_nba",startsAt:null,homeTeam:"A",awayTeam:"B"};assert.equal(toResearchGroup(p,market,market.offers[0]).position,"C");});
