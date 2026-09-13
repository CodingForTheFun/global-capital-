import {decimalOdds} from './pro-tools.mjs';
import {timestamp} from '../ml/contract.mjs';

export const WIN_MARKET_POLICY=Object.freeze({maxAgeMs:300_000,maxSkewMs:60_000,minimumBooks:2});
const text=v=>typeof v==='string'&&v.trim().length>0;
const scopes={
  'regulation|three-way':['HOME','DRAW','AWAY'],
  'regulation|two-way-push-on-draw':['HOME','AWAY'],
  'including-overtime|two-way-push-on-draw':['HOME','AWAY'],
  'including-overtime|two-way-no-draw':['HOME','AWAY'],
};
const identity=['sport','eventId','homeTeam','awayTeam','period','settlement'];
const unavailable=(code,message)=>({available:false,code,message,kind:'market-implied',modelPrediction:false,books:[],probabilities:null});

/**
 * Contract for verified, canonical moneyline evidence, not a provider fetch.
 * Callers must supply period and draw/settlement rules explicitly. A two-way
 * refunded draw yields conditional probabilities, never an inferred draw rate.
 */
export function analyzeWinMarket(target={},snapshots=[],{now=Date.now()}={}){
  if(!target||typeof target!=='object'||!identity.every(k=>text(target[k]))||target.homeTeam===target.awayTeam)
    return unavailable('EVENT_UNVERIFIED','Exact game identity and settlement rules are required.');
  const sides=scopes[target.period+'|'+target.settlement],start=timestamp(target.gameStartTime);
  if(!sides)return unavailable('SETTLEMENT_UNSUPPORTED','This period and settlement combination is not supported.');
  if(!Number.isFinite(now)||!Number.isFinite(start)||start<=now||target.live||target.stale||target.archived)
    return unavailable('PREMATCH_REQUIRED','Fresh evidence for an upcoming game is required.');
  const byBook=new Map();
  for(const q of Array.isArray(snapshots)?snapshots:[]){
    if(!q||!identity.every(k=>q[k]===target[k])||timestamp(q.gameStartTime)!==start||!text(q.sportsbookKey))continue;
    const key=q.sportsbookKey.trim().toLowerCase();
    if(!byBook.has(key))byBook.set(key,[]);
    byBook.get(key).push(q);
  }
  let books=[];
  for(const [key,rows] of byBook){
    // Unknown or future observation times cannot silently fall back to old odds.
    if(rows.some(q=>!Number.isFinite(timestamp(q.observedAt))||timestamp(q.observedAt)>now))continue;
    const at=Math.max(...rows.map(q=>timestamp(q.observedAt))),latest=rows.filter(q=>timestamp(q.observedAt)===at);
    if(now-at>WIN_MARKET_POLICY.maxAgeMs)continue;
    const normalized=latest.map(q=>{
      if(q.sourceKind!=='bookmaker-moneyline'||!text(q.source)||q.oddsFormat!=='american'||q.live||q.stale||q.suspended||q.isAlternate||q.requiresParlay
        ||!Array.isArray(q.outcomes)||q.outcomes.length!==sides.length)return null;
      const outcomes=sides.map(side=>q.outcomes.filter(o=>o?.side===side));
      if(outcomes.some(matches=>matches.length!==1))return null;
      const decimals=outcomes.map(([o])=>decimalOdds(o.price));
      if(decimals.some(d=>d===null))return null;
      const implied=decimals.map(d=>1/d),sum=implied.reduce((a,b)=>a+b,0);
      return {sportsbookKey:key,source:q.source,observedAt:new Date(at).toISOString(),
        prices:Object.fromEntries(sides.map((side,i)=>[side,Number(outcomes[i][0].price)])),
        probabilities:Object.fromEntries(sides.map((side,i)=>[side,implied[i]/sum])),overround:sum-1};
    });
    if(normalized.some(q=>q===null))continue;
    const signatures=new Set(normalized.map(q=>JSON.stringify([q.source,q.prices])));
    if(signatures.size!==1)continue;
    books.push(normalized[0]);
  }
  if(books.length){
    const newest=Math.max(...books.map(b=>timestamp(b.observedAt)));
    books=books.filter(b=>newest-timestamp(b.observedAt)<=WIN_MARKET_POLICY.maxSkewMs);
  }
  if(books.length<WIN_MARKET_POLICY.minimumBooks)
    return unavailable('MONEYLINE_EVIDENCE_UNAVAILABLE','At least two fresh, complete sportsbook moneylines with matching settlement rules are required.');
  books.sort((a,b)=>a.sportsbookKey.localeCompare(b.sportsbookKey));
  const probabilities=Object.fromEntries(sides.map(side=>[side,books.reduce((sum,b)=>sum+b.probabilities[side],0)/books.length]));
  return {available:true,kind:'market-implied',modelPrediction:false,probabilities,books,
    conditionalOnNoDraw:target.settlement==='two-way-push-on-draw',period:target.period,settlement:target.settlement,
    method:'Within each book, divide each implied probability by the sum for all outcomes; then average the complete book probability vectors equally.',
    note:'Market-implied estimates, not a trained prediction or a measured accuracy claim. Books can share information and are not independent forecasts.',
    drawNote:target.settlement==='two-way-push-on-draw'?'Home and away probabilities are conditional on a non-draw result. The probability of a draw is unavailable.':null};
}
