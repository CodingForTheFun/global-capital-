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
  assert.equal(serveWorkspaceAsset({ url: '/assets/edge-workspace-nav.js', method: 'GET' }, res), true);
  assert.equal(status, 200); assert.match(payload.toString(), /Auto Scout/);
  serveWorkspaceAsset({ url: '/assets/edge-workspace-nav.js', method: 'POST' }, res); assert.equal(status, 405);
  assert.equal(serveWorkspaceAsset({ url: '/api/apex/props', method: 'GET' }, res), false);
});
test('both workspaces put Auto Scout beside Tools and use native same-site navigation', () => {
  const nav = readFileSync(new URL('../public/edge-workspace-nav.js', import.meta.url), 'utf8');
  assert.match(nav, /\['Tools', '\/sportsbooks#tools'\], \['Auto Scout', '\/apex'\]/);
  assert.doesNotMatch(nav, /fetch\(|iframe|localStorage|cookie|token/i);
  const ui = readFileSync(new URL('../apps/guest-dashboard/components/SportsWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(ui, /label: 'Tools'/); assert.match(ui, /data-testid="autoscout-nav" href="\/apex"/);
  assert.match(ui, /\/api\/apex\/props\?sport=/);
  assert.doesNotMatch(ui, /api\.the-odds-api|\/api\/bets|\/userBets|current_balance|\.post\(/);
});
