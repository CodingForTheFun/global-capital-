import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {patchEdgeFrontdoor} from '../lib/edge/frontdoor-patch.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
test('retired sportsbook availability is false without modifying other capabilities',()=>{
 const source=readFileSync(path.join(root,'frontdoor-prod.mjs'),'utf8');
 const patched=patchEdgeFrontdoor(source);
 assert.match(patched,/features: \{ ask: askConfigured\(\), projections: projectionsConfigured\(\), sportsbook: false \}/);
 assert.doesNotMatch(patched,/sportsbook: true/);
 assert.throws(()=>patchEdgeFrontdoor(source.replace('sportsbook: true','sportsbook: unknown')),/anchors changed/);
});
test('checkout identity is consistent and merchant/payment configuration remains untouched',()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'autoscout-brand-'));
 try{
  mkdirSync(path.join(directory,'public'));
  mkdirSync(path.join(directory,'payments'));
  const original=readFileSync(path.join(root,'public/checkout.html'),'utf8');
  writeFileSync(path.join(directory,'public/checkout.html'),original);
  writeFileSync(path.join(directory,'payments/paypal.mjs'),'unchanged merchant product config');
  const run=()=>execFileSync(process.execPath,[path.join(root,'scripts/prepare-edge-deploy.mjs')],{cwd:directory});
  run();const decorated=readFileSync(path.join(directory,'public/checkout.html'),'utf8');
  assert.doesNotMatch(decorated,/AutoProp Scout|ObligePay Edge/);
  assert.match(decorated,/rather than passing through Auto Scout\./);
  assert.equal(decorated.slice(decorated.indexOf('<script>')),original.slice(original.indexOf('<script>')),'checkout transaction script is unchanged');
  assert.equal(readFileSync(path.join(directory,'payments/paypal.mjs'),'utf8'),'unchanged merchant product config');
  run();assert.equal(readFileSync(path.join(directory,'public/checkout.html'),'utf8'),decorated,'branding transform is idempotent');
 }finally{rmSync(directory,{recursive:true,force:true});}
});
