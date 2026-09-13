'use client';
import {useEffect,useState} from 'react';
import {createMLClient,predictionHtml,predictionKey,type MLTarget,type MLResult} from '../../../lib/ui/ml-prediction.mjs';
const client=createMLClient();
export default function MLPrediction({target,side='OVER'}:{target:MLTarget;side?:string}) {
  const key=predictionKey(target);
  const [entry,setEntry]=useState<{key:string|null;result:MLResult}|null>(null);
  useEffect(()=>{
    let alive=true;
    const tick=()=>{if(document.visibilityState==='hidden')return;client.lookup(target).then(result=>{if(alive)setEntry({key,result});});};
    tick();const timer=setInterval(tick,30000);
    return()=>{alive=false;clearInterval(timer);};
    // The complete serialized target defines this request; side only changes emphasis.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[key]);
  return <div className="mt-3 min-w-[210px] max-w-[320px]" dangerouslySetInnerHTML={{__html:predictionHtml(entry&&entry.key===key?entry.result:null,side)}}/>;
}
