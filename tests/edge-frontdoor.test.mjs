import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patchEdgeFrontdoor } from '../lib/edge/frontdoor-patch.mjs';
test('Edge extends the current frontdoor without replacing account/provider handlers', () => {
  const source = readFileSync(new URL('../frontdoor-prod.mjs', import.meta.url), 'utf8');
  const patched = patchEdgeFrontdoor(source);
  assert.ok(patched.includes('createEdgeGateway({ currentAccount, sessions: accountSessions })'));
  assert.ok(patched.indexOf('if (await edgeGuest(req, res))') < patched.indexOf('if (await maybeServeGate(req, res))'));
  for (const token of ['maybeServeAccount(req, res)', 'maybeServeResearch(req, res)', 'maybeServeAsk(req, res)', "child('apex-v2/server-core.mjs'", "child('server-scout.mjs'"]) assert.ok(patched.includes(token), token);
  assert.ok(patched.includes('/assets/edge-theme.css'));
});
test('Edge patch refuses an unknown or already-patched server', () => {
  assert.throws(() => patchEdgeFrontdoor('unknown'), /anchors changed/);
});
