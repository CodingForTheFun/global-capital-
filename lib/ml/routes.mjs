import {createMLStore} from './snapshot-store.mjs';
import {researchPlayerProp} from '../autoscout/research-service-v2.mjs';
// Production explicitly opts into the adaptive verified-history fallback. Direct
// createMLStore callers retain the original snapshot-only semantics.
const defaultStore = createMLStore({research:researchPlayerProp});
export const ML_BATCH_MAX = 24;
const send=(res,status,body,headers={})=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers});res.end(JSON.stringify(body));};
/** Called after the existing /api/props/ account gate, never before it. */
export function createMLHandler({store=defaultStore,clock=Date.now}={}) {
  const rates = new Map();
  return async function handleML(req,res) {
    if (new URL(req.url || '/','http://localhost').pathname !== '/api/props/ml') return false;
    if (req.method !== 'POST') {send(res,405,{ok:false,code:'METHOD_NOT_ALLOWED'},{allow:'POST'});return true;}
    const ip=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].slice(0,80),now=clock();
    for(const [key,row] of rates)if(now-row.time>=60_000)rates.delete(key);
    const limit=rates.get(ip)||{time:now,count:0};limit.count++;rates.set(ip,limit);
    if(limit.count>90||rates.size>4000){send(res,429,{ok:false,code:'RATE_LIMITED'},{'retry-after':'60'});return true;}
    let size=0,parts=[];
    try {
      for await(const chunk of req){size+=chunk.length;if(size>64000){send(res,413,{ok:false,code:'REQUEST_TOO_LARGE'});return true;}parts.push(chunk);}
      const body=JSON.parse(Buffer.concat(parts).toString('utf8'));
      if(!Array.isArray(body.props)||!body.props.length||body.props.length>ML_BATCH_MAX||
        body.props.some(p=>!p||typeof p.key!=='string'||p.key.length>24||!p.key.length||['__proto__','constructor','prototype'].includes(p.key))||
        new Set(body.props.map(p=>p.key)).size!==body.props.length){send(res,400,{ok:false,code:'INVALID_ML_BATCH'});return true;}
      const results=Object.create(null);
      await Promise.all(body.props.map(async p=>{results[p.key]=await store.lookup(p);}));
      send(res,200,{ok:true,results});
    }catch{send(res,400,{ok:false,code:'INVALID_ML_BATCH'});}
    return true;
  };
}
