import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  SECURITY_HEADERS, applySecurityHeaders, headTags, robotsTxt, sitemapXml,
  webManifest, servePublicSurface, siteOrigin,
} from '../lib/web/public-surface.mjs';
import { legalPage, LEGAL_PATHS, legalIdentity, serveLegal } from '../lib/web/legal.mjs';

function fakeRes() {
  const headers = {};
  return {
    statusCode: null, headers, body: null, ended: false,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    hasHeader(k) { return Object.prototype.hasOwnProperty.call(headers, k.toLowerCase()); },
    writeHead(status, extra = {}) { this.statusCode = status; Object.assign(headers, extra); },
    end(body) { this.body = body; this.ended = true; },
  };
}
const req = (url, method = 'GET') => ({ url, method });

test('every response carries the hardening headers', () => {
  const res = fakeRes();
  applySecurityHeaders(res);
  for (const name of ['strict-transport-security', 'x-content-type-options', 'x-frame-options',
    'referrer-policy', 'permissions-policy', 'content-security-policy']) {
    assert.ok(res.headers[name], `${name} must be set`);
  }
  assert.match(res.headers['x-frame-options'], /DENY|SAMEORIGIN/);
  assert.match(res.headers['content-security-policy'], /frame-ancestors/);
});

// The app injects its shell inline, so a script-src policy would white-screen
// the board. The CSP must stay to the directives that cannot do that.
test('the CSP does not restrict scripts or styles', () => {
  const csp = SECURITY_HEADERS['content-security-policy'];
  assert.doesNotMatch(csp, /script-src|style-src|default-src/);
});

test('a header already set by a route is not overwritten', () => {
  const res = fakeRes();
  res.setHeader('x-frame-options', 'DENY');
  applySecurityHeaders(res);
  assert.equal(res.headers['x-frame-options'], 'DENY');
});

test('icons, robots, sitemap and the manifest are served without a session', () => {
  for (const path of ['/favicon.ico', '/brand/icon-32.png', '/brand/icon-180.png',
    '/brand/icon-512.png', '/brand/og.png', '/apple-touch-icon.png',
    '/robots.txt', '/sitemap.xml', '/site.webmanifest']) {
    const res = fakeRes();
    assert.equal(servePublicSurface(req(path), res), true, `${path} must be served`);
    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['content-type'], `${path} needs a content type`);
    assert.ok(res.body && res.body.length > 0, `${path} must have a body`);
  }
});

test('the brand files the routes promise actually exist', () => {
  for (const file of ['public/brand/favicon.ico', 'public/brand/icon-32.png',
    'public/brand/icon-180.png', 'public/brand/icon-512.png', 'public/brand/og.png']) {
    assert.ok(existsSync(new URL('../' + file, import.meta.url)), `${file} is referenced but missing`);
  }
});

test('unrelated paths fall through to the rest of the server', () => {
  for (const path of ['/', '/apex', '/api/health', '/brand/../frontdoor-prod.mjs']) {
    assert.equal(servePublicSurface(req(path), fakeRes()), false, `${path} must not be captured`);
  }
});

test('only GET and HEAD are served, and HEAD sends no body', () => {
  assert.equal(servePublicSurface(req('/robots.txt', 'POST'), fakeRes()), false);
  const res = fakeRes();
  servePublicSurface(req('/robots.txt', 'HEAD'), res);
  assert.equal(res.body, undefined);
  assert.ok(Number(res.headers['content-length']) > 0, 'HEAD still reports the length');
});

