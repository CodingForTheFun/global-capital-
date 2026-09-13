// Pure presentation calculations. No wagering, payment or remote state changes.
export type Side = 'OVER' | 'UNDER';
export type Selection = { id:string; eventId:string; label:string; matchup:string; market:string; price:number; sport:string };
export type Receipt = { id:string; at:string; selections:Selection[]; mode:'singles'|'parlay'; stake:number; potential:number };
export function decimalOdds(american:number):number {
  if (!Number.isFinite(american) || Math.abs(american)<100) throw new Error('Enter American odds of +100 or greater, or -100 or lower.');
  return american>0 ? 1+american/100 : 1+100/Math.abs(american);
}
export function americanOdds(decimal:number):number {
  if (!Number.isFinite(decimal) || decimal<=1) throw new Error('Decimal odds must be greater than one.');
  return Math.round(decimal>=2 ? (decimal-1)*100 : -100/(decimal-1));
}
export const formatOdds = (price:number) => `${price>0?'+':''}${price}`;
export function summarize(values:number[],line:number,side:Side) {
  const valid = values.filter(Number.isFinite);
  const results = valid.map(value => ({value,result:value===line?'push':(side==='OVER'?value>line:value<line)?'hit':'miss'}));
  const hits=results.filter(r=>r.result==='hit').length;
  const pushes=results.filter(r=>r.result==='push').length;
  const decisions=valid.length-pushes;
  return {results,hits,pushes,decisions,rate:decisions?Math.round(hits/decisions*100):null,average:valid.length?valid.reduce((a,b)=>a+b,0)/valid.length:null};
}
export function quote(selections:Selection[],stake:number,mode:'singles'|'parlay') {
  if (!selections.length) throw new Error('Add at least one sample selection.');
  if (!Number.isFinite(stake)||stake<=0||stake>10000) throw new Error('Enter a demo stake between 0.01 and 10,000.');
  if (mode==='parlay'&&new Set(selections.map(s=>s.eventId)).size!==selections.length) throw new Error('Same-game pricing is not connected. Switch to singles or choose different games.');
  const odds=selections.map(s=>decimalOdds(s.price));
  const totalStake=mode==='singles'?stake*selections.length:stake;
  const payout=mode==='singles'?odds.reduce((a,b)=>a+stake*b,0):stake*odds.reduce((a,b)=>a*b,1);
  if (!Number.isFinite(payout)) throw new Error('The demo calculation is out of range.');
  return {totalStake:Math.round(totalStake*100)/100,payout:Math.round(payout*100)/100,profit:Math.round((payout-totalStake)*100)/100};
}
