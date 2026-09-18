import test from 'node:test';
import assert from 'node:assert/strict';
import {createEdgeGateway} from '../lib/edge/gateway.mjs';

const CANONICAL='https://www.obligeprops.com';

function call(host,{url='/',method='GET'}={}){
 const headers={};
 const res={statusCode:null,headers:null,ended:false,
  writeHead(status,value){this.statusCode=status;this.headers=value;return this;},
  end(){this.ended=true;return this;}};
 const req={method,url,headers:{host},socket:{remoteAddress:'127.0.0.1'}};
 return {req,res,headers};
}

async function run(host,options){
 const previous=process.env.PUBLIC_SITE_ORIGIN;
 process.env.PUBLIC_SITE_ORIGIN=options?.origin??CANONICAL;
 try{
  const gateway=createEdgeGateway({});
  const {req,res}=call(host,options);
  const handled=await gateway(req,res);
  return {handled,res};
 } finally {
  if(previous===undefined) delete process.env.PUBLIC_SITE_ORIGIN; else process.env.PUBLIC_SITE_ORIGIN=previous;
 }
}

test('the retired brand domain is redirected to the canonical origin',async()=>{
 const {handled,res}=await run('www.obligepay.com');
 assert.equal(handled,true);
 assert.equal(res.statusCode,301);
 assert.equal(res.headers.location,`${CANONICAL}/`);
});

test('the bare domain is redirected to www rather than serving a second copy',async()=>{
 const {handled,res}=await run('obligeprops.com');
 assert.equal(handled,true);
 assert.equal(res.statusCode,301);
 assert.equal(res.headers.location,`${CANONICAL}/`);
});

test('path and query survive the redirect',async()=>{
 const {res}=await run('www.obligepay.com',{url:'/apex?sport=NFL&line=24.5'});
 assert.equal(res.headers.location,`${CANONICAL}/apex?sport=NFL&line=24.5`);
});

test('a port in the Host header does not defeat the match',async()=>{
 const {handled,res}=await run('www.obligepay.com:443');
 assert.equal(handled,true);
 assert.equal(res.statusCode,301);
});

test('non-GET keeps its method and body by redirecting with 308, never 301',async()=>{
 for(const method of ['POST','PUT','PATCH','DELETE']){
  const {res}=await run('www.obligepay.com',{url:'/api/account/login',method});
  assert.equal(res.statusCode,308,`${method} must not be downgraded to GET`);
 }
});

test('the canonical host itself is never redirected',async()=>{
 const {handled}=await run('www.obligeprops.com');
 assert.notEqual(handled,true);
});

test('Railway hostnames are never redirected, so healthchecks and smoke tests keep working',async()=>{
 for(const host of ['autoprop-live-production.up.railway.app','autoprop-live-production-5a2d.up.railway.app']){
  const {handled}=await run(host,{url:'/api/health'});
  assert.notEqual(handled,true,`${host} must answer directly`);
 }
});

test('a retired host that is also the canonical origin is served, not looped',async()=>{
 const {handled}=await run('www.obligepay.com',{origin:'https://www.obligepay.com'});
 assert.notEqual(handled,true);
});

test('a missing or malformed Host header is not redirected',async()=>{
 for(const host of ['','   ',undefined]){
  const {handled}=await run(host);
  assert.notEqual(handled,true);
 }
});

test('a request object with no headers at all is served, not crashed on',async()=>{
 const gateway=createEdgeGateway({});
 const res={statusCode:null,writeHead(s,v){this.statusCode=s;this.headers=v;return this;},end(){return this;}};
 // Several existing suites drive the gateway with a minimal request that has no
 // headers object. Host detection must tolerate that rather than throw.
 const handled=await gateway({method:'GET',url:'/'},res);
 assert.notEqual(handled,true);
});
