import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { serveWorkspaceAsset } from '../lib/edge/workspace-routes.mjs';
import { patchEdgeFrontdoor } from '../lib/edge/frontdoor-patch.mjs';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
test('Taco UI is separate from navigation and excluded from the sportsbook component', () => {
  const board = read('apps/guest-dashboard/components/SportsWorkspace.tsx');
  assert.doesNotMatch(board, /TacoBoard|\['tacos','🌮 Tacos'\]/);
  assert.match(board, /window\.location\.replace\('\/apex#tacos'\)/);
  assert.equal(existsSync(new URL('../apps/guest-dashboard/components/TacoBoard.tsx', import.meta.url)), false);
  assert.doesNotMatch(read('public/edge-workspace-nav.js'), /fetch\(|iframe|localStorage|cookie|token/i);
  const ui = read('public/autoscout-tacos.js');
  new vm.Script(ui);
  assert.match(ui, /Taco-only props/);
  assert.match(ui, /\/api\/apex\/taco-offers/);
  assert.doesNotMatch(ui, /innerHTML|localStorage|document\.cookie|setInterval|method:\s*['"]POST/);
});
test('separate Taco asset is injected only alongside Auto Scout and rejects writes', () => {
  assert.match(patchEdgeFrontdoor(read('frontdoor-prod.mjs')), /src="\/assets\/autoscout-tacos\.js" defer/);
  for (const method of ['GET','HEAD','POST']) {
    let status, body;
    const res = { writeHead(code) { status = code; }, end(value) { body = value; } };
    assert.equal(serveWorkspaceAsset({ url: '/assets/autoscout-tacos.js', method }, res), true);
    assert.equal(status, method === 'POST' ? 405 : 200);
    if (method === 'GET') assert.match(body.toString(), /Taco-only props/);
    else assert.equal(body, undefined);
  }
});
