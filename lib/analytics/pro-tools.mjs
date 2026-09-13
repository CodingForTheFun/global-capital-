import {compareResearchQuotes} from '../ui/line-comparison.mjs';
import {targetKey, validProbabilities, timestamp} from '../ml/contract.mjs';

export const PRO_TOOLS_POLICY = Object.freeze({maxQuoteAgeMs:5*60_000,maxQuoteSkewMs:60_000});
const number = v => (typeof v==='number'||typeof v==='string')&&String(v).trim()!==''&&Number.isFinite(Number(v))?Number(v):null;
const EPS=1e-10;
export function decimalOdds(value){const n=number(value);return n===null||Math.abs(n)<100?null:n>0?1+n/100:1+100/-n;}
export function expectedReturn({win,loss,push,price}={}){
  const probabilities=[win,loss,push],decimal=decimalOdds(price);
  if(decimal===null||!probabilities.every(p=>typeof p==='number'&&Number.isFinite(p)&&p>=0&&p<=1)||Math.abs(win+loss+push-1)>1e-6)return null;
  return 100*(win*(decimal-1)-loss); // A refunded push has zero net return.
}

// Explicit full-game integer-stat domains; fantasy scores and unknown markets
// are intentionally unsupported. Yardage can be negative; event counts cannot.
const basketball=['player_points','player_rebounds','player_assists','player_threes','player_blocks','player_steals','player_turnovers','player_points_rebounds_assists','player_points_rebounds','player_points_assists','player_rebounds_assists','player_blocks_steals'];
const football=['player_pass_yds','player_pass_tds','player_pass_attempts','player_pass_completions','player_pass_interceptions','player_rush_yds','player_rush_attempts','player_rush_tds','player_reception_yds','player_receptions','player_reception_tds','player_pass_rush_yds','player_rush_reception_yds','player_sacks','player_sacks_taken','player_solo_tackles','player_tackles_assists','player_defensive_interceptions','player_field_goals','player_pats','player_kicking_points'];
const baseball=['batter_hits','batter_total_bases','batter_home_runs','batter_runs_scored','batter_runs','batter_rbis','batter_hits_runs_rbis','batter_strikeouts','batter_walks','pitcher_strikeouts','pitcher_hits_allowed','pitcher_earned_runs','pitcher_outs','pitcher_outs_recorded','pitcher_walks'];
const hockey=['player_shots_on_goal','player_goals','player_assists','player_points','player_total_saves','player_saves','player_goals_against','player_blocked_shots'];
const soccer=['player_shots','player_shots_on_target','player_goals','player_assists','player_passes_attempted','player_passes_completed'];
const markets={NBA:basketball,WNBA:basketball,NCAAB:basketball,NFL:football,NCAAF:football,MLB:baseball,NHL:hockey,MLS:soccer,EPL:soccer,UCL:soccer};
export function outcomeDomain(group){
  if((group.period||'game')!=='game'||group.entityType==='team'||!markets[group.sport]?.includes(group.marketId))return null;
  return {step:1,min:group.marketId.endsWith('_yds')?null:0};
}

function usableQuotes(group,now){
  if((group.period||'game')!=='game'||(group.entityType||'player')!=='player'||group.isAlternate||!Number.isFinite(now)||!group.playerId||!group.eventId||!group.marketId||group.live||group.archived||group.stale||timestamp(group.gameStartTime)<=now||!Number.isFinite(timestamp(group.gameStartTime)))return [];
  return compareResearchQuotes({...group,rows:group.comparisonOffers||group.rows},{now}).offers.filter(q=>q.fresh&&q.at!==null&&now-q.at<=PRO_TOOLS_POLICY.maxQuoteAgeMs&&decimalOdds(q.price)!==null&&Math.abs(q.line)<=1e6&&!q.live&&!q.started&&!q.completed
    && (!q.gameStartTime||timestamp(q.gameStartTime)===timestamp(group.gameStartTime))
    && !['prizepicks','underdog','underdogfantasy'].includes(q.bookKey.replace(/[^a-z]/g,'')) && !q.requiresParlay
    && (q.payoutType==null||q.payoutType==='straight'));
}

