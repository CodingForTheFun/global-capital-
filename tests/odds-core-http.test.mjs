import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
test('real core HTTP handler streams last-good large board through provider 429 without restart',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'odds-http-'));
 const socket=http.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const child=spawn(process.execPath,['--import','./tests/mock-odds-core.mjs','apex-v2/server-core.mjs'],{cwd:process.cwd(),env:{PATH:process.env.PATH,DATA_DIR:temp,PORT:String(port),THE_ODDS_API_REQUEST_SPACING_MS:'100'},stdio:['ignore','pipe','pipe']});
 let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 try{
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error(log)),10000);const poll=setInterval(()=>{if(log.includes('AUTOSCOUT_APEX_CORE listening')){clearTimeout(timeout);clearInterval(poll);resolve();}else if(child.exitCode!==null){clearTimeout(timeout);clearInterval(poll);reject(new Error(log));}},20);});
  const root=`http://127.0.0.1:${port}`;
  const responses=await Promise.all(Array.from({length:10},()=>fetch(root+'/api/props?sport=NFL').then(async r=>({status:r.status,body:await r.json()}))));
  assert.ok(responses.every(r=>r.status===200&&r.body.props.length===2&&r.body.meta.stale));
  const response=await fetch(root+'/api/props?sport=MLB');assert.equal(response.status,200);
  const big=await response.json();assert.equal(big.props.length,23000);assert.equal(big.props[22999].price,-105);
  const cold=await fetch(root+'/api/props?sport=WNBA');assert.equal(cold.status,503);assert.equal((await cold.json()).code,'PROVIDER_COOLDOWN');
  const health=await fetch(root+'/api/health').then(r=>r.json());assert.equal(health.ok,true);assert.equal(child.exitCode,null);
  assert.equal(health.provider.requestControl.circuit,'OPEN');assert.equal(health.provider.requestControl.active,0);
  // Two initial fixture boards cost six calls; the failed refresh costs one.
  assert.equal(health.provider.requestControl.launches,7);
 }finally{child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));await fs.rm(temp,{recursive:true,force:true});}
});
