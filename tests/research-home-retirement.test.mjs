import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {patchEdgeFrontdoor} from '../lib/edge/frontdoor-patch.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));

test('retired sportsbook availability is false without modifying other capabilities',()=>{
 const source=readFileSync(path.join(root,'frontdoor-prod.mjs'),'utf8');
 const patched=patchEdgeFrontdoor(source);
 assert.match(patched,/features: \{ ask: askConfigured\(\), projections: projectionsConfigured\(\), sportsbook: false \}/);
 assert.doesNotMatch(patched,/sportsbook: true/);
 assert.throws(()=>patchEdgeFrontdoor(source.replace('sportsbook: true','sportsbook: unknown')),/anchors changed/);
});

test('checkout identity is Oblige Props and build preparation never rewrites payment code',()=>{
 const checkout=readFileSync(path.join(root,'public/checkout.html'),'utf8');
 const prepare=readFileSync(path.join(root,'scripts/prepare-edge-deploy.mjs'),'utf8');
 assert.doesNotMatch(checkout,/AutoProp Scout|Auto Scout|ObligePay Edge/);
 assert.match(checkout,/server independently verifies that PayPal reports the subscription as active/i);
 assert.match(checkout,/never receives raw card numbers/i);
 assert.doesNotMatch(prepare,/writeFileSync\([^)]*payments|replaceAll\('Oblige Props',\s*'Auto Scout'\)/);
});

test('billing is wired before the account gate so verified PayPal webhooks remain reachable',()=>{
 const source=readFileSync(path.join(root,'frontdoor-prod.mjs'),'utf8');
 const patched=patchEdgeFrontdoor(source);
 assert.match(patched,/handleBillingRoutes\(req, res, billingUrl/);
 const billingCall=patched.indexOf('handleBillingRoutes(req, res, billingUrl');
 const gateCall=patched.indexOf('if (await maybeServeGate(req, res)) return;');
 assert.ok(billingCall>0 && gateCall>billingCall,'billing handler must run before the generic account gate');
});