function evForQuote(group,quote,predictions,now){
  const target={...group,...quote,playerName:group.playerName,gameStartTime:group.gameStartTime};
  const key=targetKey(target),matches=predictions.filter(p=>key&&targetKey(p)===key);
  const unavailable=reason=>({available:false,quote,reason});
  if(matches.length!==1)return unavailable('An unambiguous forecast for this exact book and line is required.');
  const p=matches[0],generated=timestamp(p.generatedAt),expires=timestamp(p.expiresAt),start=timestamp(group.gameStartTime);
  if(p.available!==true||typeof p.projection!=='number'||!Number.isFinite(p.projection)||!validProbabilities(p)||!Number.isFinite(generated)||!Number.isFinite(expires)||generated>now||expires<=now||generated>=start||expires<=generated||expires>generated+30*60_000)
    return unavailable('The exact forecast is unavailable, expired, or malformed.');
  const method=p.validation?.method;
  if(!['chronological-heldout-real-lines','rolling-player-history'].includes(method)||!Number.isInteger(p.validation?.observations)||p.validation.observations<1)
    return unavailable('A trained forecast with a disclosed validation method is required.');
  if(method==='rolling-player-history'&&(p.sourceKind!=='verified-history-adaptive-model'||!Number.isInteger(p.validation.events)||p.validation.events!==p.validation.observations))return unavailable('Adaptive-model provenance is missing.');
  const validated=method==='chronological-heldout-real-lines'&&Boolean(p.modelId)&&p.validation.observations>=300&&Number.isInteger(p.validation.events)&&p.validation.events>=50
    && p.validation.events<=p.validation.observations&&typeof p.validation.brier==='number'&&p.validation.brier>=0&&p.validation.brier<.25
    && typeof p.validation.calibrationError==='number'&&p.validation.calibrationError>=0&&p.validation.calibrationError<=.075&&Number.isFinite(timestamp(p.validation.end))&&timestamp(p.validation.end)<generated;
  if(method==='chronological-heldout-real-lines'&&!validated)return unavailable('Calibrated forecast validation is incomplete.');
  const win=quote.side==='OVER'?p.probabilityOver:p.probabilityUnder,loss=quote.side==='OVER'?p.probabilityUnder:p.probabilityOver;
  const evPercent=expectedReturn({win,loss,push:p.probabilityPush,price:quote.price});
  return {available:true,quote,evPercent,win,loss,push:p.probabilityPush,qualifiesEVPlus:validated&&evPercent>EPS,
    evidence:validated?'calibrated-forecast':'adaptive-estimate',modelVersion:p.modelVersion||null,
    note:validated?'Model-based expected return, not a guaranteed profit.':'Exploratory model EV; adaptive probabilities have not passed the held-out real-line calibration gate for EV+.'};
}

const grade=(side,line,value)=>value===line?'push':(side==='OVER'?value>line:value<line)?'win':'loss';
function pairAnalysis(over,under,domain){
  const dOver=decimalOdds(over.price),dUnder=decimalOdds(under.price),impliedSum=1/dOver+1/dUnder;
  const weightOver=(1/dOver)/impliedSum,weightUnder=1-weightOver;
  const first=Math.max(Math.floor(over.line)+1,domain.min??-Infinity),last=Math.ceil(under.line)-1;
  const middle=first<=last?{minimum:first,maximum:last,outcomes:last-first+1}:null;
  const values=new Set();
  for(const line of [over.line,under.line])for(const v of [Math.floor(line)-1,Math.floor(line),Math.ceil(line),Math.ceil(line)+1])if(domain.min===null||v>=domain.min)values.add(v);
  if(domain.min!==null)values.add(domain.min);
  if(middle)values.add(first);
  const cases=new Map();
  for(const value of [...values].sort((a,b)=>a-b)){
    const overResult=grade('OVER',over.line,value),underResult=grade('UNDER',under.line,value);
    const payout=(result,weight,decimal)=>result==='win'?weight*decimal:result==='push'?weight:0;
    const net=payout(overResult,weightOver,dOver)+payout(underResult,weightUnder,dUnder)-1;
    const result={overResult,underResult,exampleOutcome:value,returnPercent:100*net};
    cases.set(overResult+'|'+underResult,result);
  }
  const scenarios=[...cases.values()],minimumReturnPercent=Math.min(...scenarios.map(s=>s.returnPercent));
  const maximumReturnPercent=Math.max(...scenarios.map(s=>s.returnPercent));
  const priceArbitrage=minimumReturnPercent>=-EPS&&maximumReturnPercent>EPS;
  return {over,under,weightOver,weightUnder,impliedSum,middle,scenarios,minimumReturnPercent,maximumReturnPercent,
    decidedReturnPercent:100*(1/impliedSum-1),priceArbitrage,possiblePush:scenarios.some(s=>s.overResult==='push'||s.underResult==='push'),
    classification:priceArbitrage?'arbitrage-candidate':middle?'middle-candidate':'no-edge',theoretical:true,executionVerified:false,
    assumptions:'Mathematical comparison only: both quotes must remain available and share stat definition, period, overtime, void and refund rules. Pushes refund stakes. Fees, stake limits and rounding are not included.'};
}

/** Read-only research. Does not place bets, poll providers or obtain predictions. */
export function proToolsAnalysis(group={}, {predictions=[],now=Date.now()}={}){
  const quotes=usableQuotes(group,now),domain=outcomeDomain(group),pairs=[];
  if(domain)for(const over of quotes.filter(q=>q.side==='OVER'))for(const under of quotes.filter(q=>q.side==='UNDER')){
    if(over.bookKey===under.bookKey||over.line>under.line||Math.abs(over.at-under.at)>PRO_TOOLS_POLICY.maxQuoteSkewMs)continue;
    const pair=pairAnalysis(over,under,domain);
    if(pair.priceArbitrage||pair.middle)pairs.push(pair);
  }
  pairs.sort((a,b)=>b.minimumReturnPercent-a.minimumReturnPercent||a.over.bookKey.localeCompare(b.over.bookKey)||a.under.bookKey.localeCompare(b.under.bookKey));
  const ev=quotes.map(q=>evForQuote(group,q,Array.isArray(predictions)?predictions:[],now));
  return {quotes,ev,evPlus:ev.filter(r=>r.available&&r.qualifiesEVPlus),arbitrage:pairs.filter(p=>p.priceArbitrage),middles:pairs.filter(p=>p.middle),
    domain,policy:PRO_TOOLS_POLICY,reason:quotes.length?'': 'Fresh pre-game offers with verified identity and valid odds are required.',
    domainReason:domain?'':'The outcome domain of this market is not supported for arbitrage or middles.'};
}
