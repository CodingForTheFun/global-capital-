// Champion/challenger gate for the continuously learning History Model.
//
// Retraining may happen forever; promotion must not. A candidate replaces the
// active model only when enough newly graded, chronological predictions show it
// is at least as well calibrated and materially better on projection error.
// This module is intentionally pure: schedulers can call it without giving the
// model permission to deploy itself.

const finite=v=>typeof v==='number'&&Number.isFinite(v);

export const CONTINUOUS_TRAINING_POLICY=Object.freeze({
  minGraded:50,
  minDistinctEvents:20,
  minImprovement:0.02,
  maxBrierRegression:0.005,
  maxCalibrationError:0.075,
});

export function candidateMetrics(rows=[]){
  const graded=(Array.isArray(rows)?rows:[]).filter(r=>finite(r?.actual)&&finite(r?.projection)&&finite(r?.probabilityOver)&&finite(r?.line)&&r.actual!==r.line);
  if(!graded.length)return {graded:0,events:0,mae:null,brier:null,calibrationError:null};
  let abs=0,brier=0;const bins=Array.from({length:10},()=>[]),events=new Set();
  for(const r of graded){const y=r.actual>r.line?1:0,p=r.probabilityOver;abs+=Math.abs(r.projection-r.actual);brier+=(p-y)**2;bins[Math.min(9,Math.floor(Math.max(0,Math.min(.999999,p))*10))].push({p,y});if(r.eventId)events.add(String(r.eventId));}
  const n=graded.length,ece=bins.reduce((sum,bin)=>sum+(bin.length?Math.abs(bin.reduce((s,r)=>s+r.p-r.y,0)):0),0)/n;
  return {graded:n,events:events.size,mae:abs/n,brier:brier/n,calibrationError:ece};
}

export function promotionDecision({championRows=[],challengerRows=[],policy=CONTINUOUS_TRAINING_POLICY}={}){
 const champion=candidateMetrics(championRows),challenger=candidateMetrics(challengerRows);
 const reasons=[];
 if(challenger.graded<policy.minGraded)reasons.push('INSUFFICIENT_GRADED');
 if(challenger.events<policy.minDistinctEvents)reasons.push('INSUFFICIENT_EVENTS');
 if(!finite(challenger.calibrationError)||challenger.calibrationError>policy.maxCalibrationError)reasons.push('CALIBRATION_FAILED');
 if(champion.graded>=policy.minGraded&&finite(champion.mae)&&finite(challenger.mae)){
   const improvement=(champion.mae-challenger.mae)/Math.max(champion.mae,1e-9);
   if(improvement<policy.minImprovement)reasons.push('NO_MATERIAL_MAE_GAIN');
   if(finite(champion.brier)&&challenger.brier>champion.brier+policy.maxBrierRegression)reasons.push('BRIER_REGRESSION');
 }
 return {promote:reasons.length===0,reasons,champion,challenger,policy};
}
