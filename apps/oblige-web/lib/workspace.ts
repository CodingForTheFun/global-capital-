import type { PropGroup, ResearchResponse, Side } from './types';
import { ApiError, getJson } from './api';
export type WorkspaceSport={key:string;title:string;active:boolean};
export type WorkspaceEvent={id:string;sport:string;startsAt:string|null;homeTeam:string|null;awayTeam:string|null;status:string|null;aliases:string[]};
export type WorkspaceOffer={key:string;outcomeId:string|null;book:string;bookName:string;line:number|null;choice:string;side:Side|null;price:number|null;multiplier:number|null;updatedAt:string|null;dfs:boolean;conflict:boolean;dfsOddsType?:string;lineGap?:number|null;liquidity?:number|null;liquidityUpdatedAt?:string|null;lastChangeAt?:string|null;bookOutcomeId?:string|null};
export type MarketReference={available:boolean;projection:number|null;evPercent:number|null;fairProbability:number|null;fairPrice:number|null;bookmaker:string|null;side?:Side|null;line?:number|null;price?:number|null;updatedAt?:string|null;booksContributing?:number|null;expiresAt?:string;basis:string};
export type WorkspaceMarket={key:string;marketKey:string;period:string|null;variant:string;label:string;offers:WorkspaceOffer[]};
export type WorkspacePlayer={key:string;playerId:string|null;name:string;aliases:string[];sport:string;eventId:string;startsAt:string|null;homeTeam:string|null;awayTeam:string|null;markets:WorkspaceMarket[]};
export type WorkspacePrediction={available:boolean;code?:string;message?:string;projection?:number;probabilityOver?:number;probabilityUnder?:number;probabilityPush?:number;modelVersion?:string;generatedAt?:string;expiresAt?:string;validation?:{method?:string;observations?:number;events?:number;brier?:number}};
export type EventWorkspace={ok:boolean;event:WorkspaceEvent;players:WorkspacePlayer[];fetchedAt:string};
export type WorkspaceHistory=ResearchResponse & {sourceStat?:string};
export class WorkspaceError extends Error { constructor(message:string,public status:number){super(message);this.name='WorkspaceError';} }
export async function workspaceGet<T>(action:string,params:Record<string,string>={},signal?:AbortSignal):Promise<T>{
 // Keep the existing 45s research allowance. A retry shares that total budget,
 // rather than cutting a healthy slow lookup short or doubling its deadline.
 try{
  const body=await getJson<T & {ok?:boolean;message?:string}>(`/api/oblige-workspace?${new URLSearchParams({action,...params})}`,signal,45000,45000);
  if(body.ok===false)throw new WorkspaceError(body.message||'This data could not be loaded.',200);
  return body as T;
 }catch(error){
  if(error instanceof ApiError){
   if(error.code==='ABORTED')throw new DOMException('Aborted','AbortError');
   throw new WorkspaceError(error.message,error.status);
  }
  throw error;
 }
}
export function booksFor(market:WorkspaceMarket){return [...new Map(market.offers.map(o=>[o.book,{key:o.book,name:o.bookName}])).values()].sort((a,b)=>a.name.localeCompare(b.name));}
export function chooseOffer(market:WorkspaceMarket,book:string|null,line:number|null,side:Side='OVER'){
 const inBook=market.offers.filter(o=>!book||o.book===book);
 const pool=inBook.length?inBook:market.offers;
 return pool.find(o=>o.line===line&&o.side===side)||pool.find(o=>o.line===line)||pool.find(o=>o.side===side)||pool[0]||null;
}
export function toResearchGroup(player:WorkspacePlayer,market:WorkspaceMarket,offer:WorkspaceOffer):PropGroup{
 if(offer.line===null)throw new Error('A numeric quoted line is required.');
 const quotes=market.offers.filter(o=>o.line===offer.line&&o.side).map(o=>({id:o.outcomeId||o.key,provider:'propline',providerEventId:player.eventId,proplineEventId:player.eventId,proplinePlayerId:player.playerId||undefined,proplineOutcomeId:o.outcomeId||undefined,period:market.period||undefined,conflict:o.conflict,dfs:o.dfs,dfsOddsType:o.dfsOddsType,payoutMultiplier:o.multiplier??undefined,eventId:player.eventId,playerName:player.name,providerPlayerId:player.playerId||undefined,market:market.label,marketId:market.marketKey,line:o.line??undefined,side:o.side||undefined,price:o.price??undefined,sportsbook:o.bookName,sportsbookKey:o.book,gameStartTime:player.startsAt||undefined,providerUpdatedAt:o.updatedAt||undefined}));
 const best=(side:Side)=>quotes.filter(q=>q.side===side&&typeof q.price==='number').sort((a,b)=>(b.price??-Infinity)-(a.price??-Infinity))[0]||null;
 return {key:JSON.stringify([player.key,market.key,offer.line]),propId:offer.outcomeId,player:player.name,providerPlayerId:player.playerId,market:market.label,marketId:market.marketKey,line:offer.line,sport:player.sport,team:null,opponent:null,homeTeam:player.homeTeam,awayTeam:player.awayTeam,matchup:[player.awayTeam,player.homeTeam].filter(Boolean).join(' @ ')||'Matchup unavailable',startsAt:player.startsAt,live:!!player.startsAt&&Date.parse(player.startsAt)<=Date.now(),quotes,bestOver:best('OVER'),bestUnder:best('UNDER')};
}
export function expectedValue(model:WorkspacePrediction|null,offer:WorkspaceOffer,now=Date.now()):number|null{
 if(!model?.available||model.code!=='READY'||!model.modelVersion||model.validation?.method!=='chronological-heldout-real-lines'||offer.dfs||offer.conflict||offer.price===null||offer.price===0||!offer.side||!model.expiresAt||Date.parse(model.expiresAt)<=now||!Number.isFinite(Date.parse(model.expiresAt)))return null;
 const p=[model.probabilityOver,model.probabilityUnder,model.probabilityPush];
 if(p.some(x=>typeof x!=='number'||!Number.isFinite(x)||x<0||x>1)||Math.abs((p[0]??0)+(p[1]??0)+(p[2]??0)-1)>1e-6)return null;
 const win=offer.side==='OVER'?p[0]!:p[1]!,loss=offer.side==='OVER'?p[1]!:p[0]!;
 const profit=offer.price>0?offer.price/100:100/Math.abs(offer.price);
 return (win*profit-loss)*100;
}
