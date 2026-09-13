// Auto Scout intelligence primitives. Pure functions only: no provider calls, no fabricated data.
const n=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const ts=v=>{const x=Date.parse(v||'');return Number.isFinite(x)?x:null;};

export function lineSensitivity(games, activeLine, side='OVER', steps=[-2,-1,0,1,2]){
  const base=n(activeLine); if(base===null)return [];
  const values=(games||[]).map(g=>n(g.value??g.statValue??g.stat)).filter(v=>v!==null);
  if(!values.length)return [];
  return steps.map(step=>{
    const line=base+step;
    let hits=0,pushes=0;
    for(const v of values){if(v===line)pushes++;else if(side==='UNDER'?v<line:v>line)hits++;}
    return {line,side,games:values.length,hits,pushes,misses:values.length-hits-pushes,hitRate:100*hits/values.length};
  });
}

export function sportsbookDisagreement(rows){
  const lines=(rows||[]).map(r=>({book:r.sportsbookKey||r.sportsbook||'Unknown',line:n(r.line),updatedAt:r.providerUpdatedAt||r.updatedAt||null})).filter(r=>r.line!==null);
  if(!lines.length)return {available:false,books:0};
  const vals=lines.map(x=>x.line),min=Math.min(...vals),max=Math.max(...vals),avg=vals.reduce((a,b)=>a+b,0)/vals.length;
  return {available:true,books:new Set(lines.map(x=>x.book)).size,min,max,spread:max-min,average:avg,lines};
}

export function dataQuality({games=[],updatedAt=null,identityConfidence=null,opponentGames=0,lineBooks=0,lineupKnown=null}={}){
  const sample=(games||[]).filter(g=>n(g.value??g.statValue??g.stat)!==null).length;
  const age=ts(updatedAt)==null?null:Math.max(0,Date.now()-ts(updatedAt));
  const freshness=age===null?0:age<=30*60e3?25:age<=3*3600e3?20:age<=24*3600e3?12:5;
  const identity=identityConfidence===null?10:25*clamp(n(identityConfidence)??0,0,1);
  const history=25*clamp(sample/15,0,1);
  const context=15*clamp((Number(opponentGames||0)/5)+(lineupKnown===true?.35:0),0,1);
  const market=10*clamp(Number(lineBooks||0)/5,0,1);
  const score=Math.round(identity+history+freshness+context+market);
  return {score,label:score>=80?'HIGH':score>=55?'MEDIUM':'LOW',sample,freshnessKnown:age!==null,reasons:{identity:Math.round(identity),history:Math.round(history),freshness,context:Math.round(context),market:Math.round(market)}};
}

export function intelligenceTimeline({lineHistory=[],injuries=[],lineups=[],projections=[],gameEvents=[]}={}){
  const add=(kind,rows,label,value)=> (rows||[]).map(x=>({kind,at:x.at||x.updatedAt||x.providerUpdatedAt||x.timestamp||x.date||null,label:typeof label==='function'?label(x):label,value:typeof value==='function'?value(x):value,raw:x}));
  return [
    ...add('LINE',lineHistory,x=>`${x.sportsbookKey||x.sportsbook||'Market'} line`,x=>({line:n(x.line),price:n(x.price)})),
    ...add('INJURY',injuries,x=>x.status||'Injury update',x=>x.detail||x.description||null),
    ...add('LINEUP',lineups,x=>x.status||'Lineup update',x=>x.role||x.position||null),
    ...add('PROJECTION',projections,'Projection update',x=>n(x.projection??x.value)),
    ...add('GAME',gameEvents,x=>x.label||x.type||'Game update',x=>x.value??null),
  ].filter(x=>ts(x.at)!==null).sort((a,b)=>ts(b.at)-ts(a.at));
}

export function scenarioLab({baselineProjection,baselineMinutes=null,targetMinutes=null,usageMultiplier=1,roleMultiplier=1}={}){
  const projection=n(baselineProjection); if(projection===null)return {available:false};
  const b=n(baselineMinutes),t=n(targetMinutes);
  const minuteFactor=b&&t?clamp(t/b,.25,2):1;
  const usage=clamp(n(usageMultiplier)??1,.25,2),role=clamp(n(roleMultiplier)??1,.25,2);
  const adjusted=projection*minuteFactor*usage*role;
  return {available:true,baseline:projection,adjusted,delta:adjusted-projection,inputs:{baselineMinutes:b,targetMinutes:t,minuteFactor,usageMultiplier:usage,roleMultiplier:role},model:'transparent multiplicative scenario; not a prediction guarantee'};
}

export function dependencyGraph(samples=[]){
  const by=new Map();
  for(const s of samples||[]){const teammate=s.teammate||s.name;if(!teammate)continue;const value=n(s.value);if(value===null)continue;const key=String(teammate);if(!by.has(key))by.set(key,{with:[],without:[]});by.get(key)[s.withTeammate===false?'without':'with'].push(value);}
  const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
  return [...by].map(([teammate,x])=>{const withAvg=avg(x.with),withoutAvg=avg(x.without);return {teammate,withGames:x.with.length,withoutGames:x.without.length,withAvg,withoutAvg,delta:withAvg!==null&&withoutAvg!==null?withoutAvg-withAvg:null,smallSample:x.with.length<5||x.without.length<5};}).filter(x=>x.withGames&&x.withoutGames).sort((a,b)=>Math.abs(b.delta||0)-Math.abs(a.delta||0));
}

export function changeRadar(items=[]){
  return (items||[]).map(x=>{
    const from=n(x.previousLine),to=n(x.currentLine),proj=n(x.projection),books=Number(x.booksMoved||x.books||0),minutes=Number(x.minutesAgo||0);
    const move=from!==null&&to!==null?to-from:null;
    const magnitude=move===null?0:Math.abs(move);
    const freshness=minutes<=30?1:minutes<=120?.6:.25;
    const score=magnitude*20+Math.min(books,10)*3+(proj!==null&&to!==null?Math.min(Math.abs(proj-to),10)*2:0)+freshness*10;
    return {...x,move,radarScore:Math.round(score*10)/10};
  }).filter(x=>x.move!==null||n(x.projection)!==null).sort((a,b)=>b.radarScore-a.radarScore);
}

export function researchBrief({player,market,line,side='OVER',analysis=null,quality=null,disagreement=null,timeline=[]}={}){
  const evidence=[];
  if(analysis){for(const key of ['l5','l10','l15','l20','season','h2h']){const x=analysis[key];if(x&&n(x.hitRate)!==null)evidence.push(`${key.toUpperCase()}: ${Math.round(n(x.hitRate))}% (${x.games??x.sampleSize??'?'}g)`);}}
  if(disagreement?.available)evidence.push(`Book line range ${disagreement.min}–${disagreement.max} across ${disagreement.books} books`);
  if(quality)evidence.push(`Data quality ${quality.label} (${quality.score}/100)`);
  return {title:`${player||'Player'} · ${market||'Prop'} ${line??'—'} ${side}`,summary:evidence.length?evidence.join(' · '):'Insufficient verified evidence for an automated brief.',evidence,recentChanges:(timeline||[]).slice(0,5).map(x=>({kind:x.kind,at:x.at,label:x.label,value:x.value})),disclaimer:'Research summary only. Correlated events are not claimed as causes, and missing evidence is not inferred.'};
}
