import {createHash} from 'node:crypto';
import {finite,timestamp,validProbabilities,validatedModel} from './contract.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
const implied=p=>p>0?100/(100+p):-p/(100-p);
const reference=v=>typeof v==='string'&&v.length>0&&v.length<=300;
/** Evaluate logged PRE-GAME forecasts against settled records; never fit on these rows. */
export function evaluateHeldout(input, {dataSha256,now=Date.now()}={}) {
  const m=input?.model,rows=input?.records;
  if(!m || !Array.isArray(rows) || rows.length>100000 || !rows.length)throw Error('Expected one model and a bounded held-out records array.');
  const seen=new Set(),events=new Map(),bins=Array.from({length:10},()=>[]);let brier=0,bookBrier=0,absoluteError=0;
  let start=Infinity,end=-Infinity;
  for(const r of rows){
    const kick=timestamp(r.gameStartTime),forecast=timestamp(r.forecastAt),settled=timestamp(r.settledAt),trained=timestamp(m.trainedThrough);
    if(![kick,forecast,settled,trained].every(Number.isFinite)||!(trained<forecast&&forecast<kick&&kick<settled&&settled<=now)||
        !reference(r.eventId)||!reference(r.playerId)||!reference(r.sourceOddsRecordId)||!reference(r.sourceStatsRecordId)||
        !Number.isInteger(r.actualValue)||!finite(r.projection)||!finite(r.line)||Math.abs(r.line%1)!==.5||
        !validProbabilities(r)||r.probabilityPush!==0||![r.overPrice,r.underPrice].every(p=>finite(p)&&Math.abs(p)>=100)||
        !Number.isFinite(timestamp(r.oddsObservedAt))||timestamp(r.oddsObservedAt)>forecast)throw Error('Invalid chronology, source references, half-line settlement, or probabilities in held-out evidence.');
    // One precommitted forecast per player/game in this one-market evaluation.
    const key=JSON.stringify([r.eventId,r.playerId]);if(seen.has(key))throw Error('Duplicate player/game in held-out evaluation.');seen.add(key);
    const y=r.actualValue>r.line?1:0,p=r.probabilityOver,bp=implied(r.overPrice)/(implied(r.overPrice)+implied(r.underPrice));
    const loss=(p-y)**2,bookLoss=(bp-y)**2;
    brier+=loss;bookBrier+=bookLoss;absoluteError+=Math.abs(r.projection-r.actualValue);
    bins[Math.min(9,Math.floor(p*10))].push({p,y});
    if(!events.has(r.eventId))events.set(r.eventId,[]);events.get(r.eventId).push(loss-bookLoss);
    start=Math.min(start,forecast);end=Math.max(end,settled);
  }
  const n=rows.length,ece=bins.reduce((sum,bin)=>sum+(bin.length?Math.abs(bin.reduce((s,r)=>s+r.p-r.y,0)):0),0)/n;
  // Cluster by event, not by line, so correlated players do not masquerade as independent games.
  const clusters=[...events.values()],boot=[];let seed=19790529;
  const random=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<1000;i++){let sum=0,count=0;for(let j=0;j<clusters.length;j++){const c=clusters[Math.floor(random()*clusters.length)];sum+=c.reduce((a,b)=>a+b,0);count+=c.length;}boot.push(sum/count);}
  boot.sort((a,b)=>a-b);
  const validation={method:'chronological-heldout-real-lines',dataSha256:dataSha256||hash(JSON.stringify(input)),observations:n,events:events.size,
    start:new Date(start).toISOString(),end:new Date(end).toISOString(),brier:brier/n,bookBrier:bookBrier/n,
    brierDeltaUpper95:boot[974],calibrationError:ece,meanAbsoluteError:absoluteError/n,passed:true};
  const out={...m,validation};validation.passed=validatedModel(out);
  return out;
}
