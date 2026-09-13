import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {researchPlayerProp} from '../autoscout/research-service-v2.mjs';
import {predictionTarget,timestamp} from './contract.mjs';

const MODEL_FILE = path.resolve('data/ml/research/nfl-ridge-v1.json');
const STAT_KEYS = Object.freeze({attempts:'passingAttempts',completions:'passingCompletions',passing_tds:'passingTouchdowns',receptions:'receptions'});
let modelPromise;
async function loadModels(){
  modelPromise ||= readFile(MODEL_FILE,'utf8').then(JSON.parse).then(pack=>{
    if(pack?.version!==1||pack?.engine!=='Auto Scout ML'||pack?.sport!=='NFL'||!Array.isArray(pack.models))throw Error('bad research model pack');
    return new Map(pack.models.map(model=>[model.marketId,model]));
  });
  return modelPromise;
}
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const mean=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
function sampleStd(values){if(values.length<3)return null;const m=mean(values);return Math.sqrt(values.reduce((s,v)=>s+(v-m)**2,0)/(values.length-1));}
function cleanValues(logs,key){return logs.map(row=>Number(row?.[key])).filter(Number.isFinite);}
function sourceKey(feature){const match=feature.match(/^(attempts|completions|passing_tds|receptions)_(?:lag\d+|mean\d+|std\d+)$/);return match?STAT_KEYS[match[1]]:null;}
export function buildResearchFeatures(model,logs,target){
  const ordered=logs.filter(row=>Number.isFinite(Date.parse(row?.date))).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,40);
  const latest=ordered[0],gameAt=timestamp(target.gameStartTime),lastAt=Date.parse(latest?.date||'');
  const out={priorGames:Math.min(40,ordered.length),restDays:Number.isFinite(gameAt)&&Number.isFinite(lastAt)?(gameAt-lastAt)/86400000:null};
  for(const name of model.features){
    if(name in out)continue;
    const key=sourceKey(name);if(!key){out[name]=null;continue;}
    const values=cleanValues(ordered,key);
    const lag=name.match(/_lag(\d+)$/);if(lag){out[name]=values[Number(lag[1])-1]??null;continue;}
    const avg=name.match(/_mean(\d+)$/);if(avg){const slice=values.slice(0,Number(avg[1]));out[name]=slice.length>=3?mean(slice):null;continue;}
    const std=name.match(/_std(\d+)$/);if(std){out[name]=sampleStd(values.slice(0,Number(std[1])));continue;}
    out[name]=null;
  }
  return out;
}
export function scoreResearchModel(model,featureMap){
  let value=model.intercept;
  for(let i=0;i<model.features.length;i++){
    let x=featureMap[model.features[i]];if(!finite(x))x=model.imputerMedian[i];
    value+=model.coef[i]*((x-model.mean[i])/(model.scale[i]||1));
  }
  return Math.max(0,value);
}
export function residualCdf(quantiles,x){
  if(!Array.isArray(quantiles)||quantiles.length<2)return null;
  if(x<=quantiles[0])return 0;const last=quantiles.length-1;if(x>=quantiles[last])return 1;
  for(let i=1;i<=last;i++)if(x<=quantiles[i]){const lo=quantiles[i-1],hi=quantiles[i],fraction=hi===lo?0.5:(x-lo)/(hi-lo);return ((i-1)+fraction)/last;}
  return 1;
}
function unavailable(code,message){return {available:false,modelled:true,engine:'Auto Scout ML',code,message};}

export function createResearchProjectionStore({clock=Date.now}={}){
  const cache=new Map(),inflight=new Map();
  return {async lookup(input){
    const target=predictionTarget(input);if(!target)return unavailable('TARGET_UNVERIFIED','The player, game or line could not be verified.');
    if(target.sport!=='NFL')return unavailable('SPORT_NOT_SUPPORTED','This trained Auto Scout model is not available for this sport yet.');
    if(target.entityType!=='player'||target.isAlternate)return unavailable('MARKET_NOT_SUPPORTED','This model only evaluates verified main-line player props.');
    if(target.live||timestamp(target.gameStartTime)<=clock())return unavailable('PREMATCH_ONLY','This model is pregame only.');
    const models=await loadModels(),model=models.get(target.marketId);
    if(!model)return unavailable('MARKET_NOT_SUPPORTED','No trained Auto Scout model is available for this NFL prop type yet.');
    const key=JSON.stringify([target.sport,target.playerId,target.playerName,target.marketId,target.gameStartTime,target.line]);
    const hit=cache.get(key);if(hit&&hit.expires>clock())return hit.value;if(inflight.has(key))return inflight.get(key);
    const pending=(async()=>{
      const history=await researchPlayerProp({sport:'NFL',playerName:target.playerName,providerMarketKey:target.marketId,market:target.marketId,line:target.line,side:'OVER',games:40});
      if(!history?.available||!Array.isArray(history.gameLog)||history.gameLog.length<5)return unavailable('INSUFFICIENT_HISTORY','At least five verified prior game logs are required for this model.');
      const fmap=buildResearchFeatures(model,history.gameLog,target),projection=scoreResearchModel(model,fmap),cdf=residualCdf(model.validation?.residualQuantiles,target.line-projection);
      if(!finite(projection)||!finite(cdf))return unavailable('MODEL_FEED_UNAVAILABLE','The model could not produce a verified estimate for this prop.');
      const probabilityUnder=Math.min(1,Math.max(0,cdf)),probabilityOver=1-probabilityUnder,generated=new Date(clock()).toISOString();
      const expiresAt=new Date(Math.min(clock()+15*60_000,timestamp(target.gameStartTime)-1000)).toISOString();
      const value={...target,available:true,modelled:true,engine:'Auto Scout ML',code:'READY',modelVersion:model.id,projection,
        probabilityOver,probabilityUnder,probabilityPush:0,generatedAt:generated,expiresAt,
        validation:{observations:model.validation.observations,events:model.validation.events,rmse:model.validation.rmse,baselineRmse:model.validation.baselineRmse,method:model.validation.method},
        message:'Experimental model estimate from verified prior game logs. Not a guaranteed outcome.'};
      cache.set(key,{value,expires:Math.min(clock()+15*60_000,timestamp(target.gameStartTime)-1000)});while(cache.size>1000)cache.delete(cache.keys().next().value);return value;
    })().catch(()=>unavailable('MODEL_FEED_UNAVAILABLE','The model estimate is temporarily unavailable. Historical research is unchanged.')).finally(()=>inflight.delete(key));
    inflight.set(key,pending);return pending;
  }};
}
