import test from 'node:test';
import assert from 'node:assert/strict';
import { patchEdgeFrontdoor } from '../lib/edge/frontdoor-patch.mjs';

const fixture = `
import { landingPage } from './lib/auth/landing.mjs';
const shell = readFileSync('./apex-v2/scout-ui-v5.js', 'utf8');
const flags = { sportsbook: true };
const server = http.createServer(async (req, res) => {
  applySecurityHeaders(res);
  if (serveStatic(req, res, url)) return;
  if (await serveNewWeb(req, res, url, { sessions: accountSessions })) return;
  if (servePublicSurface(req, res, { origin: SITE_ORIGIN })) return;
  if (await maybeServeGate(req, res)) return;
  const injection = \`<script>\${APEX_SHELL}</script>\`;
});
`;

test('retired customer host canonicalization is injected before static/new-web handlers', () => {
  const output = patchEdgeFrontdoor(fixture);
  const security = output.indexOf('applySecurityHeaders(res);');
  const redirect = output.indexOf('if (maybeRedirectRetiredNavigation(req, res)) return;');
  const staticHandler = output.indexOf('if (serveStatic(req, res, url)) return;');
  const newWeb = output.indexOf('if (await serveNewWeb(req, res, url, { sessions: accountSessions })) return;');

  assert.ok(security >= 0);
  assert.ok(redirect > security, 'redirect should run after security headers');
  assert.ok(staticHandler > redirect, 'redirect should run before static assets');
  assert.ok(newWeb > redirect, 'redirect should run before the new web shell can consume /');
});

test('early redirect recognizes the retired customer domains and preserves cached API clients', () => {
  const output = patchEdgeFrontdoor(fixture);

  for (const host of ['obligepay.com', 'www.obligepay.com', 'obligeprops.com']) {
    assert.match(output, new RegExp(host.replaceAll('.', '\\.')));
  }
  assert.match(output, /x-forwarded-host/);
  assert.match(output, /pathname === '\/api' \|\| pathname\.startsWith\('\/api\/'\)/);
  assert.match(output, /req\.method === 'GET' \|\| req\.method === 'HEAD' \? 301 : 308/);
  assert.match(output, /location: SITE_ORIGIN \+ pathAndQuery/);
});