test('robots points at the sitemap and keeps crawlers out of the gated board', () => {
  const body = robotsTxt('https://example.test');
  assert.match(body, /Sitemap: https:\/\/example\.test\/sitemap\.xml/);
  assert.match(body, /Disallow: \/api\//);
  assert.match(body, /Disallow: \/apex/);
});

test('the sitemap lists the public pages and is well formed', () => {
  const xml = sitemapXml('https://example.test', new Date('2026-09-14T00:00:00Z'));
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  for (const path of ['/', ...LEGAL_PATHS]) {
    assert.ok(xml.includes(`<loc>https://example.test${path}</loc>`), `${path} missing from the sitemap`);
  }
  assert.equal((xml.match(/<url>/g) || []).length, (xml.match(/<\/url>/g) || []).length);
});

test('the manifest is valid JSON pointing at icons that exist', () => {
  const manifest = JSON.parse(webManifest());
  assert.ok(manifest.name && manifest.start_url === '/');
  for (const icon of manifest.icons) {
    const res = fakeRes();
    assert.equal(servePublicSurface(req(icon.src), res), true, `${icon.src} is declared but not served`);
  }
});

test('link previews carry a title, description and image', () => {
  const tags = headTags('https://example.test', { path: '/' });
  for (const needle of ['og:title', 'og:description', 'og:image', 'twitter:card',
    'canonical', 'apple-touch-icon', 'manifest', 'theme-color']) {
    assert.ok(tags.includes(needle), `${needle} missing from the head`);
  }
  assert.ok(tags.includes('https://example.test/brand/og.png'));
});

test('head tag values are escaped so a title cannot break out of the attribute', () => {
  const tags = headTags('https://example.test', { path: '/', title: 'a" onload="x', description: '<script>' });
  assert.ok(!tags.includes('onload="x'), 'quotes in a title must be escaped');
  assert.ok(!tags.includes('<script>'), 'markup in a description must be escaped');
});

test('the origin comes from configuration before any default', () => {
  assert.equal(siteOrigin({ PUBLIC_SITE_ORIGIN: 'https://a.test/' }), 'https://a.test');
  assert.equal(siteOrigin({ RAILWAY_PUBLIC_DOMAIN: 'b.test' }), 'https://b.test');
  assert.match(siteOrigin({}), /^https:\/\//);
});

test('the three legal pages render and cross-link each other', () => {
  for (const path of LEGAL_PATHS) {
    const html = legalPage(path, { env: {}, origin: 'https://example.test' });
    assert.ok(html && html.startsWith('<!doctype html>'), `${path} must render`);
    for (const other of LEGAL_PATHS) assert.ok(html.includes(`href="${other}"`), `${path} must link ${other}`);
    assert.ok(html.includes('href="/"'), `${path} must link home`);
  }
});

test('the legal identity is configuration, never an invented one', () => {
  const configured = legalIdentity({ LEGAL_ENTITY: 'Acme LLC', LEGAL_CONTACT_EMAIL: 'legal@acme.test', LEGAL_JURISDICTION: 'Delaware, USA' });
  assert.equal(configured.entity, 'Acme LLC');
  const terms = legalPage('/terms', { env: { LEGAL_ENTITY: 'Acme LLC', LEGAL_JURISDICTION: 'Delaware, USA' } });
  assert.ok(terms.includes('Acme LLC'));
  assert.match(terms, /Governing law/);
});

// Naming a jurisdiction nobody chose would be inventing a legal fact.
test('no governing-law clause appears when no jurisdiction is configured', () => {
  const terms = legalPage('/terms', { env: {} });
  assert.doesNotMatch(terms, /Governing law/);
  assert.doesNotMatch(terms, /\[|\{\{|TODO|PLACEHOLDER/i, 'no unfilled placeholders may ship');
});

test('the responsible-gaming page carries a real helpline', () => {
  const page = legalPage('/responsible-gaming', { env: {} });
    assert.ok(page.includes('1-800-522-4700'), 'the US helpline number must be present');
  assert.match(page, /ncpgambling\.org/);
});

test('the pages state what the product is, so the terms match the code', () => {
  const terms = legalPage('/terms', { env: {} });
  assert.match(terms, /does not accept wagers/i);
  const privacy = legalPage('/privacy', { env: {} });
  // These are claims the code has to keep true: no analytics, one cookie.
  assert.match(privacy, /no analytics/i);
  assert.match(privacy, /sp_account/);
});

test('serveLegal answers the legal paths and nothing else', () => {
  for (const path of LEGAL_PATHS) {
    const res = fakeRes();
    assert.equal(serveLegal(req(path), res, { env: {} }), true);
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /text\/html/);
  }
  assert.equal(serveLegal(req('/'), fakeRes(), { env: {} }), false);
  assert.equal(serveLegal(req('/terms', 'POST'), fakeRes(), { env: {} }), false);
});

// The claims in the privacy policy are only true while the code keeps them true.
test('no analytics or third-party tracker is present in shipped code', () => {
  const landing = readFileSync(new URL('../lib/auth/landing.mjs', import.meta.url), 'utf8');
  for (const tracker of ['googletagmanager', 'google-analytics', 'mixpanel', 'hotjar', 'facebook.net', 'posthog']) {
    assert.ok(!landing.includes(tracker), `${tracker} would contradict the privacy policy`);
  }
});

test('the landing page links its legal pages', () => {
  const landing = readFileSync(new URL('../lib/auth/landing.mjs', import.meta.url), 'utf8');
  for (const path of LEGAL_PATHS) assert.ok(landing.includes(`href="${path}"`), `landing must link ${path}`);
});

// The sign-in form lives on the front page, so these were dead ends that lost
// a visitor who was actively trying to reach an account.
test('the account paths people type redirect to the sign-in page', () => {
  for (const path of ['/login', '/signin', '/sign-in', '/signup', '/sign-up', '/register', '/account', '/login/']) {
    const res = fakeRes();
    assert.equal(servePublicSurface(req(path), res), true, `${path} must be handled`);
    assert.equal(res.statusCode, 302, `${path} must redirect`);
    assert.equal(res.headers.location, '/');
  }
});

test('the redirect does not swallow the real routes', () => {
  for (const path of ['/', '/apex', '/api/account/login', '/accounts', '/logins']) {
    const res = fakeRes();
    const handled = servePublicSurface(req(path), res);
    assert.ok(!handled || res.statusCode !== 302, `${path} must not be redirected`);
  }
});

// Oblige Props is the public brand; Auto Scout is the research engine behind
// it. A customer reading the terms before paying should meet one company, not
// two - the chrome was renamed and these page bodies were missed.
test('every public page names one brand to the customer', async () => {
  const { legalPage, LEGAL_PATHS } = await import('../lib/web/legal.mjs');
  const { billingPage, BILLING_PATHS } = await import('../lib/web/billing-pages.mjs');
  for (const path of LEGAL_PATHS) {
    assert.ok(!legalPage(path).includes('Auto Scout'), `${path} still names the research engine`);
    assert.ok(legalPage(path).includes('Oblige Props'), `${path} must name the public brand`);
  }
  for (const path of BILLING_PATHS) {
    assert.ok(!billingPage(path).includes('Auto Scout'), `${path} still names the research engine`);
  }
  assert.ok(!webManifest().includes('Auto Scout'));
  assert.ok(!headTags('https://example.test').includes('Auto Scout'));
});
