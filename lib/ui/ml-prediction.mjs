/** Browser-only ML presentation/client. Does not import or invoke paid LLM projections. */
import {targetKey,timestamp,unavailable,finite,validProbabilities} from '../ml/contract.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const predictionKey=targetKey;
export function currentPrediction(value,now=Date.now()) {
  if(value?.available && (!targetKey(value)||!finite(value.projection)||!validProbabilities(value)||!Number.isFinite(timestamp(value.expiresAt))||!Number.isFinite(timestamp(value.generatedAt))||!Number.isInteger(value.validation?.observations)||!Number.isInteger(value.validation?.events))) return unavailable('MODEL_FEED_UNAVAILABLE');
  if(value?.available && (timestamp(value.expiresAt)<=now || timestamp(value.gameStartTime)<=now)) return unavailable('PREDICTION_EXPIRED');
  return value;
}
function validationCopy(p){
  const v=p?.validation||{};
  if(v.method==='rolling-player-history') {
    const comparison=finite(v.rmse)&&finite(v.baselineRmse)?' · RMSE '+v.rmse.toFixed(2)+' vs recent-mean '+v.baselineRmse.toFixed(2):'';
    return 'Time-ordered rolling check: '+v.observations+' prior games'+comparison+'. The model is re-fit from that player’s verified history; this is not a league-wide held-out accuracy claim.';
  }
  return 'Held-out evaluation: '+v.observations+' records across '+v.events+' games. Not a guarantee of future performance.';
}
export function predictionHtml(value,side='OVER') {
  const p=currentPrediction(value);
  if(!p)return '<section class="asML" data-ml-state="loading" aria-label="Machine learning prediction" aria-busy="true"><div class="asMLHeading">ML prediction <small>Checking model status…</small></div></section>';
  if(!p.available)return '<section class="asML" data-ml-state="'+esc(p.code)+'" aria-label="Machine learning prediction"><div class="asMLHeading">ML prediction <small>Not available</small></div><p>'+esc(p.message)+'</p></section>';
  const prob=v=>(100*v).toFixed(1)+'%',lean=p.probabilityOver===p.probabilityUnder?'No lean':p.probabilityOver>p.probabilityUnder?'OVER':'UNDER';
  return '<section class="asML asMLReady" data-ml-state="READY" aria-label="Machine learning prediction"><div class="asMLHeading">ML prediction <small>'+esc(p.engine)+' · Model estimate</small></div>'
    +'<div class="asMLGrid"><div><small>Projected stat</small><b>'+esc(p.projection.toFixed(1))+'</b></div><div class="'+(side==='OVER'?'asMLSelected':'')+'"><small>Over '+esc(p.line)+'</small><b>'+prob(p.probabilityOver)+'</b></div><div class="'+(side==='UNDER'?'asMLSelected':'')+'"><small>Under '+esc(p.line)+'</small><b>'+prob(p.probabilityUnder)+'</b></div></div>'
    +'<p class="asMLMeta">Model lean: '+lean+(p.probabilityPush>0?' · Push: '+prob(p.probabilityPush):'')+' · '+esc(p.sportsbookKey)+'</p>'
    +'<details><summary>Model details</summary><p>Version: '+esc(p.modelVersion)+' · Generated: '+esc(new Date(p.generatedAt).toLocaleString())+'</p><p>'+esc(validationCopy(p))+'</p></details>'
    +'<p class="asMLFoot">Estimated probabilities — separate from historical hit rates. No wager is placed.</p></section>';
}

/** Coalesces mounted/visible props into at most 24 lookups per request. */
export function createMLClient({fetcher=(...args)=>globalThis.fetch(...args),clock=Date.now}={}) {
  const cache=new Map(),pending=new Map();let queue=[],running=false,scheduled=false;
  function peek(input){const key=targetKey(input),c=cache.get(key);return c&&c.until>clock()?currentPrediction(c.value,clock()):null;}
  async function flush(){
    scheduled=false;if(running)return;running=true;
    while(queue.length){
      const batch=queue.splice(0,24),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);let body;
      try{const r=await fetcher('/api/props/ml',{method:'POST',credentials:'same-origin',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({props:batch.map((job,i)=>({...job.input,key:String(i)}))})});
        if(r.status===401)body={auth:true};else{if(!r.ok)throw Error('http');body=await r.json();if(!body.ok||!body.results)throw Error('shape');}
      }catch{body=null;}finally{clearTimeout(timer);}
      batch.forEach((job,i)=>{
        let value=body?.auth?unavailable('AUTH_REQUIRED'):body?.results?.[String(i)]||unavailable('MODEL_FEED_UNAVAILABLE');
        if(value.available && targetKey(value)!==job.key)value=unavailable('TARGET_UNVERIFIED');
        value=currentPrediction(value,clock());
        const until=Math.min(clock()+(value.available?30_000:15_000),value.available?timestamp(value.expiresAt):Infinity);
        cache.set(job.key,{value,until});pending.delete(job.key);job.resolve(value);
      });
      while(cache.size>500)cache.delete(cache.keys().next().value);
    }
    running=false;
  }
  function lookup(input){
    const key=targetKey(input);if(!key)return Promise.resolve(unavailable('TARGET_UNVERIFIED'));
    const hit=peek(input);if(hit)return Promise.resolve(hit);if(pending.has(key))return pending.get(key);
    const promise=new Promise(resolve=>queue.push({key,input,resolve}));pending.set(key,promise);
    if(!scheduled&&!running){scheduled=true;queueMicrotask(flush);}return promise;
  }
  return {lookup,peek};
}
