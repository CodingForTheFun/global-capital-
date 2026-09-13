import {once} from 'node:events';
import {sanitizePublicPayload} from '../public-sanitize.mjs';

// Same sanitizer and JSON shape, bounded transient memory. Large board arrays
// are transformed one row at a time instead of cloning the entire payload.
export function* publicJsonChunks(value) {
  if(Array.isArray(value)){
    yield '[';
    for(let i=0;i<value.length;i++){if(i)yield ',';yield JSON.stringify(sanitizePublicPayload(value[i]))??'null';}
    yield ']';return;
  }
  if(value&&typeof value==='object'){
    yield '{';let first=true;
    for(const [key,raw] of Object.entries(value)){
      if(raw===undefined||!Object.hasOwn(sanitizePublicPayload({[key]:null}),key))continue;
      if(!first)yield ',';first=false;yield JSON.stringify(key)+':';
      if(raw&&typeof raw==='object')yield* publicJsonChunks(raw);
      else yield JSON.stringify(sanitizePublicPayload({[key]:raw})[key])??'null';
    }
    yield '}';return;
  }
  yield JSON.stringify(sanitizePublicPayload(value))??'null';
}
export async function writePublicBoard(res,body) {
  res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store, max-age=0',
    'x-content-type-options':'nosniff','x-autoscout-public-json':'1'});
  let buffer='';
  const flush=async()=>{
    if(res.destroyed)throw Object.assign(new Error('Client closed.'),{code:'CLIENT_CLOSED'});
    if(!res.write(buffer)){
      const controller=new AbortController();
      const close=()=>controller.abort();res.once('close',close);
      try{await once(res,'drain',{signal:controller.signal});}finally{res.off('close',close);}
    }
    buffer='';
  };
  for(const chunk of publicJsonChunks(body)){buffer+=chunk;if(buffer.length>=65536)await flush();}
  if(buffer)await flush();res.end();
}
