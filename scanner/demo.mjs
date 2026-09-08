import { evaluatePick, buildDiversifiedCard } from './criteria.mjs';

const base = [
  { id:'demo-1', player:'Jordan Vale', prop:'Points', line:18.5, sport:'WNBA', pick:'OVER', opponent:'PHX', matchId:'WNBA-DEMO-1', l5:100, l10:80, l15:80, h2h:80, expectedOutcome:'WIN', expectedOutcomeRate:83, avg:23.1, diff:4.6, regularLine:true, prizePicksConfirmed:true, isToday:true, sourceUrl:'https://www.pickfinder.app/props', filterAudit:[{label:'Opponent',value:'PHX',hitRate:80,required:true},{label:'Season',value:'Current',hitRate:81,required:true},{label:'Home/Away',value:'HOME',hitRate:86,required:true},{label:'Team',value:'Current',hitRate:80,required:true},{label:'Win/Loss',value:'WIN',hitRate:83,required:true},{label:'Days Rest',value:'1',hitRate:80,required:true}] },
  { id:'demo-2', player:'Mason Ito', prop:'Hits + Runs + RBI', line:1.5, sport:'MLB', pick:'OVER', opponent:'SEA', matchId:'MLB-DEMO-2', l5:80, l10:80, l15:80, h2h:75, expectedOutcome:'WIN', expectedOutcomeRate:80, avg:2.6, diff:1.1, regularLine:true, prizePicksConfirmed:true, isToday:true, sourceUrl:'https://www.pickfinder.app/props', filterAudit:[{label:'Opponent',value:'SEA',hitRate:75,required:true},{label:'Season',value:'Current',hitRate:80,required:true},{label:'Home/Away',value:'AWAY',hitRate:75,required:true},{label:'Team',value:'Current',hitRate:82,required:true},{label:'Win/Loss',value:'WIN',hitRate:80,required:true}] }
];

export function makeDemoScan() {
  const picks = base.map((p) => evaluatePick({ ...p, filterAudit: (p.filterAudit || []).map((row) => ({ ...row, verified: true, enforceFloor: true, floor: 75 })) }));
  return { mode:'demo', scannedAt:new Date().toISOString(), source:'Demo data — connect PickFinder credentials for live scans', totalReviewed:picks.length, qualifiedCount:picks.filter((p)=>p.qualified).length, rejectedCount:picks.filter((p)=>!p.qualified).length, picks, diversifiedCard:buildDiversifiedCard(picks,4), warnings:['Demo mode is active. No live PickFinder data was used.'] };
}
