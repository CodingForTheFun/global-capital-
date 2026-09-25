// Build leakage-safe training examples from verified completed prop histories.
// This is the first stage of the ensemble trainer: it never calls providers and
// never invents missing context. Callers supply normalized PropLine/SGO/stat
// observations already persisted by ObligeProps.

const finite=v=>typeof v==='number'&&Number.isFinite(v);
const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
const rate=(a,line)=>a.length?a.filter(v=>v>line).length/a.length:null;
const text=v=>String(v??'').trim();

export function buildTrainingRows(records=[]){
 const sorted=(Array.isArray(records)?records:[]).filter(r=>finite(Number(r?.actual))&&finite(Number(r?.line))&&Number.isFinite(Date.parse(r?.gameStartTime||'')))
  .map(r=>({...r,actual:Number(r.actual),line:Number(r.line),ts:Date.parse(r.gameStartTime)})).sort((a,b)=>a.ts-b.ts);
 const bySubject=new Map(),out=[];
 for(const r of sorted){
   const key=[text(r.sport).toUpperCase(),text(r.playerId||r.playerName).toLowerCase(),text(r.marketId||r.market).toLowerCase()].join('|');
   const prior=bySubject.get(key)||[];
   if(prior.length>=5){
     const vals=prior.map(x=>x.actual),opp=text(r.opponent).toUpperCase(),h2h=opp?prior.filter(x=>text(x.opponent).toUpperCase()===opp).map(x=>x.actual):[];
     const l5=vals.slice(-5),l10=vals.slice(-10),l20=vals.slice(-20);
     out.push({sport:text(r.sport).toUpperCase(),marketId:text(r.marketId||r.market),eventId:text(r.eventId||r.gameId),playerId:text(r.playerId||r.playerName),
       gameStartTime:new Date(r.ts).toISOString(),line:r.line,actual:r.actual,labelOver:r.actual>r.line?1:0,
       features:{l5Mean:mean(l5),l10Mean:mean(l10),l20Mean:mean(l20),seasonMean:mean(vals),l5OverRate:rate(l5,r.line),l10OverRate:rate(l10,r.line),l20OverRate:rate(l20,r.line),
         h2hMean:mean(h2h),h2hOverRate:rate(h2h,r.line),h2hGames:h2h.length,historyGames:vals.length,
         isHome:typeof r.isHome==='boolean'?(r.isHome?1:0):null,restDays:finite(r.restDays)?r.restDays:null,
         opponentDefenseRank:finite(r.opponentDefenseRank)?r.opponentDefenseRank:null,marketOverProbability:finite(r.marketOverProbability)?r.marketOverProbability:null},
       featureCutoff:new Date(prior[prior.length-1].ts).toISOString()});
   }
   prior.push(r);bySubject.set(key,prior);
 }
 return out;
}
