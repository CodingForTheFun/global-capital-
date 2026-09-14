import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEdgeGateway } from '../lib/edge/gateway.mjs';
import { navFor } from '../lib/auth/permissions.mjs';
import { researchLanding } from '../lib/ui/research-home.mjs';

function responseRecorder() {
  return {
    status: null,
    headers: {},
    body: '',
    writeHead(status, headers = {}) { this.status = status; this.headers = { ...headers }; },
    end(body) { if (body) this.body += Buffer.isBuffer(body) ? body.toString('utf8') : String(body); },
  };
}

function request(pathname) {
  return { url: pathname, method: 'GET', headers: {}, socket: { remoteAddress: '127.0.0.1' } };
}

test('owner console is absent from customer navigation', () => {
  const memberNav = navFor('member');
  assert.equal(memberNav.some((item) => item.ownerOnly), false);
  assert.equal(memberNav.some((item) => String(item.href || '').startsWith('/owner')), false);
  assert.equal(memberNav.some((item) => /owner|members|who’s online|providers/i.test(String(item.label || ''))), false);

  const ownerNav = navFor('owner');
  assert.ok(ownerNav.some((item) => item.ownerOnly && String(item.href || '').startsWith('/owner')));
});

test('owner console files return ordinary 404 to non-owners', async () => {
  const gateway = createEdgeGateway({ currentAccount: async () => ({ user: { id: 'm1', role: 'member' } }), sessions: {} });
  for (const pathname of ['/owner', '/owner.html', '/owner.css', '/owner.js']) {
    const res = responseRecorder();
    assert.equal(await gateway(request(pathname), res), true);
    assert.equal(res.status, 404, pathname);
    assert.match(String(res.headers['x-robots-tag'] || ''), /noindex/i);
  }
});

test('owner console is served only to the owner session', async () => {
  const gateway = createEdgeGateway({ currentAccount: async () => ({ user: { id: 'o1', role: 'owner' } }), sessions: {} });
  const res = responseRecorder();
  assert.equal(await gateway(request('/owner'), res), true);
  assert.equal(res.status, 200);
  assert.match(res.body, /OBLIGE PROPS/);
  assert.match(String(res.headers['x-robots-tag'] || ''), /noindex/i);
});

test('Oblige Props exposes an installable standalone iOS web-app shell', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.name, 'Oblige Props');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.scope, '/');

  const html = researchLanding('<!doctype html><html><head><title>Auto Scout</title></head><body>Auto Scout</body></html>');
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /apple-mobile-web-app-title/);
  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /Oblige Props/);
});

test('service worker never caches APIs, owner routes, or navigations', () => {
  const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(sw, /url\.pathname\.startsWith\('\/owner'\)/);
  assert.match(sw, /request\.mode === 'navigate'/);
});
