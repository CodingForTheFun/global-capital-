import { runPublicIngestionCycle, publicWorkerConfigured } from './public-worker.mjs';
import { startEspnHistoryWorker, espnHistoryHealth } from './espn-history-worker.mjs';
const int=(v,d,min,max)=>{const n=Number.parseInt(String(v??''),10);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):d;};
let timer=null,running=false,lastAt=null,lastError=null,lastResult=null;
export function zeroCreditConfig(){return {enabled:String(process.env.AUTOSCOUT_ZERO_CREDIT_ENABLED||'true').toLowerCase()!=='false',pollMinutes:int(process.env.AUTOSCOUT_ZERO_CREDIT_POLL_MINUTES,3,2,4)};}
export async function runZeroCreditCycle(){if(running||!zeroCreditConfig().enabled||!publicWorkerConfigured())return {skipped:true};running=true;try{lastResult=await runPublicIngestionCycle();lastAt=new Date().toISOString();lastError=null;return lastResult;}catch(e){lastError=String(e?.code||e?.message||'ZERO_CREDIT_INGEST_FAILED').slice(0,120);return {error:lastError};}finally{running=false;}}
export function startZeroCreditWorker(){const c=zeroCreditConfig();startEspnHistoryWorker();if(timer||!c.enabled||!publicWorkerConfigured())return timer;timer=setInterval(()=>void runZeroCreditCycle(),c.pollMinutes*60_000);timer.unref?.();const boot=setTimeout(()=>void runZeroCreditCycle(),10_000);boot.unref?.();return timer;}
export function zeroCreditHealth(){return {configured:publicWorkerConfigured(),...zeroCreditConfig(),running,lastAt,lastError,lastResult,history:espnHistoryHealth()};}
