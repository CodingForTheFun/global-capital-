import test from 'node:test';
import assert from 'node:assert/strict';
import {askProvider,askConfigured,askAboutProp} from '../lib/projections/ask.mjs';
test('Ask uses configured Gemini and respects explicit choices without needing Anthropic',()=>{
 assert.equal(askProvider({GEMINI_API_KEY:'test'}),'gemini');assert.equal(askConfigured({GOOGLE_API_KEY:'test'}),true);
 assert.equal(askProvider({ASK_PROVIDER:'anthropic',GEMINI_API_KEY:'test'}),null);assert.equal(askConfigured({}),false);
});
test('Gemini Ask sends canonical bounded card, server-only key and system grounding',async()=>{
 const previous={...process.env};process.env.GEMINI_API_KEY='test-only';delete process.env.ANTHROPIC_API_KEY;delete process.env.PROJECTION_PROVIDER;process.env.ASK_PROVIDER='gemini';process.env.ASK_MODEL='gemini-3.1-flash-lite';
 try{let calls=0;const out=await askAboutProp({question:'Count results',prop:{sport:'NBA',playerName:'Test',market:'Points',line:25.5,gameLog:[{value:30},{value:20},{value:24},{value:28}],secret:'MUST_NOT_APPEAR'},fetchImpl:async(url,opts)=>{
 calls++;assert.ok(url.endsWith(':generateContent'));assert.ok(!url.includes('test-only'));assert.equal(opts.headers['x-goog-api-key'],'test-only');const body=JSON.parse(opts.body);assert.ok(body.systemInstruction);assert.ok(!opts.body.includes('MUST_NOT_APPEAR'));return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'Do not show reasoning',thought:true},{text:'Two results exceeded 25.5.'}]},finishReason:'STOP'}]}),{status:200});}});
 assert.equal(out.available,true);assert.equal(out.answer,'Two results exceeded 25.5.');assert.equal(calls,1);
 const failure=await askAboutProp({question:'x',fetchImpl:async()=>new Response('{}',{status:429})});assert.equal(failure.code,'ASK_RATE_LIMITED');
 }finally{for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);}
});
