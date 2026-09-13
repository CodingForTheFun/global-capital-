import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isSportsWorkspace, serveWorkspaceAsset } from '../lib/edge/workspace-routes.mjs';
test('sports workspace routing only claims its exact page, never account or research APIs', () => {
  assert.equal(isSportsWorkspace('/sportsbooks'), true);
  assert.equal(isSportsWorkspace('/sportsbooks/'), true);
  for (const name of ['/apex', '/api/apex/props', '/api/account/me', '/api/account/register', '/sportsbooks/fake']) assert.equal(isSportsWorkspace(name), false);
});
test('navigation assets are allowlisted and reject writes', () => {
  let status, payload;
  const res = { writeHead(code) { status = code; }, end(body) { payload = body; } };
  assert.equal(serveWorkspaceAsset({ url: '/assets/autoscout-home.js', method: 'GET' }, res), true);
  assert.equal(status, 200); assert.match(payload.toString(), /Auto Scout/);
  serveWorkspaceAsset({ url: '/assets/autoscout-home.js', method: 'POST' }, res); assert.equal(status, 405);
  assert.equal(serveWorkspaceAsset({ url: '/api/apex/props', method: 'GET' }, res), false);
});
test('research-only navigation reuses v5 controls and never fetches data', () => {
  const nav = readFileSync(new URL('../public/autoscout-home.js', import.meta.url), 'utf8');
  assert.match(nav, /Auto Scout/);
  assert.doesNotMatch(nav, /fetch\(|iframe|localStorage|cookie|token/i);
  assert.doesNotMatch(nav, /\/sportsbooks/);
  const patch = patchSource();
  assert.match(patch, /autoscout-home/);
  assert.doesNotMatch(patch, /edge-workspace-nav/);
});
function patchSource(){return readFileSync(new URL('../lib/edge/frontdoor-patch.mjs', import.meta.url),'utf8');}
