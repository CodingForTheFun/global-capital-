import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createEdgeGateway} from '../lib/edge/gateway.mjs';
import {patchEdgeFrontdoor} from '../lib/edge/frontdoor-patch.mjs';
import {researchClient,researchLanding} from '../lib/ui/research-home.mjs';
import {landingPage} from '../lib/auth/landing.mjs';
const read = path => fs.readFileSync(new URL('../'+path, import.meta.url),'utf8');
const gateway=createEdgeGateway();
async function response(url,method='GET'){
 const out={};out.handled=await gateway({url,method},{writeHead(status,headers){out.status=status;out.headers=headers;},end(body){out.body=body;}});return out;
}
test('home falls through to the native account gate and original research app',async()=>{
 for(const url of ['/','/?signin=expired','/apex','/api/account/me','/api/account/register','/api/props/ask','/api/props/project','/api/props/ml','/api/apex/props','/api/apex/research','/api/apex/research-batch','/api/apex/line-history','/api/saved-props','/api/health','/api/paypal/webhook'])assert.equal((await response(url)).handled,false,url);
 assert.doesNotMatch(read('lib/edge/gateway.mjs'),/spawn\(|http\.request|process\.exit|3004/);
});
test('old sportsbook and guest pages redirect same-origin, never restore a sportsbook',async()=>{
 for(const url of ['/sportsbooks','/sportsbooks/','/sportsbook','/preview','/preview/']){
  const res=await response(url);assert.equal(res.status,302);assert.equal(res.headers.location,'/apex');
  assert.equal((await response(url,'POST')).status,405);
 }
 const res=await response('/sportsbooks?sport=NFL&next=https://evil.invalid&token=private');
 assert.equal(res.headers.location,'/apex?sport=NFL');assert.equal(res.headers['cache-control'],'no-store');
 assert.equal((await response('/sportsbooks?sport=%3Cscript%3E')).headers.location,'/apex');
});
test('retired game endpoints and assets fail without contacting any providers',async()=>{
 for(const url of ['/api/apex/game-markets','/api/ask-prop','/api/guest-health','/_next/static/old.js','/sportsbooks/unknown','/assets/edge-workspace-nav.js','/assets/edge-theme.css']){
  const res=await response(url);assert.equal(res.status,410);assert.equal(JSON.parse(res.body).code,'RETIRED_WORKSPACE');
  assert.equal((await response(url,'HEAD')).body,undefined);
 }
});
test('research-only asset allowlist serves JS/CSS and rejects writes',async()=>{
 for(const path of ['/assets/autoscout-home.css','/assets/autoscout-home.js','/assets/autoscout-tacos.js']){
  assert.equal((await response(path)).status,200);assert.equal((await response(path,'HEAD')).body,undefined);assert.equal((await response(path,'POST')).status,405);
 }
 assert.equal((await response('/assets/autoscout-home.js/../../.env')).handled,false);
});
test('presentation adapter removes the slip without replacing server-bound research saves',()=>{
 const original=read('apex-v2/scout-ui-v5.js'), client=researchClient(original);
 new vm.Script(client);assert.doesNotMatch(client,/id="asSlip"|class="asBtn asSlipAdd"|\['Betslip',limits/);
 for(const feature of ['data-fav','loadSaved','/api/saved-props','/api/apex/props','/api/apex/research','research-batch','analyzeResearch','repriceProjection','intelligence-studio.mjs','offer-promotion.mjs','createMLClient'])assert.ok(client.includes(feature),feature);
 const before=original.slice(original.indexOf('function openDrawer('),original.indexOf('function openDrawer(')+1000);
 assert.ok(client.includes(before),'original drawer implementation remains unchanged');
 assert.equal(researchClient(client),client,'idempotent');assert.throws(()=>researchClient('unknown shell'));
});
test('native sign-in form and safe redirects survive the research-only landing decoration',()=>{
 for(const options of [{passwordSignup:true,googleSignup:true,next:'/apex'},{passwordSignup:false,googleSignup:false,next:'https://evil.invalid'}]){
  const original=landingPage(options), decorated=researchLanding(original);
  assert.equal(decorated.slice(decorated.indexOf('<script>')),original.slice(original.indexOf('<script>')),'auth code unchanged');
  assert.doesNotMatch(decorated,/Betslip with Kelly|Stake suggestions|ObligePay|Pushes excluded/);
  assert.match(decorated,/Auto Scout/);assert.match(decorated,/asResearchGate/);
  assert.equal(decorated.includes('id="authForm"'),original.includes('id="authForm"'));
 }
});
test('frontdoor preserves research, ML, subscriptions and accounts behind the same gate',()=>{
 const source=read('frontdoor-prod.mjs'),result=patchEdgeFrontdoor(source);
 for(const code of ['maybeServeAccount(req, res)','maybeServeML(req, res)','maybeServeResearch(req, res)','maybeServeAsk(req, res)','maybeServeGate(req, res)'])assert.ok(result.includes(code),code);
 assert.match(result,/researchClient\(readFileSync/);assert.match(result,/autoscout-home.css/);assert.doesNotMatch(result,/edge-workspace-nav|edge-theme.css/);
 assert.throws(()=>patchEdgeFrontdoor(result),/anchors changed/);
});
test('retired React sportsbook is excluded from runtime, not reinstalled on deploy',()=>{
 assert.doesNotMatch(read('Dockerfile'),/guest-dashboard|next build|NEXT_TELEMETRY/);
 assert.match(read('.dockerignore'),/apps\/guest-dashboard/);
 assert.match(read('Dockerfile'),/frontdoor-clearsports.mjs/);
 assert.doesNotMatch(read('scripts/prepare-edge-deploy.mjs'),/writeFileSync\([^)]*payments|replaceAll\('Auto Scout', 'ObligePay Edge'\)/);
 const manifest=JSON.parse(read('public/manifest.webmanifest'));assert.equal(manifest.name,'Auto Scout');assert.equal(manifest.start_url,'/');
});
test('theme and presentation script introduce no provider calls or persistent state',()=>{
 const script=read('public/autoscout-home.js');new vm.Script(script);
 assert.doesNotMatch(script,/fetch\(|XMLHttpRequest|localStorage|sessionStorage|document\.cookie|setInterval/);
 assert.match(script,/observer\?\.disconnect/);assert.match(read('public/autoscout-home.css'),/#as5/);
 assert.match(read('public/autoscout-home.css'),/prefers-reduced-motion/);
});
